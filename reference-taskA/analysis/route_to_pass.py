"""② Route-to-Pass — "what is the fastest way for me to pass?"

Wraps the exact search in :mod:`aptams.counterfactual.planner` with the cohort statistics it
needs. The search itself is pure arithmetic over the scoring table; this module supplies the
per-item standard deviations that price effort, and the pass threshold.

The pass rule is **derived from the data, not assumed**: across all 20,140 students in
``student_2024_scholarship_status.csv``, ``pass_scholarship`` is exactly
``evaluation-year total_score >= 60.0`` — the lowest passing score is 60.0 and the highest
failing score is 59.9, a clean separation with no overlap. See :data:`PASS_THRESHOLD`.
"""

from __future__ import annotations

from functools import lru_cache

import pandas as pd

from analysis.loaders import ITEM_UNITS, load_scholarship, panel_long
from analysis.scorecard import score_frame
from aptams.counterfactual.planner import RoutePlan, plan_routes
from aptams.rule_engine.models import Sex
from aptams.rule_engine.tables import ScoringTables, load_scoring_tables

#: Total score at or above which the scholarship is awarded. Empirically identified — see the
#: module docstring and :func:`verify_pass_threshold`.
PASS_THRESHOLD = 60.0


def verify_pass_threshold(threshold: float = PASS_THRESHOLD) -> dict[str, float]:
    """Re-derive the pass rule from the scholarship file. Returns a small evidence dict.

    Kept runnable so the claim stays checkable rather than becoming folklore.
    """
    s = load_scholarship()
    by_grade = {"大二": "total_score_g2", "大三": "total_score_g3", "大四": "total_score_g4"}
    eval_score = pd.Series(
        [row[by_grade[row["eval_grade"]]] for _, row in s.iterrows()], index=s.index
    )
    passed = s["pass_scholarship"].astype(bool)
    predicted = eval_score >= threshold
    return {
        "n": float(len(s)),
        "agreement": float((predicted == passed).mean()),
        "min_score_among_passers": float(eval_score[passed].min()),
        "max_score_among_failers": float(eval_score[~passed].max()),
    }


@lru_cache(maxsize=1)
def cohort_sd() -> dict[tuple[str, str], dict[str, float]]:
    """Per (sex, grade) standard deviation of each item — the unit effort is measured in.

    Using the cohort's own spread keeps effort data-driven while the mentor-supplied expert
    rules (``data/expert_rules/``) are still outstanding. It is a *ranking* device, not a
    claim about training time; the human-readable estimate stays ``PLACEHOLDER``.
    """
    long = panel_long()
    out: dict[tuple[str, str], dict[str, float]] = {}
    for (sex, grade), grp in long.groupby(["sex", "grade"]):
        out[(sex, grade)] = {item: float(grp[item].std()) for item in ITEM_UNITS}
    return out


def route_for_row(
    row: pd.Series,
    scored: pd.Series,
    tables: ScoringTables | None = None,
    *,
    target_total: float = PASS_THRESHOLD,
) -> RoutePlan:
    """Plan routes for one student-year.

    ``row`` is a row of :func:`analysis.loaders.panel_long`; ``scored`` the matching row of
    :func:`analysis.scorecard.score_frame`.
    """
    tables = tables or load_scoring_tables()
    sds = cohort_sd()[(row["sex"], row["grade"])]
    return plan_routes(
        tables=tables,
        student_id=str(row["student_id"]),
        sex=Sex(row["sex"]),
        grade=str(row["grade"]),
        raws={item: float(row[item]) for item in ITEM_UNITS},
        item_scores={item: float(scored[f"score_{item}"]) for item in ITEM_UNITS},
        current_total=float(scored["total"]),
        cohort_sd=sds,
        target_total=target_total,
        target="pass",
    )


def routes_for_frame(
    long: pd.DataFrame, tables: ScoringTables | None = None, *, limit: int | None = None
) -> list[RoutePlan]:
    """Plan routes for a frame of student-years (used for reporting and fixtures)."""
    tables = tables or load_scoring_tables()
    scored = score_frame(long, tables)
    subset = long if limit is None else long.head(limit)
    return [
        route_for_row(row, scored.loc[idx], tables)
        for idx, row in subset.iterrows()
    ]


def summarise(plans: list[RoutePlan]) -> pd.DataFrame:
    """One row per plan — the shape used in reports and the hand-off object."""
    rows = []
    for p in plans:
        best = p.options[0] if p.options else None
        rows.append({
            "student_id": p.student_id,
            "current_total": p.current_total,
            "already_passing": p.already_met,
            "needs_human": p.needs_human,
            "n_options": len(p.options),
            "best_effort_sd": best.effort_sd if best else None,
            "best_n_changes": len(best.changes) if best else None,
            "best_items": "+".join(c.item for c in best.changes) if best else None,
            "projected_total": best.projected_total if best else None,
        })
    return pd.DataFrame(rows)
