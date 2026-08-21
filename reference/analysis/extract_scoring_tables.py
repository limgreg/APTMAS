"""Extract 《大学生国家体质健康测试评分标准》 from the source PDF into machine-readable JSON.

**Why this file exists.** ``AGENTS.md`` §The core premise: the rule engine must be exact, and
no threshold may ever be approximated from memory or inference. So the scoring tables are not
typed by hand — they are *parsed* from the official PDF by this script, which fails loudly if
the document's structure differs from what it expects. The single auditable origin of every
scored number in APTAMS is therefore: the PDF, plus this extractor.

The emitted JSON lands in ``data/scoring_tables/`` which is git-ignored (see that directory's
README — real thresholds never enter version control). Teammates regenerate it with::

    python -m analysis.extract_scoring_tables

Structural invariants asserted here (any failure aborts rather than emitting a table):
  * exactly 20 score levels, in the documented descending order
  * every item present, for both sexes and both grade groups
  * per-item thresholds strictly monotonic in the item's own direction
  * item weights sum to exactly 100
  * BMI categories tile the real line with no gap and no overlap, per sex
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

import pdfplumber

# --- The document we parse. Structure below is asserted, never assumed. --------------------

DEFAULT_PDF = Path("data/ML/2026316427993附件1.大学生国家体质健康测试评分标准(1).pdf")
DEFAULT_OUT = Path("data/scoring_tables/university_2014.json")

#: Score levels down the left column, in the order the standard prints them.
SCORE_LEVELS = (100, 95, 90, 85, 80, 78, 76, 74, 72, 70, 68, 66, 64, 62, 60, 50, 40, 30, 20, 10)

#: 等级 (item-level grade band) -> the score levels it groups, as printed in the source.
ITEM_BANDS = {
    "优秀": (100, 95, 90),
    "良好": (85, 80),
    "及格": (78, 76, 74, 72, 70, 68, 66, 64, 62, 60),
    "不及格": (50, 40, 30, 20, 10),
}

#: Grade groups the standard scores separately. The panel's g1..g4 map onto these.
GRADE_GROUPS = {"大一大二": "g1g2", "大三大四": "g3g4"}
GRADE_TO_GROUP = {"g1": "g1g2", "g2": "g1g2", "g3": "g3g4", "g4": "g3g4"}

#: Header substring -> (item id, unit, direction). Matched against the PDF's own column titles.
ITEM_BY_HEADER = {
    "肺活量": ("vital_capacity", "ml", "higher_is_better"),
    "50米跑": ("sprint_50m", "s", "lower_is_better"),
    "坐位体前屈": ("sit_and_reach", "cm", "higher_is_better"),
    "立定跳远": ("standing_long_jump", "cm", "higher_is_better"),
    "引体向上": ("strength", "count", "higher_is_better"),
    "1000m": ("endurance_run", "s", "lower_is_better"),
}

ITEM_LABELS = {
    "vital_capacity": ("肺活量", "Vital capacity"),
    "sprint_50m": ("50米跑", "50m sprint"),
    "sit_and_reach": ("坐位体前屈", "Sit and reach"),
    "standing_long_jump": ("立定跳远", "Standing long jump"),
    "strength": ("引体向上（男）/一分钟仰卧起坐（女）", "Pull-ups (M) / 1-min sit-ups (F)"),
    "endurance_run": ("1000米跑（男）/800米跑（女）", "1000m run (M) / 800m run (F)"),
    "bmi": ("体重指数（BMI）", "Body mass index"),
}

#: Column order of the 单项指标与权重 row, as printed. The source's weight row has overlapping
#: text layers, so digits are recovered positionally and the total asserted to be exactly 100.
WEIGHT_ORDER = (
    "bmi",
    "vital_capacity",
    "sprint_50m",
    "sit_and_reach",
    "standing_long_jump",
    "strength",
    "endurance_run",
)


class ExtractionError(RuntimeError):
    """The PDF did not match the expected structure. We abort rather than emit a guess."""


# --- Value parsing -------------------------------------------------------------------------


def parse_duration(text: str) -> float:
    """``3'17"`` -> 197.0 seconds. The standard prints run times as 分·秒."""
    m = re.fullmatch(r"(\d+)'(\d{1,2})\"?", text.strip())
    if not m:
        raise ExtractionError(f"Unparseable duration {text!r}")
    return float(m.group(1)) * 60 + float(m.group(2))


def parse_seconds_delta(text: str) -> float:
    """``-35"`` -> 35.0 seconds of improvement below the 100-point threshold."""
    m = re.fullmatch(r"-(\d+)\"?", text.strip())
    if not m:
        raise ExtractionError(f"Unparseable seconds delta {text!r}")
    return float(m.group(1))


def parse_value(text: str | None, item_id: str) -> float | None:
    """Parse one threshold cell. Empty means the standard prints no threshold at that score."""
    text = (text or "").strip()
    if not text:
        return None
    if item_id == "endurance_run":
        return parse_duration(text)
    try:
        return float(text)
    except ValueError as exc:
        raise ExtractionError(f"Unparseable value {text!r} for {item_id}") from exc


def _digits(text: str | None) -> int:
    """Recover an integer from a cell whose glyphs may be interleaved with overlapping text."""
    found = re.findall(r"\d", text or "")
    if not found:
        raise ExtractionError(f"No digits in weight cell {text!r}")
    return int("".join(found))


# --- Table parsing -------------------------------------------------------------------------


def _score_rows(table: list[list[str | None]]) -> list[list[str | None]]:
    """The 20 data rows, verified to carry the documented score levels in order."""
    rows = [r for r in table if r[1] and r[1].strip().isdigit()]
    got = [int(r[1].strip()) for r in rows]
    if tuple(got) != SCORE_LEVELS:
        raise ExtractionError(f"Score levels {got} != expected {list(SCORE_LEVELS)}")
    return rows


def _identify_items(table: list[list[str | None]]) -> tuple[str, str]:
    """Map the page's two column groups to item ids using the PDF's own headers."""
    header = " ".join(c for c in table[0] if c)
    found: list[tuple[int, str]] = []
    for needle, (item_id, _unit, _direction) in ITEM_BY_HEADER.items():
        pos = header.find(needle)
        if pos >= 0:
            found.append((pos, item_id))
    ordered = [item for _pos, item in sorted(found)]
    if len(ordered) != 2:
        raise ExtractionError(f"Expected 2 items in header {header!r}, found {ordered}")
    return ordered[0], ordered[1]


def _assert_column_layout(table: list[list[str | None]]) -> None:
    """The sex banner and grade-group header must sit where the parser assumes."""
    sex_row, group_row = table[1], table[2]
    if [sex_row[2], sex_row[4], sex_row[6], sex_row[8]] != ["男生", "女生", "男生", "女生"]:
        raise ExtractionError(f"Unexpected sex header row: {sex_row}")
    for col in range(2, 10):
        label = (group_row[col] or "").strip()
        if label not in GRADE_GROUPS:
            raise ExtractionError(f"Unexpected grade-group header at col {col}: {label!r}")
        expected = "大一大二" if col % 2 == 0 else "大三大四"
        if label != expected:
            raise ExtractionError(f"Grade group at col {col} is {label!r}, expected {expected!r}")


def parse_item_page(table: list[list[str | None]]) -> dict[str, dict[str, Any]]:
    """Parse one two-item threshold page into ``{item_id: {sex: {group: [[score, raw], ...]}}}``.

    Column layout is fixed by the source and asserted by :func:`_assert_column_layout`:
    cols 2-5 are item A (male g1g2, male g3g4, female g1g2, female g3g4), cols 6-9 item B.
    """
    _assert_column_layout(table)
    item_a, item_b = _identify_items(table)
    layout = [
        (item_a, "male", "g1g2", 2), (item_a, "male", "g3g4", 3),
        (item_a, "female", "g1g2", 4), (item_a, "female", "g3g4", 5),
        (item_b, "male", "g1g2", 6), (item_b, "male", "g3g4", 7),
        (item_b, "female", "g1g2", 8), (item_b, "female", "g3g4", 9),
    ]
    rows = _score_rows(table)
    out: dict[str, dict[str, Any]] = {item_a: {}, item_b: {}}
    for item_id, sex, group, col in layout:
        pairs = []
        for row in rows:
            raw = parse_value(row[col], item_id)
            if raw is not None:
                pairs.append([int(row[1].strip()), raw])
        if not pairs:
            raise ExtractionError(f"No thresholds for {item_id}/{sex}/{group}")
        out[item_id].setdefault(sex, {})[group] = pairs
    return out


def _parse_bmi_range(text: str) -> dict[str, float | None]:
    """``17.9~23.9`` / ``≤17.8`` / ``≥28.0`` -> an inclusive ``{min, max}`` interval."""
    text = text.replace("～", "~")
    if m := re.fullmatch(r"(\d+\.?\d*)~(\d+\.?\d*)", text):
        return {"min": float(m.group(1)), "max": float(m.group(2))}
    if m := re.fullmatch(r"[≤<](\d+\.?\d*)", text):
        return {"min": None, "max": float(m.group(1))}
    if m := re.fullmatch(r"[≥>](\d+\.?\d*)", text):
        return {"min": float(m.group(1)), "max": None}
    raise ExtractionError(f"Unparseable BMI range {text!r}")


def _assert_bmi_coverage(cats: list[dict[str, Any]]) -> None:
    """Per sex, the four categories must tile the real line with no gap and no overlap.

    Thresholds are printed to one decimal, so adjacent bounds must differ by exactly 0.1.
    """
    for sex in ("male", "female"):
        spans = sorted(
            (c[sex] for c in cats),
            key=lambda s: (s["min"] if s["min"] is not None else float("-inf")),
        )
        if spans[0]["min"] is not None or spans[-1]["max"] is not None:
            raise ExtractionError(f"BMI {sex} categories are not unbounded at both ends")
        for lo, hi in zip(spans, spans[1:], strict=False):
            gap = round(hi["min"] - lo["max"], 10)
            if gap != 0.1:
                raise ExtractionError(
                    f"BMI {sex} categories not contiguous: {lo['max']} -> {hi['min']} (gap {gap})"
                )


def parse_bmi(table: list[list[str | None]]) -> list[dict[str, Any]]:
    """Parse the BMI category table.

    The source merges one score cell across 低体重 and 超重 (both score 80). pdfplumber
    attributes merged content to the first spanned row, leaving the second ``None``; we
    inherit forward and record ``score_from_merged_cell`` so the inference stays auditable.
    """
    wanted = {"正常": "normal", "低体重": "underweight", "超重": "overweight", "肥胖": "obese"}
    cats: list[dict[str, Any]] = []
    last_score: int | None = None
    for row in table:
        label = (row[0] or "").strip()
        if label not in wanted:
            continue
        cell = (row[1] or "").strip()
        merged = not cell
        if merged:
            if last_score is None:
                raise ExtractionError(f"BMI category {label!r} has no score and none to inherit")
            score = last_score
        else:
            score = int(cell)
            last_score = score
        cats.append({
            "category": wanted[label],
            "label_zh": label,
            "score": score,
            "score_from_merged_cell": merged,
            "male": _parse_bmi_range((row[2] or "").strip()),
            "female": _parse_bmi_range((row[3] or "").strip()),
        })
    if len(cats) != 4:
        raise ExtractionError(f"Expected 4 BMI categories, got {[c['label_zh'] for c in cats]}")
    _assert_bmi_coverage(cats)
    return cats


def parse_weights(table: list[list[str | None]]) -> dict[str, int]:
    """Parse 单项指标与权重. Asserts the weights sum to exactly 100."""
    weight_row = next((r for r in table if r[0] and "权重" in r[0]), None)
    if weight_row is None:
        raise ExtractionError("No 权重 row found in the weights table")
    values = [_digits(c) for c in weight_row[1:] if c]
    if len(values) != len(WEIGHT_ORDER):
        raise ExtractionError(f"Expected {len(WEIGHT_ORDER)} weights, got {values}")
    weights = dict(zip(WEIGHT_ORDER, values, strict=True))
    if sum(weights.values()) != 100:
        raise ExtractionError(f"Weights sum to {sum(weights.values())}, not 100: {weights}")
    return weights


def parse_bonus(table: list[list[str | None]]) -> dict[str, Any]:
    """Parse 加分指标评分表 — the 附加分 tables for strength and endurance.

    Per the source's own 备注: strength is 高优 (bonus by reps *above* the 100-point
    threshold); endurance is 低优 (bonus by seconds *below* it).
    """
    rows = [r for r in table if r[0] and r[0].strip().isdigit()]
    if len(rows) != 10:
        raise ExtractionError(f"Expected 10 bonus rows, got {len(rows)}")
    strength: dict[str, dict[str, list[list[float]]]] = {"male": {}, "female": {}}
    endurance: dict[str, dict[str, list[list[float]]]] = {"male": {}, "female": {}}
    cols = [
        ("male", "g1g2", 1, 7), ("male", "g3g4", 2, 8),
        ("female", "g1g2", 3, 9), ("female", "g3g4", 4, 10),
    ]
    for sex, group, s_col, e_col in cols:
        s_pairs, e_pairs = [], []
        for row in rows:
            bonus = int(row[0].strip())
            if int((row[6] or "").strip() or -1) != bonus:
                raise ExtractionError("Bonus tables are not row-aligned across the two halves")
            s_pairs.append([bonus, float((row[s_col] or "").strip())])
            e_pairs.append([bonus, parse_seconds_delta(row[e_col] or "")])
        strength[sex][group] = sorted(s_pairs)
        endurance[sex][group] = sorted(e_pairs)
    return {
        "strength": {
            "basis": "reps_above_100_point_threshold",
            "direction": "higher_is_better",
            "max_bonus": 10,
            "thresholds": strength,
        },
        "endurance_run": {
            "basis": "seconds_below_100_point_threshold",
            "direction": "lower_is_better",
            "max_bonus": 10,
            "thresholds": endurance,
        },
    }


# --- Assembly ------------------------------------------------------------------------------


def _assert_monotonic(item_id: str, direction: str, tables: dict[str, Any]) -> None:
    """A higher score must demand a strictly better raw value, in the item's own direction."""
    for sex, groups in tables.items():
        for group, pairs in groups.items():
            ordered = sorted(pairs, key=lambda p: -p[0])  # descending score
            raws = [p[1] for p in ordered]
            pairwise = zip(raws, raws[1:], strict=False)
            ok = (
                all(a > b for a, b in pairwise)
                if direction == "higher_is_better"
                else all(a < b for a, b in pairwise)
            )
            if not ok:
                raise ExtractionError(
                    f"{item_id}/{sex}/{group} thresholds not strictly monotonic "
                    f"({direction}): {raws}"
                )


def extract(pdf_path: Path) -> dict[str, Any]:
    """Parse the whole standard into the emitted JSON structure."""
    with pdfplumber.open(pdf_path) as pdf:
        if len(pdf.pages) != 4:
            raise ExtractionError(f"Expected a 4-page standard, got {len(pdf.pages)}")
        item_tables: dict[str, dict[str, Any]] = {}
        for page_no in (0, 1, 2):
            tables = pdf.pages[page_no].extract_tables()
            if len(tables) != 1:
                raise ExtractionError(f"Page {page_no}: expected 1 table, got {len(tables)}")
            item_tables.update(parse_item_page(tables[0]))
        last = pdf.pages[3].extract_tables()
        if len(last) != 3:
            raise ExtractionError(f"Page 3: expected 3 tables, got {len(last)}")
        bmi_cats = parse_bmi(last[0])
        weights = parse_weights(last[1])
        bonus = parse_bonus(last[2])

    items: list[dict[str, Any]] = []
    for item_id in WEIGHT_ORDER:
        label_zh, label_en = ITEM_LABELS[item_id]
        if item_id == "bmi":
            items.append({
                "id": item_id,
                "label_zh": label_zh,
                "label_en": label_en,
                "unit": "kg/m2",
                "direction": "band_optimal",
                "weight": weights[item_id],
                "scoring": "categorical",
                "categories": bmi_cats,
            })
            continue
        if item_id not in item_tables:
            raise ExtractionError(f"Item {item_id} missing from the extracted standard")
        _id, unit, direction = next(v for v in ITEM_BY_HEADER.values() if v[0] == item_id)
        thresholds = item_tables[item_id]
        _assert_monotonic(item_id, direction, thresholds)
        items.append({
            "id": item_id,
            "label_zh": label_zh,
            "label_en": label_en,
            "unit": unit,
            "direction": direction,
            "weight": weights[item_id],
            "scoring": "threshold",
            "thresholds": thresholds,
            "sex_specific_test": item_id in ("strength", "endurance_run"),
        })

    return {
        "standard": "大学生国家体质健康测试评分标准",
        "standard_en": "University student national physical fitness test scoring standard",
        "grade_band": "university",
        "source_pdf": pdf_path.name,
        "extracted_by": "analysis/extract_scoring_tables.py",
        "score_levels": list(SCORE_LEVELS),
        "grade_groups": list(GRADE_GROUPS.values()),
        "grade_to_group": GRADE_TO_GROUP,
        "item_bands": {k: list(v) for k, v in ITEM_BANDS.items()},
        "items": items,
        "bonus": bonus,
        "bonus_note_zh": (
            "引体向上、一分钟仰卧起坐均为高优指标，学生成绩超过单项评分100分后，以超过的次数所"
            "对应的分数进行加分。1000米跑、800米跑均为低优指标，学生成绩低于单项评分100分后，"
            "以减少的秒数所对应的分数进行加分。"
        ),
        "total_band_cutoffs": {
            "$note": (
                "DERIVED, not printed as a total-score table in the source PDF. The source "
                "groups per-ITEM scores under 等级 headings (优秀 100-90, 良好 85-80, 及格 "
                "78-60, 不及格 50-10); these cutoffs apply that same grouping to the weighted "
                "total, which is the conventional reading. Confirm with mentors before any "
                "total-level band is shown to a user."
            ),
            "derived": True,
            "优秀": {"total_min": 90},
            "良好": {"total_min": 80},
            "及格": {"total_min": 60},
            "不及格": {"total_min": 0},
        },
    }


def main() -> None:
    ap = argparse.ArgumentParser(description="Extract the national scoring standard to JSON.")
    ap.add_argument("--pdf", type=Path, default=DEFAULT_PDF)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = ap.parse_args()
    if not args.pdf.exists():
        raise SystemExit(f"Source PDF not found: {args.pdf}")
    tables = extract(args.pdf)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(tables, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {args.out} — {len(tables['items'])} items, weights sum 100, invariants passed.")


if __name__ == "__main__":
    main()
