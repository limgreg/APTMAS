"""⑧ Trust Check — does our explanation method recover a rule we already know?

This is the project's differentiator turned into a measurement (``docs/proposal.md`` §6.1).

Everywhere else, an attribution is unfalsifiable: SHAP says endurance mattered most, and there
is no ground truth to check that against. Here there *is* one. The total is a known linear
function of the seven item scores — ``total = Σ(score_i × weight_i)`` — with weights published
in the national standard. So we can:

1. Train a model to predict the total from the item scores (a deliberately circular task).
2. Run SHAP on it.
3. Compare each feature's mean SHAP attribution against its **true** contribution.

If SHAP cannot recover a weighting we know exactly, its verdict on questions we *cannot* check
deserves proportionally less trust. That number belongs in the paper, and it belongs next to
every attribution claim we make.

Two fidelity measures are reported:

* **Weight recovery** — the implied weight from SHAP versus the standard's published weight.
* **Per-row attribution fidelity** — correlation between each row's SHAP value for an item and
  that row's true contribution ``score_i × weight_i``.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.model_selection import train_test_split

from analysis.loaders import ITEM_UNITS, panel_long
from analysis.scorecard import score_frame
from aptams.rule_engine.tables import load_scoring_tables

REPORTS = Path("analysis/reports")

#: Rows used. The task is deterministic, so this is ample and keeps SHAP tractable.
N_ROWS = 20000
N_SHAP = 3000


def run() -> dict[str, object]:
    """Fit the circular model, explain it, and score the explanation against ground truth."""
    import shap

    tables = load_scoring_tables()
    long = panel_long().sample(N_ROWS, random_state=0)
    scored = score_frame(long, tables)

    features = [f"score_{i}" for i in ITEM_UNITS]
    x = scored[features]
    # The bonus is not a linear function of the item scores, so excluding it keeps the target
    # exactly linear — which is the whole point of having a checkable ground truth.
    y = scored["weighted_total"]

    x_train, x_test, y_train, _y_test = train_test_split(x, y, test_size=0.25, random_state=0)
    model = GradientBoostingRegressor(
        n_estimators=300, max_depth=3, learning_rate=0.08, random_state=0
    )
    model.fit(x_train, y_train)
    r2 = float(model.score(x_test, _y_test))

    sample = x_test.sample(min(N_SHAP, len(x_test)), random_state=0)
    values = np.asarray(shap.TreeExplainer(model).shap_values(sample))

    rows = []
    for i, feature in enumerate(features):
        item = feature.removeprefix("score_")
        true_weight = tables.item_weight(item=item)
        raw = sample[feature].to_numpy(dtype=float)
        shap_i = values[:, i]

        # True contribution, centred: SHAP values are deviations from the base value, so the
        # comparable ground truth is the centred contribution, not the raw product.
        true_contrib = raw * true_weight
        true_centred = true_contrib - true_contrib.mean()

        # Implied weight = slope of SHAP against the raw item score.
        implied_weight = float(np.polyfit(raw, shap_i, 1)[0]) if np.std(raw) > 0 else 0.0
        corr = float(np.corrcoef(shap_i, true_centred)[0, 1]) if np.std(raw) > 0 else 0.0
        rows.append({
            "item": item,
            "true_weight": round(true_weight, 4),
            "shap_implied_weight": round(implied_weight, 4),
            "weight_abs_error": round(abs(implied_weight - true_weight), 4),
            "attribution_correlation": round(corr, 4),
            "mean_abs_shap": round(float(np.abs(shap_i).mean()), 4),
        })

    fidelity = pd.DataFrame(rows).sort_values("true_weight", ascending=False)
    return {
        "model_r2_on_known_function": round(r2, 6),
        "mean_weight_abs_error": round(float(fidelity["weight_abs_error"].mean()), 4),
        "max_weight_abs_error": round(float(fidelity["weight_abs_error"].max()), 4),
        "mean_attribution_correlation": round(
            float(fidelity["attribution_correlation"].mean()), 4
        ),
        "min_attribution_correlation": round(
            float(fidelity["attribution_correlation"].min()), 4
        ),
        "per_item": fidelity.to_dict(orient="records"),
    }


def main() -> None:
    ap = argparse.ArgumentParser(description="Run the explanation-fidelity Trust Check.")
    ap.add_argument("--json", type=Path, default=REPORTS / "trust_check.json")
    ap.add_argument("--table", type=Path, default=REPORTS / "trust_check.md")
    args = ap.parse_args()
    REPORTS.mkdir(parents=True, exist_ok=True)

    result = run()
    args.json.write_text(json.dumps(result, indent=2), encoding="utf-8")
    fidelity = pd.DataFrame(result["per_item"])

    lines = [
        "# ⑧ Trust Check — explanation fidelity\n",
        "Generated by `python -m analysis.trust_check`.\n",
        "## Why this number exists\n",
        "Attributions are normally unfalsifiable: SHAP says endurance mattered most and there is",
        "no ground truth to check it against. Here there is one. The weighted total is a *known*",
        "linear function of the seven item scores, with weights published in the national",
        "standard. So we train a model on that known function, explain it with SHAP, and measure",
        "whether SHAP recovers the weighting we already know.\n",
        "**If SHAP cannot recover a rule we know exactly, its verdict on questions we cannot",
        "check deserves proportionally less trust.**\n",
        "## Headline\n",
        f"- Model R² on the known function: **{result['model_r2_on_known_function']:.4f}**",
        f"- Mean absolute weight-recovery error: **{result['mean_weight_abs_error']:.4f}** "
        f"(worst item {result['max_weight_abs_error']:.4f})",
        f"- Mean per-row attribution correlation: "
        f"**{result['mean_attribution_correlation']:.4f}** "
        f"(worst item {result['min_attribution_correlation']:.4f})\n",
        "## Per item\n",
        fidelity.to_markdown(index=False),
        "\n`shap_implied_weight` is the slope of the SHAP value against the item score — what",
        "SHAP believes the weight is. `true_weight` is what the standard says it is.",
        "`attribution_correlation` compares each individual row's SHAP value against that row's",
        "true centred contribution, so it tests per-student explanations rather than averages.\n",
        "## How to use this\n",
        "- Quote it beside attribution claims in the paper, not as a separate curiosity.",
        "- It bounds confidence in the A2 rule base: the rule base explains a model whose",
        "  explanations are this faithful on a task where fidelity is checkable.",
        "- It does **not** validate causality. A faithful explanation of a model is still an",
        "  explanation of a model, not of human physiology.",
    ]
    args.table.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(fidelity.to_string(index=False))
    print(f"\nR2={result['model_r2_on_known_function']:.4f}  "
          f"mean weight error={result['mean_weight_abs_error']:.4f}  "
          f"mean attribution corr={result['mean_attribution_correlation']:.4f}")
    print(f"Wrote {args.json} and {args.table}")


if __name__ == "__main__":
    main()
