"""Component [2] — predictive & attribution layer.

A gradient-boosted model over the indicator set, with SHAP attributions. The contribution
is not the model but that its attributions are **scored against the rule engine's known
ground truth** (``docs/proposal.md`` §5.2, §6.1). Where attribution diverges from truth —
notably among correlated anthropometric features — we report the divergence rather than
hide it.

Depends on the rule engine and on T1 data (one 体测 snapshot per student). At T0 this is a
contract only. ML dependencies are the ``attribution`` optional extra so the ground-truth
core never has to import them.
"""

from aptams.attribution.model import AttributionResult, FidelityReport

__all__ = ["AttributionResult", "FidelityReport"]
