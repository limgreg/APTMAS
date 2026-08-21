# data/synthetic/

Synthetic cohorts for the **T0 demo** — realistic student profiles generated *through the
rule engine* so the full pipeline (scoring → attribution → counterfactual → agent) is
demonstrable with **no real data**.

Because the rule engine is the ground truth, a synthetic cohort has known-correct scores by
construction, which is exactly what the attribution-fidelity evaluation (`docs/proposal.md`
§6.1) needs.

## Status

Blocked on the same input as everything downstream: the generator draws raw measurements and
scores them with the implemented rule engine, so it comes online once
`data/scoring_tables/` is populated and `aptams/rule_engine/tables.py` is implemented.
Generation code lives here; large generated dumps are git-ignored.
