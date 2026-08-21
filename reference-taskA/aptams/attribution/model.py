"""GBM + SHAP attribution, benchmarked against rule-engine ground truth.

Contract stub (T0). The distinguishing move — measuring attribution *fidelity* against the
deterministic scorer instead of merely presenting attributions — lives in
:func:`fidelity_against_rule_engine`. Implemented once T1 data and the rule engine exist.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class AttributionResult:
    """Per-feature attribution for one student's predicted outcome.

    ``contributions`` maps indicator id → signed SHAP value. ``base_value`` is the model's
    expected output. These are *model* explanations, not ground truth — the fidelity report
    is what tells us how far they can be trusted.
    """

    student_id: str
    base_value: float
    contributions: dict[str, float]


@dataclass(frozen=True)
class FidelityReport:
    """How faithfully attributions track the rule engine on scored items.

    Reported openly (``docs/proposal.md`` §6.1): a fidelity figure plus a stability test
    across resampling and retraining. High divergence on correlated anthropometric features
    is expected and surfaced, not suppressed.
    """

    fidelity: float  # agreement with rule-engine ground truth on scored items, in [0, 1]
    stability: float  # attribution stability across resample/retrain, in [0, 1]
    divergent_features: tuple[str, ...]


def fidelity_against_rule_engine(*args: object, **kwargs: object) -> FidelityReport:
    """Score attributions against rule-engine ground truth on scored items.

    Signature intentionally open until the model and T1 data schema are fixed.
    """
    raise NotImplementedError(
        "Attribution fidelity requires (a) the implemented rule engine and (b) T1 data. "
        "See docs/proposal.md §6.1."
    )
