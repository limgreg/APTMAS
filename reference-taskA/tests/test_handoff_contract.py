"""The Task A → Task B contract, as tests.

``docs/task_b_handoff.md`` promises Task B a frozen shape they can build against today. These
tests are what makes that promise checkable: they run against the synthetic fixtures, so they
pass without any real student data.
"""

from __future__ import annotations

import pytest

from aptams.rule_engine.tables import ScoringTablesUnavailable, load_scoring_tables


@pytest.fixture(scope="module")
def cohort():
    try:
        load_scoring_tables()
    except (ScoringTablesUnavailable, FileNotFoundError):
        pytest.skip("Scoring tables absent — run `python -m analysis.extract_scoring_tables`.")
    from analysis.handoff import synthetic_cohort

    return synthetic_cohort(n=8)


def test_every_object_matches_the_contract_shape(cohort):
    from analysis.handoff import SCHEMA_VERSION

    for obj in cohort:
        assert obj["schema_version"] == SCHEMA_VERSION
        for key in ("student_id", "meta", "score", "route", "progress", "type",
                    "indicators", "flags"):
            assert key in obj


def test_enumerations_are_respected(cohort):
    for obj in cohort:
        assert obj["meta"]["sex"] in {"male", "female"}
        assert obj["meta"]["grade"] in {"g1", "g2", "g3", "g4"}
        assert obj["score"]["band"] in {"优秀", "良好", "及格", "不及格"}
        assert obj["progress"]["risk"] in {"on_track", "watch", "at_risk"}
        for ind in obj["indicators"]:
            assert ind["layer"] in {"verified", "measured", "reported"}
            assert ind["dimension"] in {
                "fitness", "metabolism", "behaviour", "psychology", "environment"
            }


def test_every_value_bearing_node_has_a_unique_provenance_id(cohort):
    from analysis.handoff import provenance_ids

    for obj in cohort:
        ids = provenance_ids(obj)
        assert ids, "an object with no provenance ids would let the agent say nothing"
        assert len(ids) == len(set(ids))


def test_routes_are_never_causal(cohort):
    for obj in cohort:
        assert obj["route"]["causal"] is False
        for option in obj["route"]["options"]:
            assert "effort_is_placeholder" in option


def test_routes_never_propose_a_bmi_change(cohort):
    """A BMI 'route' is weight-loss advice; it must be structurally impossible."""
    for obj in cohort:
        for option in obj["route"]["options"]:
            assert all(c["indicator_id"] != "bmi" for c in option["changes"])


def test_progress_always_states_its_uncertainty(cohort):
    for obj in cohort:
        if obj["progress"]["available"]:
            assert obj["progress"]["uncertainty"]
            assert 0.0 <= obj["progress"]["pass_probability"] <= 1.0


def test_teacher_view_never_contains_self_report(cohort):
    """The privacy boundary, enforced on the server side of the hand-off."""
    from analysis.handoff import for_role

    for obj in cohort:
        teacher = for_role(obj, "teacher")
        assert all(i["teacher_visible"] for i in teacher["indicators"])
        assert all(
            i["dimension"] not in {"psychology", "environment"}
            for i in teacher["indicators"]
        )


def test_teacher_view_reports_that_something_was_withheld(cohort):
    """Teachers get a non-specific flag — not silence, and not the values."""
    from analysis.handoff import for_role

    withheld = [for_role(o, "teacher").get("withheld_self_report") for o in cohort]
    assert any(w for w in withheld)
    for w in filter(None, withheld):
        assert "count" in w and "dimensions" in w
        assert "values" not in w


def test_student_view_is_unfiltered(cohort):
    from analysis.handoff import for_role

    for obj in cohort:
        assert for_role(obj, "student") == obj


def test_unknown_indicator_ids_are_refused(cohort):
    """The A1 catalogue is the controlled vocabulary for Task B's knowledge graph."""
    from analysis.handoff import HandoffValidationError, _indicator_section

    with pytest.raises(HandoffValidationError):
        _indicator_section({"not_a_real_indicator": 1.0})


def test_needs_human_flag_and_route_agree(cohort):
    for obj in cohort:
        if obj["route"]["needs_human"]:
            assert "needs_human" in obj["flags"]


def test_agent_can_only_ground_on_ids_the_object_carries(cohort):
    """End-to-end with the real grounding validator Task B's agent runs behind."""
    from analysis.handoff import provenance_ids
    from aptams.agent.provenance import (
        ContextNode,
        ProvenancedSentence,
        StructuredContext,
        validate_grounding,
    )
    from aptams.layers import DataLayer

    obj = cohort[0]
    ids = provenance_ids(obj)
    context = StructuredContext(
        student_id=obj["student_id"],
        nodes=tuple(
            ContextNode(node_id=i, kind="handoff", summary=i, layer=DataLayer.VERIFIED)
            for i in ids
        ),
    )
    validate_grounding(
        (ProvenancedSentence(text="Grounded.", source_node_ids=(ids[0],)),), context
    )
    with pytest.raises(ValueError):
        validate_grounding(
            (ProvenancedSentence(text="Invented.", source_node_ids=("score:unicorn",)),),
            context,
        )
    with pytest.raises(ValueError):
        validate_grounding(
            (ProvenancedSentence(text="Ungrounded.", source_node_ids=()),), context
        )
