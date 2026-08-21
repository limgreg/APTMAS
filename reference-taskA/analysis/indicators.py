"""⑤ Indicator System (objective **A1**) — the five-dimension indicator catalogue.

A1 requires a multi-dimensional indicator system spanning **fitness, metabolism, psychology,
environment and behaviour**, grounded in the national standard and WHO guidance. This module
is that catalogue: a typed, documented registry where every indicator declares its dimension,
its **data layer** (verified / measured / reported), unit, direction, source file, and whether
a teacher may ever see it raw.

The layer tag is not decoration. ``AGENTS.md`` §Data layers makes it a correctness
requirement: any user-facing statement must signal which layer it rests on, and a statement
combining layers inherits the weakest one.

Sources actually populating each dimension today:

===============  ==========  ====================================================
Dimension        Layer       Source
===============  ==========  ====================================================
fitness          verified    PFT panel, scored under the national standard
metabolism       measured    SZU 2024 InBody body composition (n=297)
behaviour        reported    SZU 体质测试卡片 Q2/Q3/Q6 + WHO reference
environment      reported    SZU 体质测试卡片 Q5 (venues) + Q7 (barriers)
psychology       reported    SZU 体质测试卡片 Q4 (motivation); mood/stress/wellbeing
                             await the self-report survey in ``docs/self_report_survey.md``
===============  ==========  ====================================================

**Excluded on purpose.** The InBody export contains 目标体重, 体重控制, 脂肪控制 and 肌肉控制
— literal weight and fat-loss targets. They are refused entry to the catalogue: ``AGENTS.md``
forbids caloric targets, deficit advice and weight-loss goals outright, and body composition
is explanatory only. See :data:`EXCLUDED_SOURCE_FIELDS`.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

import pandas as pd

from aptams.layers import DataLayer

DEFAULT_CATALOGUE = Path("analysis/reports/indicator_catalogue.json")
DEFAULT_TABLE = Path("analysis/reports/indicator_catalogue.md")
SZU_BODY_COMP = Path("data/ML/深圳大学成年甲组体测数据带体成分的初步删掉极值.xlsx")

#: Source columns deliberately kept out of the system. Each is a weight/fat *target*, which
#: this project does not compute, store, or surface under any framing (``AGENTS.md``).
EXCLUDED_SOURCE_FIELDS = {
    "目标体重": "A goal weight. Weight-loss goals are forbidden.",
    "体重控制": "A prescribed weight change. Forbidden.",
    "脂肪控制": "A prescribed fat change. Forbidden.",
    "肌肉控制": "A prescribed muscle change; paired with the fat target, reads as a body plan.",
}


#: Source columns present in the export but unusable, with the evidence. Kept in the
#: catalogue as declared-but-unavailable rather than silently dropped, so the gap is visible
#: and can be raised with the mentors instead of quietly becoming missing data.
CORRUPT_SOURCE_FIELDS = {
    "waist_hip_ratio": (
        "PENDING COLLECTION — the SZU export's 腰臀比 column is a verbatim duplicate of "
        "基础代谢率 in all 297 rows (values 962-2267, which are BMR kcal/day, not a ratio). "
        "The real waist-hip ratio is absent. Re-request from the mentors; the loader refuses "
        "to emit this field rather than pass corrupt values downstream."
    ),
}


@dataclass(frozen=True)
class Indicator:
    """One indicator in the system, with everything a consumer needs to use it safely."""

    id: str
    label_zh: str
    label_en: str
    dimension: str  # fitness | metabolism | behaviour | psychology | environment
    layer: DataLayer
    unit: str | None
    direction: str  # higher_is_better | lower_is_better | band_optimal | categorical
    source: str
    teacher_visible: bool
    scored: bool = False  # contributes to the national-standard total
    reference: dict[str, Any] | None = None  # e.g. WHO guideline bounds
    notes: str = ""
    codes: dict[int, str] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["layer"] = self.layer.value
        d["claim_strength"] = self.layer.claim_strength
        d["codes"] = {str(k): v for k, v in self.codes.items()} or None
        return d


# --- Code books, transcribed from 体质测定卡片.docx ------------------------------------------

INTENSITY_CODES = {
    1: "中等及以上强度，≥30分钟 / moderate-vigorous, ≥30 min",
    2: "中等及以上强度，<30分钟 / moderate-vigorous, <30 min",
    3: "小强度，≥30分钟 / light, ≥30 min",
    4: "小强度，<30分钟 / light, <30 min",
}

MOTIVE_CODES = {
    1: "强身健体 / general health", 2: "健美塑形 / physique", 3: "减肥瘦身 / weight loss",
    4: "休闲娱乐 / recreation", 5: "结交朋友 / social", 6: "防病治病 / prevent illness",
    7: "缓解生活/工作压力 / stress relief", 8: "锻炼意志力 / build willpower",
    9: "提高运动技能 / skill", 10: "其他 / other",
}

VENUE_CODES = {
    1: "小区内 / within residential compound", 2: "家里 / at home",
    3: "居住地附近的公园 / nearby park", 4: "小区附近的健身场所 / nearby fitness facility",
    5: "公共体育场馆 / public sports venue", 6: "商业体育场馆 / commercial venue",
    7: "学校体育场馆 / campus sports venue", 8: "单位内部体育健身场所 / workplace facility",
    9: "其他 / other",
}

BARRIER_CODES = {
    1: "身体很好，不用参加 / feels no need", 2: "身体弱，不宜参加 / feels unable",
    3: "体力工作多 / physically demanding work", 4: "家务忙，缺少时间 / no time (household)",
    5: "工作忙，缺少时间 / no time (work or study)", 6: "缺乏场地设施 / no facilities",
    7: "缺乏锻炼知识或指导 / no guidance", 8: "缺乏组织 / no organised activity",
    9: "没兴趣 / no interest", 10: "惰性 / inertia", 11: "怕受伤 / fear of injury",
    12: "经济条件限制 / cost", 13: "认为没必要 / sees no point", 14: "其他 / other",
}

ACTIVITY_CODES = {
    1: "长跑 / distance running", 2: "慢跑 / jogging", 3: "健步走 / brisk walking",
    4: "跳绳踢毽 / rope & shuttlecock", 5: "篮球 / basketball", 6: "羽毛球 / badminton",
    7: "乒乓球 / table tennis", 8: "足球 / football", 9: "游泳 / swimming",
    10: "排球 / volleyball", 11: "网球 / tennis", 12: "瑜伽 / yoga",
    13: "健美操广场舞 / aerobics & square dance", 14: "体育游戏 / active games",
    15: "户外（自行车、登山）/ outdoor", 16: "健身房健身 / gym", 17: "其他 / other",
}

#: WHO physical-activity guidance for adults 18+. Referenced, never used as a score.
WHO_ADULT_ACTIVITY = {
    "clause_id": "who:pa-adult-150",
    "moderate_min_per_week": 150,
    "moderate_max_per_week": 300,
    "strengthening_sessions_per_week": 2,
    "source": "WHO Guidelines on physical activity and sedentary behaviour (2020), adults 18-64",
}


def _fitness_indicators() -> list[Indicator]:
    """The seven scored panel items. Layer: verified — scored under the national standard."""
    spec = [
        ("bmi", "体重指数", "Body mass index", "kg/m2", "band_optimal",
         "Explanatory only. Never a weight target; excluded from Route-to-Pass."),
        ("vital_capacity", "肺活量", "Vital capacity", "ml", "higher_is_better", ""),
        ("sprint_50m", "50米跑", "50m sprint", "s", "lower_is_better", ""),
        ("standing_long_jump", "立定跳远", "Standing long jump", "cm", "higher_is_better", ""),
        ("sit_and_reach", "坐位体前屈", "Sit and reach", "cm", "higher_is_better", ""),
        ("endurance_run", "1000米跑（男）/800米跑（女）", "Endurance run", "s",
         "lower_is_better", "Where the g1→g4 decline concentrates."),
        ("strength", "引体向上（男）/一分钟仰卧起坐（女）", "Pull-ups (M) / sit-ups (F)",
         "count", "higher_is_better", ""),
    ]
    return [
        Indicator(
            id=i, label_zh=zh, label_en=en, dimension="fitness", layer=DataLayer.VERIFIED,
            unit=u, direction=d, source="PFT panel (pft.csv), scored by the rule engine",
            teacher_visible=True, scored=True, notes=n,
        )
        for i, zh, en, u, d, n in spec
    ]


def _metabolism_indicators() -> list[Indicator]:
    """InBody body composition. Layer: measured — observed, not scored by the standard."""
    spec = [
        ("body_fat_pct", "体脂率/体脂百分比", "Body fat percentage", "%", "band_optimal"),
        ("skeletal_muscle", "骨骼肌", "Skeletal muscle mass", "kg", "higher_is_better"),
        ("basal_metabolic_rate", "基础代谢率", "Basal metabolic rate", "kcal/day",
         "band_optimal"),
        ("waist_hip_ratio", "腰臀比", "Waist-hip ratio", "ratio", "band_optimal"),
        ("fat_free_mass", "去脂体重", "Fat-free mass", "kg", "higher_is_better"),
        ("body_water", "身体总水分", "Total body water", "kg", "band_optimal"),
    ]
    base_note = (
        "Explanatory only. Never rendered as a target, a deficit, or a goal; no caloric or "
        "weight-loss framing may be derived from it (AGENTS.md)."
    )
    return [
        Indicator(
            id=i, label_zh=zh, label_en=en, dimension="metabolism", layer=DataLayer.MEASURED,
            unit=u, direction=d, source="SZU 2024 InBody export (n=297)", teacher_visible=True,
            notes=(CORRUPT_SOURCE_FIELDS[i] if i in CORRUPT_SOURCE_FIELDS else base_note),
        )
        for i, zh, en, u, d in spec
    ]


def _behaviour_indicators() -> list[Indicator]:
    return [
        Indicator(
            id="exercise_freq_per_week", label_zh="每周锻炼频数",
            label_en="Exercise sessions per week", dimension="behaviour",
            layer=DataLayer.REPORTED, unit="sessions/wk", direction="higher_is_better",
            source="SZU 体质测试卡片 Q2", teacher_visible=True,
            reference=WHO_ADULT_ACTIVITY,
            notes="Self-reported count, 0-15. Combined with Q3 to estimate weekly minutes.",
        ),
        Indicator(
            id="exercise_intensity", label_zh="活动强度与时长",
            label_en="Session intensity and duration", dimension="behaviour",
            layer=DataLayer.REPORTED, unit=None, direction="categorical",
            source="SZU 体质测试卡片 Q3", teacher_visible=True, codes=INTENSITY_CODES,
            reference=WHO_ADULT_ACTIVITY,
        ),
        Indicator(
            id="weekly_moderate_minutes", label_zh="每周中等强度活动时间（估算）",
            label_en="Estimated weekly moderate-intensity minutes", dimension="behaviour",
            layer=DataLayer.REPORTED, unit="min/wk", direction="higher_is_better",
            source="Derived from SZU Q2 × Q3", teacher_visible=True,
            reference=WHO_ADULT_ACTIVITY,
            notes=(
                "Derived, therefore REPORTED like its inputs — a derivation can never raise "
                "claim strength (aptams.layers). Compared against the WHO 150-300 min/week "
                "band as a reference, never as a score or a target."
            ),
        ),
        Indicator(
            id="sleep_hours", label_zh="每晚睡眠时长", label_en="Nightly sleep duration",
            dimension="behaviour", layer=DataLayer.REPORTED, unit="hours", direction="band_optimal",
            source="Self-report survey Q10 (to be fielded)", teacher_visible=False,
            notes="PENDING COLLECTION — docs/self_report_survey.md.",
        ),
        Indicator(
            id="activity_types", label_zh="锻炼项目", label_en="Activity types",
            dimension="behaviour", layer=DataLayer.REPORTED, unit=None, direction="categorical",
            source="SZU 体质测试卡片 Q6", teacher_visible=True, codes=ACTIVITY_CODES,
            notes="Up to three. Useful for tailoring suggestions to what a student already does.",
        ),
    ]


def _environment_indicators() -> list[Indicator]:
    return [
        Indicator(
            id="facility_access", label_zh="锻炼场所", label_en="Exercise venues used",
            dimension="environment", layer=DataLayer.REPORTED, unit=None,
            direction="categorical", source="SZU 体质测试卡片 Q5", teacher_visible=False,
            codes=VENUE_CODES,
            notes="Proxy for facility access. Self-report — never shown raw to a teacher.",
        ),
        Indicator(
            id="participation_barriers", label_zh="影响锻炼的主要原因",
            label_en="Barriers to participation", dimension="environment",
            layer=DataLayer.REPORTED, unit=None, direction="categorical",
            source="SZU 体质测试卡片 Q7", teacher_visible=False, codes=BARRIER_CODES,
            notes=(
                "Mixed environmental (6 facilities, 5 time, 12 cost) and psychological "
                "(9 no interest, 10 inertia, 11 fear of injury) barriers. Code 11 怕受伤 is "
                "an injury-safety signal and should raise needs_human rather than advice."
            ),
        ),
        Indicator(
            id="study_load", label_zh="学业负担", label_en="Study load",
            dimension="environment", layer=DataLayer.REPORTED, unit="hours/wk",
            direction="lower_is_better", source="Self-report survey (to be fielded)",
            teacher_visible=False,
            notes="PENDING COLLECTION — see docs/self_report_survey.md, blocked on consent.",
        ),
        Indicator(
            id="active_commute", label_zh="通勤方式", label_en="Active commute",
            dimension="environment", layer=DataLayer.REPORTED, unit="min/day",
            direction="higher_is_better", source="Self-report survey (to be fielded)",
            teacher_visible=False, notes="PENDING COLLECTION — see docs/self_report_survey.md.",
        ),
    ]


def _psychology_indicators() -> list[Indicator]:
    return [
        Indicator(
            id="exercise_motivation", label_zh="锻炼目的", label_en="Exercise motivation",
            dimension="psychology", layer=DataLayer.REPORTED, unit=None,
            direction="categorical", source="SZU 体质测试卡片 Q4", teacher_visible=False,
            codes=MOTIVE_CODES,
            notes=(
                "Codes 2 健美塑形 and 3 减肥瘦身 are recorded as a student's stated reason "
                "only. The system must never echo, reinforce, or build advice on a "
                "weight-loss or physique motive (AGENTS.md)."
            ),
        ),
        Indicator(
            id="stress_relief_motive", label_zh="以缓解压力为锻炼目的",
            label_en="Exercises for stress relief", dimension="psychology",
            layer=DataLayer.REPORTED, unit=None, direction="categorical",
            source="Derived from SZU Q4 = 7", teacher_visible=False,
            notes="The only stress-related signal available before the survey is fielded.",
        ),
        Indicator(
            id="exercise_self_efficacy", label_zh="运动自我效能",
            label_en="Exercise self-efficacy", dimension="psychology",
            layer=DataLayer.REPORTED, unit="1-5", direction="higher_is_better",
            source="Self-report survey Q4 (to be fielded)", teacher_visible=False,
            notes=(
                "PENDING COLLECTION — docs/self_report_survey.md. Chosen over any physique or "
                "weight motive item because it is body-neutral and behaviourally predictive."
            ),
        ),
        Indicator(
            id="mood", label_zh="情绪状态", label_en="Mood", dimension="psychology",
            layer=DataLayer.REPORTED, unit=None, direction="categorical",
            source="Self-report survey (to be fielded)", teacher_visible=False,
            notes="PENDING COLLECTION — docs/self_report_survey.md. Non-clinical, body-neutral.",
        ),
        Indicator(
            id="perceived_stress", label_zh="压力感受", label_en="Perceived stress",
            dimension="psychology", layer=DataLayer.REPORTED, unit="1-5",
            direction="lower_is_better", source="Self-report survey (to be fielded)",
            teacher_visible=False, notes="PENDING COLLECTION — docs/self_report_survey.md.",
        ),
        Indicator(
            id="general_wellbeing", label_zh="总体幸福感", label_en="General wellbeing",
            dimension="psychology", layer=DataLayer.REPORTED, unit="1-5",
            direction="higher_is_better", source="Self-report survey (to be fielded)",
            teacher_visible=False, notes="PENDING COLLECTION — docs/self_report_survey.md.",
        ),
    ]


def catalogue() -> tuple[Indicator, ...]:
    """The full five-dimension indicator system."""
    return tuple([
        *_fitness_indicators(),
        *_metabolism_indicators(),
        *_behaviour_indicators(),
        *_environment_indicators(),
        *_psychology_indicators(),
    ])


DIMENSIONS = ("fitness", "metabolism", "behaviour", "psychology", "environment")


def by_id() -> dict[str, Indicator]:
    return {i.id: i for i in catalogue()}


def teacher_visible_ids() -> frozenset[str]:
    """Indicator ids a teacher-facing view may render. Enforced server-side as well."""
    return frozenset(i.id for i in catalogue() if i.teacher_visible)


def coverage() -> pd.DataFrame:
    """Per dimension: how many indicators exist, and how many are populated today."""
    rows = []
    for dim in DIMENSIONS:
        items = [i for i in catalogue() if i.dimension == dim]
        populated = [i for i in items if "PENDING COLLECTION" not in i.notes]
        rows.append({
            "dimension": dim,
            "layer": items[0].layer.value,
            "indicators": len(items),
            "populated_now": len(populated),
            "pending_survey": len(items) - len(populated),
        })
    return pd.DataFrame(rows)


# --- Pilot values from the SZU file ----------------------------------------------------------

SZU_COLUMN_MAP = {
    "body_fat_pct": "体脂率/体脂百分比",
    "skeletal_muscle": "骨骼肌",
    "basal_metabolic_rate": "基础代谢率",
    "fat_free_mass": "去脂体重",
    "body_water": "身体总水分",
    "exercise_freq_per_week": "是否锻炼",
    "exercise_intensity": "活动强度",
}

#: Midpoint minutes implied by each Q3 intensity/duration code, for the WHO comparison.
#: Deliberately conservative and clearly an estimate — flagged as derived+reported.
INTENSITY_MINUTES = {1: 45.0, 2: 20.0, 3: 0.0, 4: 0.0}


def load_pilot() -> pd.DataFrame:
    """Load the SZU multidimensional pilot (n=297) into catalogue-named columns."""
    if not SZU_BODY_COMP.exists():
        raise FileNotFoundError(
            f"{SZU_BODY_COMP} not found. Real data is git-ignored; obtain it from the team."
        )
    raw = pd.read_excel(SZU_BODY_COMP)
    out = pd.DataFrame(index=raw.index)
    out["student_id"] = raw["姓名"].astype(str)
    out["sex"] = raw["性别"].map({"男": "male", "女": "female"})
    for ind_id, col in SZU_COLUMN_MAP.items():
        if col in raw.columns:
            out[ind_id] = pd.to_numeric(raw[col], errors="coerce")
    # Only moderate-or-above intensity counts toward the WHO comparison.
    out["weekly_moderate_minutes"] = out["exercise_freq_per_week"].fillna(0) * out[
        "exercise_intensity"
    ].map(INTENSITY_MINUTES).fillna(0.0)
    for ind_id, cols in (
        ("exercise_motivation", ["锻炼目的1", "锻炼目的2", "锻炼目的3"]),
        ("facility_access", ["锻炼场所1", "锻炼场所2", "锻炼场所3"]),
        ("activity_types", ["锻炼项目1", "锻炼项目2", "锻炼项目3"]),
        ("participation_barriers", ["原因1", "原因2", "原因3"]),
    ):
        present = [c for c in cols if c in raw.columns]
        out[ind_id] = raw[present].apply(
            lambda r: [int(v) for v in r.dropna().tolist()], axis=1
        )
    out["stress_relief_motive"] = out["exercise_motivation"].apply(lambda v: 7 in v)

    # The export ships 腰臀比 as a copy of 基础代谢率 (see CORRUPT_SOURCE_FIELDS). If a future
    # export fixes it, this check tells us so instead of leaving the field silently absent.
    if "腰臀比" in raw.columns and not raw["腰臀比"].equals(raw["基础代谢率"]):
        raise ValueError(
            "腰臀比 is no longer a duplicate of 基础代谢率 — the source export appears fixed. "
            "Remove waist_hip_ratio from CORRUPT_SOURCE_FIELDS and restore it to "
            "SZU_COLUMN_MAP."
        )
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description="Emit the A1 indicator catalogue.")
    ap.add_argument("--json", type=Path, default=DEFAULT_CATALOGUE)
    ap.add_argument("--table", type=Path, default=DEFAULT_TABLE)
    args = ap.parse_args()
    args.json.parent.mkdir(parents=True, exist_ok=True)

    items = catalogue()
    payload = {
        "objective": "A1 — multi-dimensional indicator system",
        "dimensions": list(DIMENSIONS),
        "layers": [layer.value for layer in DataLayer],
        "who_reference": WHO_ADULT_ACTIVITY,
        "excluded_source_fields": EXCLUDED_SOURCE_FIELDS,
        "indicators": [i.to_dict() for i in items],
    }
    args.json.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    cov = coverage()
    lines = [
        "# A1 — Indicator System\n",
        "Generated by `python -m analysis.indicators`. Every indicator declares its dimension,",
        "data layer, unit, direction, source and teacher visibility.\n",
        "## Coverage by dimension\n",
        cov.to_markdown(index=False),
        "\n## Excluded on purpose\n",
        "| Source field | Why it is refused |",
        "|---|---|",
        *[f"| {k} | {v} |" for k, v in EXCLUDED_SOURCE_FIELDS.items()],
        "\n## Catalogue\n",
        "| id | dimension | layer | unit | direction | teacher-visible | source |",
        "|---|---|---|---|---|---|---|",
        *[
            f"| `{i.id}` | {i.dimension} | {i.layer.value} | {i.unit or '—'} | {i.direction} "
            f"| {'yes' if i.teacher_visible else '**no**'} | {i.source} |"
            for i in items
        ],
    ]
    args.table.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(cov.to_string(index=False))
    print(f"\n{len(items)} indicators across {len(DIMENSIONS)} dimensions.")
    print(f"Wrote {args.json} and {args.table}")


if __name__ == "__main__":
    main()
