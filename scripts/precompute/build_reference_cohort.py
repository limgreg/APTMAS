"""Build a real-student cohort JSON for the web app using the REFERENCE Task A pipeline.

This bridges the completed Task A analysis (reference-taskA/) into the Next.js app's
store. It produces contract-shaped hand-off objects (schema v0.1) for REAL students from
the PFT panel, using:
  - the reference deterministic rule engine (scorecard)
  - the reference counterfactual planner (route-to-pass)
  - the reference GBM Progress Check + treeSHAP per-student drivers
  - the reference student-type segments
  - the reference for_role() server-side privacy boundary

It reuses analysis.handoff.build_handoff / for_role so every object is validated against
the same contract the agent grounds on.

Run from the repo root:
    python3 scripts/precompute/build_reference_cohort.py
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "reference-taskA"))

os.environ.setdefault("APTAMS_DATA_DIR", str(ROOT / "data" / "ML"))
os.environ.setdefault(
    "APTAMS_SCORING_TABLES_DIR", str(ROOT / "data" / "scoring_tables")
)

from analysis.handoff import build_handoff, for_role  # noqa: E402
from analysis.loaders import ITEM_UNITS  # noqa: E402
from analysis.progress_check import (  # noqa: E402
    build_dataset,
    fit,
    per_student,
)
from analysis.route_to_pass import PASS_THRESHOLD  # noqa: E402
from analysis.scorecard import score_frame  # noqa: E402
from aptams.rule_engine.tables import load_scoring_tables  # noqa: E402
import shap  # noqa: E402

OUT = ROOT / "src" / "lib" / "aptams" / "data" / "cohort.json"
REPORTS = ROOT / "analysis" / "reports"
N_STUDENTS = 240
SEED = 20240818

# Map reference feature names -> item provenance ids (g1 score features only).
FEATURE_TO_ITEM = {f"g1_score_{i}": i for i in ITEM_UNITS}


def _drivers_for_row(shap_row: pd.Series, feature_cols: list[str]) -> list[dict]:
    """Per-student treeSHAP drivers for actionable item features (descending |SHAP|)."""
    drivers: list[dict] = []
    for feat in feature_cols:
        item = FEATURE_TO_ITEM.get(feat)
        if item is None:
            continue  # skip g1_total, enrollment_year, is_male (non-actionable)
        val = float(shap_row[feat])
        if val >= 0:
            direction = "helps"
            explanation = "Contributes positively to the predicted pass probability."
        else:
            direction = "lowers"
            explanation = "Lowers the predicted pass probability; a candidate focus area."
        drivers.append({
            "indicator_id": item,
            "provenance": f"measure:{item}",
            "driver_provenance": f"driver:{item}",
            "direction": direction,
            "strength": round(abs(val), 4),
            "shap": round(val, 4),
            "method": "treeSHAP",
            "explanation": explanation,
            "actionable": True,
        })
    drivers.sort(key=lambda d: d["strength"], reverse=True)
    return drivers[:4]


def main() -> None:
    tables = load_scoring_tables()

    # --- Progress Check model (reference: g1 -> g4 scholarship pass) ---
    x, y = build_dataset(("g1",))
    fitted = fit(x, y, feature_set="g1", random_state=0)
    ps = per_student(fitted, x)
    feature_cols = list(x.columns)

    explainer = shap.TreeExplainer(fitted.model)
    sv = explainer.shap_values(x)
    if isinstance(sv, list):  # older shap returns [neg, pos]
        sv = sv[1]
    shap_df = pd.DataFrame(sv, columns=feature_cols, index=x.index)

    # --- g1 long panel for scorecards + student types ---
    long = x  # x is indexed by student_id and carries g1_score_* but not raws
    # Re-derive g1 raws from the source long frame (x dropped raws).
    from analysis.loaders import panel_long

    panel = panel_long()
    g1 = panel[panel["grade"] == "g1"].copy()
    g1_scored = score_frame(g1, tables)
    g1 = g1.join(
        g1_scored[[f"score_{i}" for i in ITEM_UNITS] + ["total"]]
    ).set_index("student_id")
    g1_scored.index = g1.index

    # student-type segment per g1 student (from reference per-student parquet)
    types = pd.read_parquet(REPORTS / "student_types_per_student.parquet")
    types_g1 = types[types["grade"] == "g1"].set_index("student_id")

    # Only students present in both model output and g1 panel.
    eligible = ps.index.intersection(g1.index)
    rng = np.random.default_rng(SEED)
    # Bias toward at-risk so the triage feed is meaningful, but include others.
    at_risk = eligible[ps.loc[eligible, "risk"] == "at_risk"]
    other = eligible.difference(at_risk)
    n_risk = min(int(N_STUDENTS * 0.45), len(at_risk))
    chosen = list(rng.choice(at_risk, size=n_risk, replace=False))
    remaining = N_STUDENTS - len(chosen)
    chosen += list(rng.choice(other, size=min(remaining, len(other)), replace=False))
    chosen = chosen[:N_STUDENTS]

    students: list[dict] = []
    for sid in chosen:
        sid = str(sid)
        prow = g1.loc[sid]
        sex = str(prow["sex"])
        grade = "g1"
        cohort_year = int(prow.get("enrollment_year", 2021))
        raws = {i: float(prow[i]) for i in ITEM_UNITS}
        scored_row = g1_scored.loc[prow.name] if prow.name in g1_scored.index else None
        # build_handoff expects a Series with score_/bonus_/total columns keyed to raws.
        if scored_row is None:
            continue

        seg_row = types_g1.loc[sid] if sid in types_g1.index else None
        if seg_row is not None:
            seg_id = str(seg_row["segment_id"])
            weaknesses = list(seg_row["weaknesses"]) if "weaknesses" in seg_row else []
            segment = {
                "segment_id": seg_id,
                "segment_label_zh": _SEG_ZH.get(seg_id, seg_id),
                "segment_label_en": _SEG_EN.get(seg_id, seg_id),
                "weaknesses": weaknesses,
                "provenance": "type:segment",
            }
        else:
            segment = None

        prob = float(ps.loc[sid, "pass_probability"])
        drivers = _drivers_for_row(shap_df.loc[sid], feature_cols)

        obj = build_handoff(
            student_id=sid,
            sex=sex,
            grade=grade,
            cohort_year=cohort_year,
            raws=raws,
            scored=scored_row,
            tables=tables,
            segment=segment,
            pass_probability=prob,
            drivers=drivers,
            feature_set="g1",
        )
        # Attach the teacher-scoped view (server-side privacy boundary).
        obj["_teacher_view"] = for_role(obj, "teacher")
        students.append(obj)

    # --- cohort aggregates from the FULL model/test set (not just the sample) ---
    p_test = fitted.model.predict_proba(fitted.x_test)[:, 1]
    p_all = ps["pass_probability"]
    aggregates = {
        "n": len(students),
        "pass_rate_model": round(float((p_all >= 0.5).mean()), 4),
        "at_risk": int((ps["risk"] == "at_risk").sum()),
        "at_risk_rate": round(float((ps["risk"] == "at_risk").mean()), 4),
        "mean_pass_probability": round(float(p_all.mean()), 4),
    }
    # Score aggregates from the sample.
    totals = [s["score"]["total"] for s in students]
    aggregates["mean_total"] = round(float(np.mean(totals)), 1)
    band_counts: dict[str, int] = {}
    risk_counts: dict[str, int] = {}
    seg_counts: dict[str, int] = {}
    for s in students:
        b = s["score"]["band"]
        band_counts[b] = band_counts.get(b, 0) + 1
        if s["progress"].get("available"):
            r = s["progress"]["risk"]
            risk_counts[r] = risk_counts.get(r, 0) + 1
        t = s["type"]["segment_id"]
        seg_counts[t] = seg_counts.get(t, 0) + 1

    # Global drivers (from fitted model's test-set mean |SHAP|, actionable only).
    sv_test = explainer.shap_values(fitted.x_test)
    if isinstance(sv_test, list):
        sv_test = sv_test[1]
    mean_abs = np.abs(sv_test).mean(axis=0)
    global_drivers = []
    for feat, mag in zip(feature_cols, mean_abs):
        item = FEATURE_TO_ITEM.get(feat)
        if item is None:
            continue
        global_drivers.append({"indicator_id": item, "importance": round(float(mag), 4)})
    global_drivers.sort(key=lambda d: d["importance"], reverse=True)

    out = {
        "schema_version": "0.1",
        "generated_by": "scripts/precompute/build_reference_cohort.py",
        "model": "reference-taskA Progress Check (GBM, treeSHAP, AUC 0.866)",
        "pass_threshold": PASS_THRESHOLD,
        "progress_model": {
            "method": "GradientBoostingClassifier (200 trees, depth 3) + treeSHAP",
            "feature_set": "g1",
            "target": "g2/g3/g4 scholarship pass (eval year > feature year)",
            "accuracy": round(fitted.metrics["accuracy_test"], 4),
            "auc": round(fitted.metrics["auc_test"], 4),
            "brier": round(fitted.metrics["brier_test"], 4),
            "n_train": int(len(fitted.x_train)),
            "n_test": int(len(fitted.x_test)),
            "global_drivers": global_drivers,
        },
        "cohort_aggregates": {
            **aggregates,
            "bands": band_counts,
            "risks": risk_counts,
            "segments": seg_counts,
        },
        "students": students,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)

    def sanitize(o):
        if isinstance(o, dict):
            return {k: sanitize(v) for k, v in o.items()}
        if isinstance(o, list):
            return [sanitize(v) for v in o]
        if isinstance(o, float) and (np.isnan(o) or np.isinf(o)):
            return None
        if isinstance(o, (np.floating,)):
            v = float(o)
            return None if (np.isnan(v) or np.isinf(v)) else v
        if isinstance(o, (np.integer,)):
            return int(o)
        return o

    OUT.write_text(
        json.dumps(sanitize(out), ensure_ascii=False, allow_nan=False),
        encoding="utf-8",
    )
    print(f"Wrote {len(students)} real-student hand-off objects -> {OUT}")
    print(
        f"Model AUC={fitted.metrics['auc_test']:.3f} "
        f"accuracy={fitted.metrics['accuracy_test']:.3f} "
        f"brier={fitted.metrics['brier_test']:.3f}"
    )


_SEG_ZH = {
    "broad_headroom": "整体提升空间型",
    "endurance_run_headroom": "耐力提升空间型",
    "strength_headroom": "力量提升空间型",
    "vital_capacity_headroom": "肺活量提升空间型",
}
_SEG_EN = {
    "broad_headroom": "Broad headroom — room to grow across most items",
    "endurance_run_headroom": "Endurance is the headroom",
    "strength_headroom": "Upper-body / core strength is the headroom",
    "vital_capacity_headroom": "Lung capacity is the headroom",
}


if __name__ == "__main__":
    main()
