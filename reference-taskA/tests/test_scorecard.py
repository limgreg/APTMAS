"""The Scorecard's two code paths must never disagree, and neither may invent a value.

Tests needing real data skip cleanly when it is absent — the panel is git-ignored, so a
teammate with a fresh clone still gets a green run.
"""

from __future__ import annotations

import pytest

from aptams.rule_engine.tables import (
    ScoringTableError,
    ScoringTablesUnavailable,
    load_scoring_tables,
)


@pytest.fixture(scope="module")
def tables():
    try:
        return load_scoring_tables()
    except (ScoringTablesUnavailable, FileNotFoundError):
        pytest.skip("Scoring tables absent — run `python -m analysis.extract_scoring_tables`.")


@pytest.fixture(scope="module")
def panel():
    pytest.importorskip("pandas")
    from analysis.loaders import DataUnavailable, panel_long

    try:
        return panel_long()
    except (DataUnavailable, FileNotFoundError):
        pytest.skip("Real panel data absent (git-ignored).")


def test_weights_sum_to_one(tables):
    total = sum(tables.item_weight(item=i) for i in tables.item_ids())
    assert total == pytest.approx(1.0)


def test_seven_scored_items(tables):
    assert len(tables.item_ids()) == 7


def test_grade_groups_map_as_the_standard_prints_them(tables):
    assert tables.grade_group("g1") == tables.grade_group("g2")
    assert tables.grade_group("g3") == tables.grade_group("g4")
    assert tables.grade_group("g1") != tables.grade_group("g3")


def test_unknown_grade_is_refused_not_guessed(tables):
    with pytest.raises(ScoringTableError):
        tables.grade_group("g9")


def test_unknown_item_is_refused_not_guessed(tables):
    with pytest.raises(ScoringTableError):
        tables.score_item(item="javelin", sex="male", grade="g1", raw=10.0)


def test_scoring_is_a_step_function_not_interpolated(tables):
    """A value between printed thresholds earns the lower printed score, never a blend."""
    male_pullups = tables.reachable_scores(item="strength", sex="male", grade="g1")
    # The standard prints no threshold at 78 for male pull-ups, so it is unreachable.
    assert 78 not in male_pullups
    at_80 = tables.threshold_for_score(item="strength", sex="male", grade="g1", score=80)
    scored = tables.score_item(item="strength", sex="male", grade="g1", raw=at_80 - 0.5)
    assert scored < 80
    assert scored in male_pullups


def test_bmi_categories_cover_the_continuous_line(tables):
    """Measured BMI is continuous; every value must land in exactly one category."""
    for sex in ("male", "female"):
        previous = None
        for raw in [x / 10 for x in range(120, 400)]:
            score = tables.score_item(item="bmi", sex=sex, grade="g1", raw=raw)
            assert score in {60.0, 80.0, 100.0}
            previous = score
        assert previous == 60.0  # the top of the range is 肥胖


def test_below_lowest_threshold_scores_zero(tables):
    """The standard stops printing at 10 points; worse than that is 0, never extrapolated."""
    worst = min(
        t for _s, t in tables.item("vital_capacity")["thresholds"]["male"]["g1g2"]
    )
    assert tables.score_item(
        item="vital_capacity", sex="male", grade="g1", raw=worst - 1
    ) == 0.0


def test_vectorised_path_matches_the_engine(tables, panel):
    """The fast path is a shortcut, not a second source of truth."""
    from analysis.scorecard import round_total, score_frame, score_one

    sample = panel.sample(300, random_state=7)
    scored = score_frame(sample, tables)
    for idx, row in sample.iterrows():
        assert round_total(score_one(row, tables).total) == scored.loc[idx, "total"]


def test_total_is_not_capped_at_100(tables, panel):
    """附加分 is added on top; the recorded data reaches 104.4, so we must too."""
    from analysis.scorecard import score_frame

    scored = score_frame(panel, tables)
    assert scored["total"].max() > 100
