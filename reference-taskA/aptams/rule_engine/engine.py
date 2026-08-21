"""The deterministic scoring pipeline.

Structure is fixed here; numbers come exclusively from :class:`ScoringTables`. The pipeline
is pure and side-effect-free by design — the same inputs and tables always produce the same
output, which is what lets the attribution and counterfactual layers treat it as ground
truth and lets us generate synthetic cohorts before any real data arrives.

Total = Σ(item score × item weight) + 附加分. The bonus is *added on top of* the weighted
total and the result is **not** capped at 100 — verified against the cohort's own recorded
totals, which reach 104.4 (``analysis/verify_scorecard.py``).
"""

from __future__ import annotations

from aptams.rule_engine.models import ItemScore, StudentAssessment, TotalScore
from aptams.rule_engine.tables import ScoringTables


def score_student(assessment: StudentAssessment, tables: ScoringTables) -> TotalScore:
    """Score one student's 体测 record: measurements → item scores → weighted total → band.

    Every number is read from ``tables``; this function only orchestrates lookups and the
    weighting arithmetic defined by the standard. Raises whatever ``tables`` raises when a
    required value is absent — never substitutes a guess.
    """
    item_scores: list[ItemScore] = []
    weighted_total = 0.0
    total_bonus = 0.0

    for m in assessment.measurements:
        score = tables.score_item(
            item=m.item,
            sex=assessment.sex.value,
            grade=assessment.grade,
            raw=m.value,
        )
        weight = tables.item_weight(item=m.item)
        bonus = tables.bonus_for(
            item=m.item,
            sex=assessment.sex.value,
            grade=assessment.grade,
            raw=m.value,
        )
        item_scores.append(
            ItemScore(
                item=m.item,
                raw=m.value,
                score=score,
                bonus=bonus,
                weight=weight,
                band=band_for_item_score(score, tables),
            )
        )
        weighted_total += score * weight
        total_bonus += bonus

    total = weighted_total + total_bonus
    return TotalScore(
        total=total,
        weighted_total=weighted_total,
        bonus=total_bonus,
        band=tables.grade_band_for_total(total=total),
        band_is_derived=tables.total_band_cutoffs_are_derived,
        items=tuple(item_scores),
    )


def band_for_item_score(score: float, tables: ScoringTables) -> str:
    """The 等级 label the source prints against a per-item score.

    Unlike the total-level cutoffs, these groupings are printed explicitly in the source
    table's leftmost column, so this mapping is exact rather than derived.
    """
    for label, levels in tables.raw.get("item_bands", {}).items():
        if score in levels:
            return label
    # Scores below the lowest printed threshold fall outside every printed 等级 group.
    return "不及格"
