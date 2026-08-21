"""The structured object the agent is allowed to see — and nothing else.

This is the enforcement point for "the agent may only speak about what the layers beneath it
established." The agent is handed a :class:`StructuredContext` assembled from the deterministic
layers; it is never handed raw measurements or self-report values. Each field is a list of
provenance-bearing nodes, so every generated sentence can be tied back to its source.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from aptams.layers import DataLayer


@dataclass(frozen=True)
class ContextNode:
    """One fact the agent may verbalize, with the provenance that licenses it.

    ``node_id`` is what a generated sentence references (tappable in the UI to reveal what
    produced it). ``summary`` is a short, already-safe rendering of the fact — the agent
    rephrases; it does not compute. ``layer`` fixes the claim strength the sentence inherits.
    """

    node_id: str
    kind: str  # "item_score" | "attribution" | "counterfactual" | "trajectory" | "guideline"
    summary: str
    layer: DataLayer


@dataclass(frozen=True)
class StructuredContext:
    """The complete, closed world the agent may draw on for one student, one view.

    Assembled by the API from rule-engine, attribution, counterfactual, trajectory, and
    retrieval outputs. Deliberately contains no raw values — only derived, provenance-bearing
    nodes. If a fact is not represented here, the agent must not state it.
    """

    student_id: str
    nodes: tuple[ContextNode, ...]
    # Retrieved guideline clauses for RAG grounding (Task B). Kept separate so the agent can
    # cite them explicitly.
    guideline_clauses: tuple[ContextNode, ...] = field(default_factory=tuple)

    def node_ids(self) -> frozenset[str]:
        return frozenset(n.node_id for n in (*self.nodes, *self.guideline_clauses))


@dataclass(frozen=True)
class ProvenancedSentence:
    """One sentence of agent output, bound to the context node(s) that license it.

    Validated on the way out: every ``source_node_ids`` entry must exist in the
    :class:`StructuredContext` the sentence was generated from. A sentence citing no node, or
    an unknown node, is rejected rather than shown — that is what makes the agent glass-box.
    """

    text: str
    source_node_ids: tuple[str, ...]


def validate_grounding(
    sentences: tuple[ProvenancedSentence, ...], context: StructuredContext
) -> None:
    """Reject any sentence that cites nothing, or cites a node not in ``context``.

    Structural guarantee behind §5.4 — enforced regardless of what the LLM was prompted to
    do. Raises :class:`ValueError` on the first violation.
    """
    known = context.node_ids()
    for s in sentences:
        if not s.source_node_ids:
            raise ValueError(f"Ungrounded agent sentence (cites no source): {s.text!r}")
        unknown = set(s.source_node_ids) - known
        if unknown:
            raise ValueError(
                f"Agent sentence cites unknown node(s) {sorted(unknown)}: {s.text!r}"
            )
