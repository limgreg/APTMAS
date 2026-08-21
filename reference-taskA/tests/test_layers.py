"""The epistemic-layer discipline is fully implemented at T0, so it is fully tested."""

from aptams.layers import Claim, DataLayer, weakest


def test_claim_strengths():
    assert DataLayer.VERIFIED.claim_strength == "exact"
    assert DataLayer.MEASURED.claim_strength == "observed"
    assert DataLayer.REPORTED.claim_strength == "subjective"


def test_reported_is_never_teacher_visible_raw():
    assert DataLayer.VERIFIED.teacher_visible_raw is True
    assert DataLayer.MEASURED.teacher_visible_raw is True
    assert DataLayer.REPORTED.teacher_visible_raw is False


def test_weakest_moves_to_softest_input():
    assert weakest(DataLayer.VERIFIED, DataLayer.MEASURED) is DataLayer.MEASURED
    assert weakest(DataLayer.VERIFIED, DataLayer.REPORTED) is DataLayer.REPORTED
    assert weakest(DataLayer.VERIFIED) is DataLayer.VERIFIED


def test_derivation_cannot_raise_claim_strength():
    c = Claim(value=7, layer=DataLayer.REPORTED, source_node="mood:2026-08")
    assert c.with_value(99).layer is DataLayer.REPORTED
