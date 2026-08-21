"""The non-negotiable constraints, as tests.

These encode ``AGENTS.md`` §Non-negotiable design constraints and §Privacy boundary. They are
here so a future change that violates one fails loudly instead of shipping. Every assertion
below corresponds to a rule a reviewer would otherwise have to remember.
"""

from __future__ import annotations

import pytest

from analysis.indicators import (
    CORRUPT_SOURCE_FIELDS,
    DIMENSIONS,
    EXCLUDED_SOURCE_FIELDS,
    by_id,
    catalogue,
    teacher_visible_ids,
)
from aptams.counterfactual.planner import NON_ACTIONABLE_ITEMS, SAFETY_CAP_SD, Counterfactual
from aptams.layers import DataLayer

# --- Route guardrails ---------------------------------------------------------------------


def test_routes_can_never_be_causal():
    with pytest.raises(ValueError):
        Counterfactual(
            target="pass", target_total=60.0, current_total=50.0, projected_total=60.0,
            changes=(), causal=True,
        )


def test_bmi_is_never_actionable_in_a_route():
    """Proposing a BMI change is a weight-loss target in all but name."""
    assert "bmi" in NON_ACTIONABLE_ITEMS


def test_safety_cap_exists_and_is_bounded():
    assert 0 < SAFETY_CAP_SD <= 2.0


def test_unreachable_target_escalates_instead_of_advising():
    from aptams.counterfactual.planner import plan_routes
    from aptams.rule_engine.models import Sex
    from aptams.rule_engine.tables import ScoringTablesUnavailable, load_scoring_tables

    try:
        tables = load_scoring_tables()
    except (ScoringTablesUnavailable, FileNotFoundError):
        pytest.skip("Scoring tables absent.")

    items = ["bmi", "vital_capacity", "sprint_50m", "standing_long_jump",
             "sit_and_reach", "endurance_run", "strength"]
    # A student far below the gate, in a cohort so tight that every upgrade breaches the cap.
    plan = plan_routes(
        tables=tables,
        student_id="T1",
        sex=Sex.MALE,
        grade="g1",
        raws={"bmi": 22.0, "vital_capacity": 1300, "sprint_50m": 12.0,
              "standing_long_jump": 60.0, "sit_and_reach": -7.0,
              "endurance_run": 500.0, "strength": 0.0},
        item_scores=dict.fromkeys(items, 0.0) | {"bmi": 100.0},
        current_total=15.0,
        cohort_sd=dict.fromkeys(items, 0.001),
        target_total=60.0,
    )
    assert plan.needs_human is True
    assert plan.options == ()
    assert plan.unreachable_reason


# --- Indicator system guardrails ------------------------------------------------------------


def test_all_five_dimensions_are_present():
    dims = {i.dimension for i in catalogue()}
    assert dims == set(DIMENSIONS)


def test_weight_and_fat_targets_are_excluded():
    """AGENTS.md forbids caloric targets, deficit advice and weight-loss goals outright."""
    assert set(EXCLUDED_SOURCE_FIELDS) >= {"目标体重", "体重控制", "脂肪控制"}
    ids = set(by_id())
    for banned in ("target_weight", "weight_control", "fat_control", "muscle_control"):
        assert banned not in ids


def test_self_report_psychology_and_environment_are_never_teacher_visible():
    """Self-report stays with the student; teachers get a non-specific flag only."""
    visible = teacher_visible_ids()
    for ind in catalogue():
        if ind.dimension in {"psychology", "environment"}:
            assert ind.layer is DataLayer.REPORTED
            assert ind.id not in visible, f"{ind.id} must not be teacher-visible"


def test_corrupt_source_fields_are_declared_not_silently_dropped():
    assert "waist_hip_ratio" in CORRUPT_SOURCE_FIELDS
    assert "waist_hip_ratio" in by_id()  # still declared, so the gap stays visible


def test_metabolism_indicators_carry_the_explanatory_only_caveat():
    for ind in catalogue():
        if ind.dimension == "metabolism" and ind.id not in CORRUPT_SOURCE_FIELDS:
            assert "Explanatory only" in ind.notes


# --- Rule base guardrails -------------------------------------------------------------------


def test_non_actionable_features_are_marked():
    from analysis.rule_base import NON_ACTIONABLE_FEATURES, is_actionable

    assert "enrollment_year" in NON_ACTIONABLE_FEATURES
    assert not is_actionable("enrollment_year")
    assert is_actionable("g1_score_endurance_run")
