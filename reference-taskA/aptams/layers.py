"""Epistemic data layers — the project's central correctness discipline.

APTAMS splits data by **epistemic status**, not by source (see ``AGENTS.md`` §Data layers
and ``docs/proposal.md`` §2). Every user-facing statement must signal which layer it rests
on; this is a correctness requirement, not a UI nicety. Encoding it in the type system means
a value cannot travel through the pipeline without carrying its claim strength.

This module needs no scoring data and is therefore fully implemented at T0.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Generic, TypeVar


class DataLayer(StrEnum):
    """The three epistemic layers. Order reflects descending claim strength."""

    VERIFIED = "verified"
    """体测 records scored under the national standard. Claim strength: exact."""

    MEASURED = "measured"
    """Phone step / activity via Health Connect. Observed, but not ground-truth-scored."""

    REPORTED = "reported"
    """Self-report: sleep, mood, screen time. Subjective, and treated as such throughout."""

    @property
    def claim_strength(self) -> str:
        return {
            DataLayer.VERIFIED: "exact",
            DataLayer.MEASURED: "observed",
            DataLayer.REPORTED: "subjective",
        }[self]

    @property
    def teacher_visible_raw(self) -> bool:
        """Whether a teacher may see raw values from this layer.

        REPORTED self-report never surfaces raw to a teacher — only as a non-specific flag
        (``AGENTS.md`` §Privacy boundary). This flag is advisory; the authoritative
        enforcement lives server-side in ``aptams.api.auth``.
        """
        return self is not DataLayer.REPORTED


T = TypeVar("T")


@dataclass(frozen=True)
class Claim(Generic[T]):
    """A value carrying its epistemic layer, so downstream code cannot forget it.

    ``source_node`` ties the value back to whatever produced it (a rule-engine item, an
    attribution, a counterfactual, a retrieved guideline clause). The provenance-locked
    agent (§5.4) uses it to make every generated sentence tappable to its source.
    """

    value: T
    layer: DataLayer
    source_node: str
    unit: str | None = None

    def with_value(self, value: object) -> Claim:
        """Return a copy carrying a derived value at the *same* layer.

        A derivation can never *raise* claim strength — a value computed from REPORTED
        inputs is at best REPORTED. Combining layers is the caller's job and must move to
        the weakest of the inputs.
        """
        return Claim(value=value, layer=self.layer, source_node=self.source_node, unit=self.unit)


def weakest(*layers: DataLayer) -> DataLayer:
    """The weakest (least authoritative) layer among the inputs.

    Any statement combining values from multiple layers inherits the weakest one — a
    conclusion is only as strong as its softest input.
    """
    if not layers:
        raise ValueError("weakest() requires at least one layer")
    order = [DataLayer.VERIFIED, DataLayer.MEASURED, DataLayer.REPORTED]
    return max(layers, key=order.index)
