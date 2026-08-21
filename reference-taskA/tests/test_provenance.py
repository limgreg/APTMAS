"""Grounding validation is the agent's structural safety guarantee — test it directly."""

import pytest

from aptams.agent.provenance import (
    ContextNode,
    ProvenancedSentence,
    StructuredContext,
    validate_grounding,
)
from aptams.layers import DataLayer


def _context() -> StructuredContext:
    return StructuredContext(
        student_id="s1",
        nodes=(
            ContextNode(
                "item:sit_and_reach", "item_score", "Sit-and-reach improved.", DataLayer.VERIFIED
            ),
        ),
        guideline_clauses=(
            ContextNode(
                "who:pa-60min", "guideline", "WHO: 60 min activity/day.", DataLayer.VERIFIED
            ),
        ),
    )


def test_grounded_sentence_passes():
    ctx = _context()
    validate_grounding(
        (ProvenancedSentence("Sit-and-reach improved.", ("item:sit_and_reach",)),), ctx
    )


def test_ungrounded_sentence_rejected():
    ctx = _context()
    with pytest.raises(ValueError, match="cites no source"):
        validate_grounding((ProvenancedSentence("You are unhealthy.", ()),), ctx)


def test_sentence_citing_unknown_node_rejected():
    ctx = _context()
    with pytest.raises(ValueError, match="unknown node"):
        validate_grounding(
            (ProvenancedSentence("Fabricated claim.", ("item:made_up",)),), ctx
        )
