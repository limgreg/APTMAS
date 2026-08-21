# attribution — component [2], predictive & attribution layer

GBM over the indicator set + SHAP. **The model is deliberately unexciting.** The
contribution is that attributions are *scored against the rule engine's known ground truth*
and the divergence is reported, not hidden (`docs/proposal.md` §5.2, §6.1).

- Depends on: implemented `rule_engine` + **T1** data (one 体测 snapshot per student).
- Dependencies: `pip install -e ".[attribution]"` (numpy, scikit-learn, shap) — kept out of
  the core so the ground-truth path never imports ML.
- Key output: `FidelityReport` — a fidelity figure plus a stability test across
  resampling/retraining, addressing the known instability of post-hoc attribution under
  correlated biomedical features.

T0 state: contract only (`model.py`).
