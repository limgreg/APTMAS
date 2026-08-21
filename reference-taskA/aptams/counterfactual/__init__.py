"""Component [3] — counterfactual planner.

"What is the cheapest route to the next grade band." Because the scoring function is known,
counterfactuals are **exact search over the rule engine**, not ML approximation
(``docs/proposal.md`` §5.3).

Two hard conventions (``AGENTS.md`` §Conventions):

* Counterfactuals are arithmetic over a scoring table — **not causal claims** about training
  outcomes. Any surfaced text must be hedged accordingly.
* Effort estimates come from ``data/expert_rules/`` and are labelled as estimates.
  Placeholder values are marked ``PLACEHOLDER`` in code and UI.
"""

from aptams.counterfactual.planner import Counterfactual, cheapest_route_to_next_band

__all__ = ["Counterfactual", "cheapest_route_to_next_band"]
