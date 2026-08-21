"""⑥ Feature-Recognition Rule Base (objective **A2**) — SHAP + LIME + expert experience.

A2 requires one consolidated artifact combining **SHAP**, **LIME** and **mentor expert
experience** into a feature-recognition rule base. This module produces it.

Entry shape, as specified in ``docs/task_a_plan.md`` §3 ⑥::

    segment → top drivers → direction → effect size → expert note

* **SHAP** gives the global and per-segment picture: which features move the Progress Check
  prediction, in which direction, and by how much. Computed with ``TreeExplainer``, which is
  exact for gradient-boosted trees rather than an approximation.
* **LIME** gives the local picture: for one individual student, which features drove *their*
  prediction. Required by A2, not optional — and genuinely different from SHAP, since a local
  surrogate can disagree with the global attribution. Where they disagree we say so.
* **Expert notes** are ``PLACEHOLDER`` until mentors supply the effort estimates and injury
  red-flags (``data/expert_rules/``). The slot exists and is wired; only the content is
  outstanding.

The rule base is what Task B's agent verbalises, so every entry carries the direction and
effect size needed to phrase a grounded, non-evaluative sentence.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from analysis.progress_check import FittedModel, build_dataset, fit

REPORTS = Path("analysis/reports")
EXPERT_RULES_DIR = Path("data/expert_rules")

#: How many students to explain locally with LIME. Local explanations are per-individual and
#: expensive; a stratified handful demonstrates the mechanism and populates the rule base.
N_LIME_SAMPLES = 12

#: Rows sampled for SHAP. TreeExplainer is exact but still O(rows); this is plenty for stable
#: global and per-segment means.
N_SHAP_SAMPLES = 4000

PLACEHOLDER_NOTE = "PLACEHOLDER — awaiting mentor expert rules (data/expert_rules/)"

#: Features a student cannot act on. They are legitimate model *controls* — dropping them
#: would push their signal into the fitness features and distort those attributions — but no
#: guidance may ever be built on them, so every rule-base entry states it explicitly.
#:
#: ``enrollment_year`` matters here: it is the single largest SHAP driver, which means a real
#: part of the prediction is "which cohort you are in" (different evaluation years, and the
#: 2018 policy anomaly documented in the Scorecard verification) rather than anything about
#: the student. Reported openly rather than quietly dropped.
NON_ACTIONABLE_FEATURES = frozenset({"enrollment_year", "is_male"})


def is_actionable(feature: str) -> bool:
    """Whether guidance may be built on this feature at all."""
    return feature not in NON_ACTIONABLE_FEATURES


def load_expert_rules() -> dict[str, str]:
    """Mentor-supplied expert notes, keyed by feature id. Empty until they arrive.

    Looked up from ``data/expert_rules/*.json``; absent files are the expected state and are
    not an error, they simply leave every note as ``PLACEHOLDER``.
    """
    notes: dict[str, str] = {}
    if not EXPERT_RULES_DIR.exists():
        return notes
    for path in sorted(EXPERT_RULES_DIR.glob("*.json")):
        payload = json.loads(path.read_text(encoding="utf-8"))
        notes.update({str(k): str(v) for k, v in payload.get("notes", {}).items()})
    return notes


def shap_values(fitted: FittedModel, x: pd.DataFrame) -> tuple[np.ndarray, pd.DataFrame]:
    """Exact SHAP values for the fitted model over a sample of ``x``."""
    import shap

    sample = x.loc[fitted.test_index]
    if len(sample) > N_SHAP_SAMPLES:
        sample = sample.sample(N_SHAP_SAMPLES, random_state=0)
    explainer = shap.TreeExplainer(fitted.model)
    values = explainer.shap_values(sample)
    if isinstance(values, list):  # older shap returns one array per class
        values = values[1]
    return np.asarray(values), sample


def global_drivers(values: np.ndarray, sample: pd.DataFrame) -> pd.DataFrame:
    """Global feature importance with a direction, from mean SHAP.

    ``mean_abs_shap`` is the magnitude; ``direction`` is the sign of the correlation between
    the feature value and its own SHAP contribution — i.e. does *more* of this feature push
    the prediction toward passing.
    """
    rows = []
    for i, feature in enumerate(sample.columns):
        contrib = values[:, i]
        vals = sample[feature].to_numpy(dtype=float)
        corr = np.corrcoef(vals, contrib)[0, 1] if np.std(vals) > 0 else 0.0
        rows.append({
            "feature": feature,
            "mean_abs_shap": float(np.abs(contrib).mean()),
            "mean_shap": float(contrib.mean()),
            "direction": "higher_helps" if corr > 0 else "higher_hurts",
            "direction_strength": float(abs(corr)),
        })
    out = pd.DataFrame(rows).sort_values("mean_abs_shap", ascending=False)
    out["rank"] = range(1, len(out) + 1)
    return out.reset_index(drop=True)


def segment_drivers(
    values: np.ndarray, sample: pd.DataFrame, segments: pd.Series
) -> pd.DataFrame:
    """Per-segment SHAP importance — the per-segment half of the A2 requirement."""
    rows = []
    aligned = segments.reindex(sample.index)
    for segment_id, idx in aligned.groupby(aligned).groups.items():
        mask = aligned.index.isin(idx)
        if mask.sum() < 30:
            continue
        sub = values[mask]
        for i, feature in enumerate(sample.columns):
            contrib = sub[:, i]
            vals = sample.loc[mask, feature].to_numpy(dtype=float)
            corr = np.corrcoef(vals, contrib)[0, 1] if np.std(vals) > 0 else 0.0
            rows.append({
                "segment": str(segment_id),
                "feature": feature,
                "mean_abs_shap": float(np.abs(contrib).mean()),
                "direction": "higher_helps" if corr > 0 else "higher_hurts",
                "n": int(mask.sum()),
            })
    df = pd.DataFrame(rows)
    df["rank"] = df.groupby("segment")["mean_abs_shap"].rank(ascending=False, method="first")
    return df.sort_values(["segment", "rank"]).reset_index(drop=True)


def lime_explanations(
    fitted: FittedModel, x: pd.DataFrame, n: int = N_LIME_SAMPLES
) -> list[dict[str, Any]]:
    """Local LIME explanations for individual students.

    Stratified across the risk range so the rule base carries local explanations for students
    who are struggling as well as ones who are comfortable — the at-risk end is the one the
    agent will actually be asked about.
    """
    from lime.lime_tabular import LimeTabularExplainer

    explainer = LimeTabularExplainer(
        training_data=fitted.x_train.to_numpy(dtype=float),
        feature_names=list(x.columns),
        class_names=["not_passing", "passing"],
        mode="classification",
        discretize_continuous=True,
        random_state=0,
    )
    columns = list(x.columns)

    def predict(arr: np.ndarray) -> np.ndarray:
        """Restore feature names so sklearn does not warn on every LIME perturbation."""
        return fitted.model.predict_proba(pd.DataFrame(arr, columns=columns))

    test = x.loc[fitted.test_index]
    probs = fitted.model.predict_proba(test)[:, 1]
    order = np.argsort(probs)
    picks = order[np.linspace(0, len(order) - 1, n).astype(int)]

    out = []
    for rank, pos in enumerate(picks, start=1):
        row = test.iloc[pos]
        exp = explainer.explain_instance(
            row.to_numpy(dtype=float),
            predict,
            num_features=5,
        )
        out.append({
            # Pseudonymous by design: the local explanation is the deliverable, the identity
            # is not. Real student ids must never reach a committed artifact (AGENTS.md).
            "subject": f"local_{rank:02d}",
            "pass_probability": round(float(probs[pos]), 4),
            "local_drivers": [
                {"condition": cond, "weight": round(float(w), 4),
                 "direction": "higher_helps" if w > 0 else "higher_hurts"}
                for cond, w in exp.as_list()
            ],
        })
    return out


def build_rule_base(
    fitted: FittedModel,
    x: pd.DataFrame,
    segments: pd.Series,
) -> dict[str, Any]:
    """Consolidate SHAP, LIME and expert notes into the single A2 artifact."""
    values, sample = shap_values(fitted, x)
    glob = global_drivers(values, sample)
    seg = segment_drivers(values, sample, segments)
    local = lime_explanations(fitted, x)
    expert = load_expert_rules()

    def note_for(feature: str) -> dict[str, Any]:
        item = feature.split("_score_")[-1] if "_score_" in feature else feature
        return {
            "expert_note": expert.get(item, PLACEHOLDER_NOTE),
            "expert_note_is_placeholder": item not in expert,
        }

    entries = []
    # One entry per (segment, driver) — the shape the brief asks for.
    for segment_id, grp in seg[seg["rank"] <= 5].groupby("segment"):
        entries.append({
            "segment": segment_id,
            "n": int(grp["n"].iloc[0]),
            "drivers": [
                {
                    "feature": r.feature,
                    "rank": int(r.rank),
                    "direction": r.direction,
                    "effect_size": round(r.mean_abs_shap, 5),
                    "method": "shap",
                    "actionable": is_actionable(r.feature),
                    **note_for(r.feature),
                }
                for r in grp.itertuples()
            ],
        })

    # Where SHAP and LIME disagree on a driver's direction, record it rather than hide it.
    lime_dirs: dict[str, list[str]] = {}
    for ex in local:
        for d in ex["local_drivers"]:
            for feature in x.columns:
                if feature in d["condition"]:
                    lime_dirs.setdefault(feature, []).append(d["direction"])
    disagreements = []
    for _, r in glob.iterrows():
        seen = lime_dirs.get(r["feature"], [])
        if seen and max(set(seen), key=seen.count) != r["direction"]:
            disagreements.append({
                "feature": r["feature"],
                "shap_direction": r["direction"],
                "lime_majority_direction": max(set(seen), key=seen.count),
                "n_lime_observations": len(seen),
            })

    return {
        "objective": "A2 — feature-recognition rule base (SHAP + LIME + expert)",
        "model": "Progress Check (GradientBoostingClassifier)",
        "feature_set": fitted.feature_set,
        "target": "pass_scholarship (evaluation-year total >= 60.0)",
        "metrics": fitted.metrics,
        "methods": ["shap", "lime", "expert"],
        "expert_notes_supplied": bool(expert),
        "non_actionable_features": sorted(NON_ACTIONABLE_FEATURES),
        "global_drivers": glob.assign(actionable=glob["feature"].map(is_actionable)).to_dict(
            orient="records"
        ),
        "segment_entries": entries,
        "local_explanations_lime": local,
        "shap_lime_disagreements": disagreements,
        "caveats": [
            "Attributions explain the MODEL, not the human body. They are not causal.",
            "A three-year-ahead projection is fuzzy; drivers describe tendency, not destiny.",
            "Expert notes marked PLACEHOLDER are unfilled slots, not findings.",
            "Framing derived from this file must stay directional and non-evaluative.",
            "Drivers with actionable=false (enrollment_year, is_male) are model controls. "
            "They must never become advice, and a student cannot change them.",
            "enrollment_year is the largest single driver, so part of this model's skill is "
            "cohort effects rather than fitness. Treat cross-cohort comparisons with care.",
        ],
    }


def main() -> None:
    ap = argparse.ArgumentParser(description="Build the A2 rule base.")
    ap.add_argument("--json", type=Path, default=REPORTS / "rule_base.json")
    ap.add_argument("--table", type=Path, default=REPORTS / "rule_base.md")
    args = ap.parse_args()
    REPORTS.mkdir(parents=True, exist_ok=True)

    x, y = build_dataset(("g1",))
    fitted = fit(x, y, feature_set="g1")

    # Segment each student so SHAP can be reported per segment, as A2 requires.
    from analysis.student_types import scored_panel, segment

    panel = scored_panel()
    assigned, _profiles = segment(panel)
    seg_series = (
        assigned[assigned["grade"] == "g1"].set_index("student_id")["segment_id"]
    )
    seg_series = seg_series[~seg_series.index.duplicated()]

    rb = build_rule_base(fitted, x, seg_series)
    args.json.write_text(json.dumps(rb, ensure_ascii=False, indent=2), encoding="utf-8")

    glob = pd.DataFrame(rb["global_drivers"])
    expert_status = (
        "yes" if rb["expert_notes_supplied"] else "no — every note is PLACEHOLDER"
    )
    lines = [
        "# ⑥ Feature-Recognition Rule Base (A2)\n",
        "Generated by `python -m analysis.rule_base`. Consolidates **SHAP** (global and",
        "per-segment), **LIME** (local, per-student) and **expert notes** into one artifact.",
        f"Machine-readable form: `{args.json.name}`.\n",
        f"Expert notes supplied by mentors: **{expert_status}**\n",
        "## Global drivers (SHAP)\n",
        glob.round(4).to_markdown(index=False),
        "\n## Per-segment entries\n",
        "`segment → top drivers → direction → effect size → expert note`\n",
    ]
    for entry in rb["segment_entries"]:
        lines.append(f"### `{entry['segment']}` (n={entry['n']})\n")
        lines.append(
            pd.DataFrame(entry["drivers"])[
                ["rank", "feature", "direction", "effect_size", "actionable", "expert_note"]
            ].to_markdown(index=False)
        )
        lines.append("")
    lines += [
        "## Local explanations (LIME)\n",
        f"{len(rb['local_explanations_lime'])} individual students, stratified across the risk",
        "range. Full conditions are in the JSON; a sample:\n",
    ]
    for ex in rb["local_explanations_lime"][:3]:
        lines.append(
            f"**{ex['subject']}** — pass probability {ex['pass_probability']}"
        )
        for d in ex["local_drivers"][:4]:
            lines.append(f"  - `{d['condition']}` → {d['direction']} ({d['weight']:+.4f})")
        lines.append("")
    lines += [
        "## Where SHAP and LIME disagree\n",
        (
            pd.DataFrame(rb["shap_lime_disagreements"]).to_markdown(index=False)
            if rb["shap_lime_disagreements"]
            else "No direction disagreements between the global SHAP attribution and the "
            "majority LIME direction on the sampled students."
        ),
        "\nDisagreement is reported rather than resolved: a local surrogate genuinely can",
        "disagree with the global attribution, and hiding that would misrepresent how well we",
        "understand the model.\n",
        "## Caveats\n",
        *[f"- {c}" for c in rb["caveats"]],
    ]
    args.table.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(glob.head(8).round(4).to_string(index=False))
    print(f"\nSegments: {len(rb['segment_entries'])}  LIME: {len(rb['local_explanations_lime'])}"
          f"  disagreements: {len(rb['shap_lime_disagreements'])}")
    print(f"Wrote {args.json} and {args.table}")


if __name__ == "__main__":
    main()
