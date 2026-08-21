# counterfactual — component [3], counterfactual planner

The pivot from "why did I score this" to "what is the cheapest route to the next grade
band." Because the scoring function is known, this is **exact search over the rule engine**,
not approximation (`docs/proposal.md` §5.3).

Two non-negotiable conventions (`AGENTS.md` §Conventions):

1. **Not causal.** A counterfactual is arithmetic over a scoring table, *not* evidence that
   an intervention produces the stated gain. `Counterfactual.causal` is permanently `False`;
   surfaced text must be hedged.
2. **Effort estimates are labelled.** They come from `data/expert_rules/`. Until a
   mentor-supplied rule backs an estimate, `ItemChange.effort_is_placeholder` is `True` and
   the UI must show it as a placeholder.

Depends on: implemented `rule_engine`. T0 state: contract only (`planner.py`).
