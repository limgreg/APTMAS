"""Loader for the national-standard scoring tables.

The tables are a **blocking input** (``docs/proposal.md`` §11). They are not in the
repository and are never invented here. Until they are present in the configured directory
(``APTAMS_SCORING_TABLES_DIR``, default ``data/scoring_tables/``),
:func:`load_scoring_tables` raises :class:`ScoringTablesUnavailable`.

The on-disk JSON is produced by ``analysis/extract_scoring_tables.py``, which parses the
official PDF and aborts if the document's structure differs from what it expects. That
script plus the source PDF are the single auditable origin of every scored number in APTAMS
(``AGENTS.md`` §The core premise). Regenerate with::

    python -m analysis.extract_scoring_tables

This module is the only place a raw measurement becomes a score.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


class ScoringTablesUnavailable(RuntimeError):
    """Raised when scoring is attempted without the national-standard tables present.

    Deliberately a hard failure, not a fallback to approximate values. The ground-truth
    claim collapses the moment a threshold is guessed.
    """


class ScoringTableError(RuntimeError):
    """The tables are present but do not cover the requested lookup.

    Also a hard failure: an uncovered lookup means the standard says nothing about this
    case, and inventing an answer is exactly what the project forbids.
    """


def _default_dir() -> Path:
    return Path(os.environ.get("APTAMS_SCORING_TABLES_DIR", "data/scoring_tables"))


#: Score assigned when a raw value falls below the standard's lowest printed threshold.
#:
#: The source prints thresholds down to 10 points and stops. It does not state what a value
#: worse than the 10-point threshold scores. Zero is the only reading consistent with the
#: table being exhaustive downward, and it is confirmed empirically: it reproduces the
#: cohort's own ``total_score`` exactly (see ``analysis/verify_scorecard.py``). Recorded as a
#: named constant rather than a bare literal so the assumption stays visible and auditable.
BELOW_LOWEST_THRESHOLD_SCORE = 0.0


@dataclass(frozen=True)
class ScoringTables:
    """Parsed, validated scoring tables for one operative standard.

    Holds the per-item, per-sex, per-grade-group lookup structures plus item weightings,
    附加分 rules and band cutoffs, and exposes the read-only accessors used by
    :mod:`aptams.rule_engine.engine`. Every accessor either returns a value that came from
    the source document, or raises.
    """

    source_dir: Path
    standard: str
    grade_band: str
    items: dict[str, dict[str, Any]]
    bonus: dict[str, dict[str, Any]]
    grade_to_group: dict[str, str]
    total_band_cutoffs: dict[str, Any]
    raw: dict[str, Any] = field(repr=False, default_factory=dict)

    # --- introspection ---------------------------------------------------------------

    def item_ids(self) -> tuple[str, ...]:
        """Every scored item in the standard, in the source's own weighting order."""
        return tuple(self.items)

    def item(self, item_id: str) -> dict[str, Any]:
        try:
            return self.items[item_id]
        except KeyError:
            raise ScoringTableError(
                f"Item {item_id!r} is not in the loaded standard. Known items: "
                f"{sorted(self.items)}"
            ) from None

    def item_weight(self, *, item: str, band: str | None = None) -> float:
        """The item's weight as a fraction of the total (e.g. 0.20 for 50m sprint).

        ``band`` is accepted for interface compatibility; this standard publishes one
        weighting for the whole 大学 band.
        """
        if band is not None and band != self.grade_band:
            raise ScoringTableError(
                f"Loaded standard covers band {self.grade_band!r}, not {band!r}."
            )
        return float(self.item(item)["weight"]) / 100.0

    def grade_group(self, grade: str) -> str:
        """Map a study year (``g1``..``g4``) to the standard's grade group (大一大二/大三大四)."""
        try:
            return self.grade_to_group[grade]
        except KeyError:
            raise ScoringTableError(
                f"Unknown grade {grade!r}; the standard covers {sorted(self.grade_to_group)}"
            ) from None

    # --- scoring ---------------------------------------------------------------------

    def _thresholds(self, *, item: str, sex: str, grade: str) -> list[list[float]]:
        spec = self.item(item)
        if spec["scoring"] != "threshold":
            raise ScoringTableError(f"Item {item!r} is not threshold-scored.")
        group = self.grade_group(grade)
        try:
            return spec["thresholds"][sex][group]
        except KeyError:
            raise ScoringTableError(
                f"No thresholds for {item!r} / sex={sex!r} / group={group!r}."
            ) from None

    def score_item(
        self, *, item: str, sex: str, grade: str, raw: float, band: str | None = None
    ) -> float:
        """Score one raw measurement, straight from the table. No interpolation.

        The standard is a step function: a value earns the highest printed score whose
        threshold it meets. Intermediate values do **not** interpolate — a male first-year
        with 14 pull-ups scores 76, exactly as printed, because 80 requires 15.
        """
        if band is not None and band != self.grade_band:
            raise ScoringTableError(
                f"Loaded standard covers band {self.grade_band!r}, not {band!r}."
            )
        spec = self.item(item)
        if spec["scoring"] == "categorical":
            return self._score_categorical(spec, sex=sex, raw=raw)

        pairs = self._thresholds(item=item, sex=sex, grade=grade)
        higher_better = spec["direction"] == "higher_is_better"
        best = BELOW_LOWEST_THRESHOLD_SCORE
        for score, threshold in pairs:
            meets = raw >= threshold if higher_better else raw <= threshold
            if meets:
                best = max(best, float(score))
        return best

    @staticmethod
    def _score_categorical(spec: dict[str, Any], *, sex: str, raw: float) -> float:
        """BMI-style scoring: the raw value falls in exactly one category.

        The source prints category bounds to one decimal (低体重 ≤17.8, 正常 17.9~23.9, …),
        but measured BMI is continuous, so the printed bounds leave gaps — a real student at
        BMI 17.8439 sits in none of them. Categories are therefore anchored at their printed
        **lower** bounds: a value belongs to the last category whose lower bound it reaches.
        That tiles the continuous line with no gap and no rounding ambiguity, and preserves
        every printed boundary exactly. Verified against the cohort's own recorded totals.
        """
        ordered = sorted(
            spec["categories"],
            key=lambda c: (
                c[sex]["min"] if c[sex]["min"] is not None else float("-inf")
            ),
        )
        chosen = None
        for cat in ordered:
            lo = cat[sex]["min"]
            if lo is None or raw >= lo:
                chosen = cat
        if chosen is None:
            raise ScoringTableError(
                f"Value {raw} for {spec['id']!r} (sex={sex}) precedes every printed category."
            )
        return float(chosen["score"])

    def threshold_for_score(
        self, *, item: str, sex: str, grade: str, score: float
    ) -> float | None:
        """The raw value the standard requires for exactly ``score``.

        Returns ``None`` where the standard prints no threshold at that score (male pull-ups
        skip 78/74/70/66/62 — those scores are simply unreachable for that item). Used by
        Route-to-Pass to price the next reachable step.
        """
        for s, threshold in self._thresholds(item=item, sex=sex, grade=grade):
            if float(s) == float(score):
                return float(threshold)
        return None

    def reachable_scores(self, *, item: str, sex: str, grade: str) -> tuple[float, ...]:
        """The score levels this item can actually take, ascending. Excludes unprinted ones."""
        pairs = self._thresholds(item=item, sex=sex, grade=grade)
        return tuple(sorted(float(s) for s, _ in pairs))

    # --- 附加分 ------------------------------------------------------------------------

    def bonus_items(self) -> tuple[str, ...]:
        return tuple(self.bonus)

    def bonus_for(self, *, item: str, sex: str, grade: str, raw: float) -> float:
        """附加分 earned on ``item``, per the source's 加分指标评分表.

        Strength is 高优: reps *above* the 100-point threshold earn bonus. Endurance is
        低优: seconds *below* it earn bonus. Items with no bonus table earn nothing.
        """
        spec = self.bonus.get(item)
        if spec is None:
            return 0.0
        hundred = self.threshold_for_score(item=item, sex=sex, grade=grade, score=100)
        if hundred is None:
            raise ScoringTableError(f"No 100-point threshold for {item!r}; cannot price bonus.")
        margin = (raw - hundred) if spec["direction"] == "higher_is_better" else (hundred - raw)
        if margin <= 0:
            return 0.0
        group = self.grade_group(grade)
        try:
            pairs = spec["thresholds"][sex][group]
        except KeyError:
            raise ScoringTableError(
                f"No bonus table for {item!r} / sex={sex!r} / group={group!r}."
            ) from None
        earned = 0.0
        for points, needed in pairs:
            if margin >= needed:
                earned = max(earned, float(points))
        return min(earned, float(spec["max_bonus"]))

    # --- bands -------------------------------------------------------------------------

    def grade_band_for_total(self, *, total: float, band: str | None = None) -> str:
        """The 等级 label for a weighted total.

        Note these cutoffs are marked ``derived`` in the extracted tables: the source prints
        等级 groupings for per-*item* scores, not for the total. See the ``$note`` field.
        """
        if band is not None and band != self.grade_band:
            raise ScoringTableError(
                f"Loaded standard covers band {self.grade_band!r}, not {band!r}."
            )
        labelled = [
            (label, spec["total_min"])
            for label, spec in self.total_band_cutoffs.items()
            if isinstance(spec, dict) and "total_min" in spec
        ]
        for label, minimum in sorted(labelled, key=lambda kv: -kv[1]):
            if total >= minimum:
                return label
        raise ScoringTableError(f"No band covers total {total}.")

    @property
    def total_band_cutoffs_are_derived(self) -> bool:
        """True while the total-level cutoffs remain an inference awaiting mentor confirmation."""
        return bool(self.total_band_cutoffs.get("derived", False))


def _validate(payload: dict[str, Any], source_dir: Path) -> ScoringTables:
    """Validate the parsed JSON before any of it is trusted for scoring."""
    for key in ("standard", "grade_band", "items", "bonus", "grade_to_group"):
        if key not in payload:
            raise ScoringTableError(f"Scoring tables in {source_dir} lack required key {key!r}.")

    items = {spec["id"]: spec for spec in payload["items"]}
    if not items:
        raise ScoringTableError(f"Scoring tables in {source_dir} contain no items.")

    total_weight = sum(float(spec["weight"]) for spec in items.values())
    if round(total_weight, 6) != 100.0:
        raise ScoringTableError(
            f"Item weights sum to {total_weight}, not 100 — refusing to score with a "
            "weighting that does not match the standard."
        )
    for item_id, spec in items.items():
        if spec["scoring"] not in {"threshold", "categorical"}:
            raise ScoringTableError(f"Item {item_id!r} has unknown scoring {spec['scoring']!r}.")

    return ScoringTables(
        source_dir=source_dir,
        standard=payload["standard"],
        grade_band=payload["grade_band"],
        items=items,
        bonus=payload.get("bonus", {}),
        grade_to_group=payload["grade_to_group"],
        total_band_cutoffs=payload.get("total_band_cutoffs", {}),
        raw=payload,
    )


def load_scoring_tables(source_dir: str | os.PathLike[str] | None = None) -> ScoringTables:
    """Load and validate the scoring tables from ``source_dir``.

    Raises :class:`ScoringTablesUnavailable` if the directory holds no table data — the T0
    state, and the state any teammate is in before running the extractor.
    """
    path = Path(source_dir) if source_dir is not None else _default_dir()

    table_files = [
        p
        for p in sorted(path.glob("*"))
        if p.is_file()
        and p.suffix.lower() in {".json", ".csv", ".xlsx", ".yaml", ".yml"}
        and not p.name.endswith(".example.json")
    ]
    if not table_files:
        raise ScoringTablesUnavailable(
            f"No scoring tables found in {path!s}. The 《大学生国家体质健康测试评分标准》 tables "
            "are a blocking input and are never guessed. Generate them from the source PDF "
            "with:  python -m analysis.extract_scoring_tables"
        )
    if len(table_files) > 1:
        raise ScoringTableError(
            f"Expected exactly one scoring-table file in {path!s}, found "
            f"{[p.name for p in table_files]}. Ambiguous tables are refused rather than "
            "silently picking one."
        )

    payload = json.loads(table_files[0].read_text(encoding="utf-8"))
    return _validate(payload, path)
