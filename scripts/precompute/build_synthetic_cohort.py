"""Build a SYNTHETIC cohort JSON for the web app using the reference Task A pipeline.

Replaces ``build_reference_cohort.py``, which emitted 240 **real** students — real ids, real
measurements, real predicted probabilities — into ``src/lib/aptams/data/cohort.json``, a file
that is committed to version control and shipped to whatever host the app deploys to.
``AGENTS.md``: *"Data is sensitive: it lives under data/ (git-ignored). Never commit real
data."*

**What is real here and what is not.** The real panel is used for exactly two things, both of
which produce aggregates only:

1. Fitting the Progress Check model (the same GBM, the same treeSHAP explainer).
2. Deriving per-(sex, grade) means and covariances for each item, so synthetic students are
   drawn from a plausible joint distribution rather than seven independent normals — item
   correlations survive, which is what makes the segments and routes look real.

Every **individual** in the output is generated. No real student_id, no real measurement, and
no real prediction leaves this script. The synthetic students are then scored through the real
rule engine, routed through the real planner, and predicted by the real fitted model, so the
resulting objects are internally consistent with the standard and with the model.

Aggregates in the output are computed from the synthetic cohort itself and are labelled as
such. Population-level model metrics (AUC, Brier, n_train) are kept in a separate
``progress_model`` block and labelled as measured on the real panel — mixing the two is what
produced the incoherent ``"n": 240`` next to ``"at_risk": 4040`` in the previous build.

Run from the repo root::

    python scripts/precompute/build_synthetic_cohort.py
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
os.environ.setdefault("APTAMS_SCORING_TABLES_DIR", str(ROOT / "data" / "scoring_tables"))

import shap  # noqa: E402

from analysis.handoff import build_handoff, for_role  # noqa: E402
from analysis.loaders import ITEM_UNITS, panel_long  # noqa: E402
from analysis.progress_check import build_dataset, fit  # noqa: E402
from analysis.route_to_pass import PASS_THRESHOLD  # noqa: E402
from analysis.scorecard import score_frame  # noqa: E402
from analysis.student_types import DEFAULT_K, segment, weakness_profile  # noqa: E402
from analysis.trajectories import (  # noqa: E402
    GRADES,
    TRAJECTORY_LABELS_EN,
    TRAJECTORY_LABELS_ZH,
    PRIORITY_CLASSES,
    classify,
    noise_floor,
    SLOPE_THRESHOLD_SD,
)
from aptams.rule_engine.tables import load_scoring_tables  # noqa: E402

OUT = ROOT / "src" / "lib" / "aptams" / "data" / "cohort.json"
N_STUDENTS = 240
SEED = 20260819

#: Synthetic ids are 5 digits, like the real ones, so the login screen behaves realistically.
#: They are drawn from the 90000-99999 band, which is disjoint from the real id space by
#: construction: real ids run 1..36059. A record carrying a 9xxxx id therefore cannot be a
#: real student, and scripts/check-data.mjs asserts the band on every build.
SYNTHETIC_ID_BASE = 90000
REAL_ID_MAX = 36059

#: Items that must be whole numbers, and the decimals the rest are recorded to.
INT_ITEMS = {"strength", "vital_capacity"}
ITEM_DECIMALS = {"bmi": 2, "sprint_50m": 1, "standing_long_jump": 1,
                 "sit_and_reach": 1, "endurance_run": 1}

#: Physiological floors/ceilings, so a tail draw never produces an absurd student.
ITEM_BOUNDS = {
    "bmi": (14.0, 38.0),
    "vital_capacity": (1000.0, 7000.0),
    "sprint_50m": (5.8, 13.0),
    "standing_long_jump": (95.0, 300.0),
    "sit_and_reach": (-15.0, 33.0),
    "endurance_run": (150.0, 400.0),
    "strength": (0.0, 70.0),
}

FEATURE_TO_ITEM = {f"g1_score_{i}": i for i in ITEM_UNITS}
# Delta features are g1->g2 changes and are not produced for the shipped g1-only
# model, but the feats builder knows how to fill them if a future horizon uses them.
ITEM_UNITS_FIRST = next(iter(ITEM_UNITS))

_SEG_ZH = {
    "broad_headroom": "整体提升空间型",
    "endurance_run_headroom": "耐力提升空间型",
    "strength_headroom": "力量提升空间型",
    "vital_capacity_headroom": "肺活量提升空间型",
    "sprint_50m_headroom": "速度提升空间型",
    "standing_long_jump_headroom": "爆发力提升空间型",
    "sit_and_reach_headroom": "柔韧性提升空间型",
}
_SEG_EN = {
    "broad_headroom": "Broad headroom — room to grow across most items",
    "endurance_run_headroom": "Endurance is the headroom",
    "strength_headroom": "Upper-body / core strength is the headroom",
    "vital_capacity_headroom": "Lung capacity is the headroom",
    "sprint_50m_headroom": "Sprint speed is the headroom",
    "standing_long_jump_headroom": "Explosive power is the headroom",
    "sit_and_reach_headroom": "Flexibility is the headroom",
}


#: Column order for the joint draw: seven items across four sittings.
PANEL_COLUMNS = [(g, i) for g in GRADES for i in ITEM_UNITS]


def distribution_params(panel: pd.DataFrame) -> dict[str, dict]:
    """Per-sex mean vector and covariance over ALL 28 (grade, item) dimensions.

    Modelling the four sittings jointly rather than one at a time is what makes synthetic
    trajectories realistic. A per-grade draw would give each student four independent years,
    so every synthetic trajectory would be noise and the whole four-year story the project
    rests on would be fabricated. Drawing from the joint covariance preserves both the
    correlation between items and the correlation across years, so a synthetic student who is
    strong in g1 tends to be strong in g4, and the cohort's real decline in endurance shows up
    in the sample without being programmed in.

    Still aggregate statistics only: a mean and a covariance over thousands of students. No
    individual record is recoverable from them.
    """
    wide = panel.pivot_table(index=["student_id", "sex"], values=list(ITEM_UNITS), columns="grade")
    params: dict[str, dict] = {}
    for sex, grp in wide.groupby(level="sex"):
        block = grp[[(i, g) for g, i in PANEL_COLUMNS]].dropna()
        if len(block) < 200:
            continue
        params[str(sex)] = {
            "mean": block.mean().to_numpy(),
            "cov": np.cov(block.to_numpy(), rowvar=False),
            "n": int(len(block)),
        }
    return params


def draw_students(params: dict, n: int, rng: np.random.Generator) -> pd.DataFrame:
    """Sample synthetic students with a full four-year history.

    Returns a LONG frame: one row per (student, grade), matching the shape the rest of the
    Task A pipeline expects.
    """
    sexes = sorted(params)
    rows = []
    for i in range(n):
        sex = sexes[i % len(sexes)]
        p = params[sex]
        draw = rng.multivariate_normal(p["mean"], p["cov"], method="cholesky")
        sid = str(SYNTHETIC_ID_BASE + i + 1)
        year = int(rng.choice([2019, 2020, 2021]))

        for k, (grade, item) in enumerate(PANEL_COLUMNS):
            if item == ITEM_UNITS_FIRST:
                rows.append({
                    "student_id": sid, "sex": sex, "grade": grade, "enrollment_year": year,
                })
            lo, hi = ITEM_BOUNDS[item]
            v = float(np.clip(draw[k], lo, hi))
            rows[-1][item] = float(round(v)) if item in INT_ITEMS else round(v, ITEM_DECIMALS[item])
    return pd.DataFrame(rows)


def main() -> None:
    rng = np.random.default_rng(SEED)
    tables = load_scoring_tables()

    # --- real panel: model + distribution parameters (aggregates only) ---
    print("Fitting the Progress Check model on the real panel...")
    x, y, groups = build_dataset(("g1",), "g4")
    fitted = fit(x, y, groups, feature_set="g1", eval_grade="g4", random_state=0)
    feature_cols = list(x.columns)
    # treeSHAP needs the uncalibrated base GBM; the served probabilities come
    # from the isotonic-calibrated ensemble.
    explainer = shap.TreeExplainer(fitted.base_model)

    panel = panel_long()
    params = distribution_params(panel)
    print(f"Derived joint (28-dim) distribution parameters for {len(params)} sex cells.")

    # The slope threshold is measured on the REAL panel so synthetic students are classified
    # against the same bar as real ones (analysis/trajectories.noise_floor).
    real_totals = (
        panel.join(score_frame(panel, tables)[["total"]])
        .pivot_table(index="student_id", columns="grade", values="total")[list(GRADES)]
        .dropna()
        .to_numpy(dtype=float)
    )
    slope_threshold = SLOPE_THRESHOLD_SD * noise_floor(real_totals)
    print(f"Trajectory slope threshold (from the real panel): {slope_threshold:.3f} pts/year")

    # --- synthetic individuals, each with a full four-year history ---
    long = draw_students(params, N_STUDENTS, rng)
    real_ids = set(panel["student_id"].astype(str))
    assert not set(long["student_id"]) & real_ids, "synthetic ids collided with real ids"
    assert max(int(i) for i in real_ids if i.isdigit()) <= REAL_ID_MAX, (
        "real id space now exceeds REAL_ID_MAX; the synthetic band is no longer disjoint"
    )
    long_scored = score_frame(long, tables)
    long = long.join(long_scored[[f"score_{i}" for i in ITEM_UNITS] + ["total", "band", "bonus"]])

    # Totals by grade, per student -> trajectory classification.
    totals_wide = long.pivot_table(index="student_id", columns="grade", values="total")
    totals_wide = totals_wide.reindex(columns=list(GRADES))
    trajectories = {
        str(sid): classify(str(sid), row.to_numpy(dtype=float), slope_threshold=slope_threshold)
        for sid, row in totals_wide.iterrows()
    }

    # The Progress-Check model predicts FORWARD from g1, so its features / probability / SHAP
    # drivers / entry segment are all keyed to the g1 sitting (baseline year). That is kept as
    # is below. The displayed "current assessment" (score + counterfactual route), however, is
    # the most recent sitting — g4 for these four-year students — so a student looking at their
    # record sees their latest measurements, not their entry-year values.
    g1_frame = long[long["grade"] == "g1"].reset_index(drop=True)
    g1_scored = long_scored.loc[long["grade"].to_numpy() == "g1"].reset_index(drop=True)
    frame = g1_frame
    scored = g1_scored

    # g4 look-ups keyed by student id, used to assemble the current scorecard / route.
    g4_mask = long["grade"].to_numpy() == "g4"
    g4_frame = long[long["grade"] == "g4"].set_index("student_id", drop=False)
    g4_scored = long_scored.loc[g4_mask].copy()
    g4_scored.index = long.loc[g4_mask, "student_id"].to_numpy()

    # Model features for the synthetic students, in the fitted model's column order.
    # The shipped g1->g4 model uses g1 item scores + g1_total + is_male (enrollment_year
    # is returned as the group/cv key, not as a feature). Generic handling is kept so a
    # multi-year feature set (delta columns) would still be filled correctly.
    g2_scored_by_id: dict[str, pd.Series] = {}
    if any(c.startswith("delta_") for c in feature_cols):
        g2_mask = long["grade"].to_numpy() == "g2"
        g2_long_scored = long_scored.loc[g2_mask].copy()
        g2_long_scored.index = long.loc[g2_mask, "student_id"].to_numpy()
        for sid_i, r in g2_long_scored.iterrows():
            g2_scored_by_id[str(sid_i)] = r

    feats = pd.DataFrame(index=frame.index)
    g1_scored_by_id = {str(sid_i): scored.loc[i] for i, sid_i in enumerate(frame["student_id"].to_numpy())}
    for col in feature_cols:
        if col in FEATURE_TO_ITEM:
            feats[col] = scored[f"score_{FEATURE_TO_ITEM[col]}"].to_numpy()
        elif col == "g1_total":
            feats[col] = scored["total"].to_numpy()
        elif col == "is_male":
            feats[col] = (frame["sex"] == "male").astype(int).to_numpy()
        elif col.startswith("delta_"):
            # delta_<a>_<b>_score_<item>: change from grade a to grade b.
            parts = col.split("_")
            item = parts[parts.index("score") + 1]
            ga, gb = parts[1], parts[2]
            src_scored = g1_scored_by_id if ga == "g1" else g2_scored_by_id
            other_scored = g2_scored_by_id if gb == "g2" else g1_scored_by_id
            vals = []
            for sid_i in frame["student_id"].astype(str).to_numpy():
                a = float(src_scored[sid_i][f"score_{item}"])
                b_row = other_scored.get(sid_i)
                b = float(b_row[f"score_{item}"]) if b_row is not None else a
                vals.append(b - a)
            feats[col] = vals
        else:
            raise KeyError(f"Unhandled model feature: {col}")

    # Served (calibrated) probabilities drive the product; SHAP is explanatory and
    # is computed on the uncalibrated base GBM.
    probs = fitted.calibrated.predict_proba(feats)[:, 1]
    sv = explainer(feats.to_numpy()).values
    if isinstance(sv, list):
        sv = sv[1]
    sv = np.asarray(sv)
    if sv.ndim == 3:
        sv = sv[:, :, 1]  # positive-class treeSHAP path
    shap_df = pd.DataFrame(sv, columns=feature_cols, index=frame.index)

    # --- segments, via the real clustering + weakness profile ---
    # Segmentation describes students as they are NOW (g4), so a segment's mean total / headroom
    # item agrees with each student's current scorecard. The Progress-Check probability and SHAP
    # drivers above stay on the g1 baseline where the model is defined.
    g4_derived = [c for c in g4_frame.columns if c.startswith("score_")] + ["total", "band", "bonus"]
    prof_input = g4_frame.drop(columns=[c for c in g4_derived if c in g4_frame.columns]).reset_index(drop=True).join(
        g4_scored.reset_index(drop=True)[[f"score_{i}" for i in ITEM_UNITS] + ["total", "band"]]
    )
    profiles = weakness_profile(prof_input).set_index("student_id")
    assigned, seg_profiles = segment(prof_input, k=DEFAULT_K)
    seg_by_id = dict(zip(assigned["student_id"].astype(str), assigned["segment_id"], strict=True))

    # Per-student history, for the trend chart and for the agent to cite.
    history_by_id: dict[str, list[dict]] = {}
    for sid, grp in long.groupby("student_id"):
        history_by_id[str(sid)] = [
            {
                "grade": str(r["grade"]),
                "total": float(r["total"]),
                "band": str(r["band"]),
                "pass": bool(r["total"] >= PASS_THRESHOLD),
                "items": {i: float(r[f"score_{i}"]) for i in ITEM_UNITS},
                "provenance": f"history:{r['grade']}",
            }
            for _, r in grp.sort_values("grade").iterrows()
        ]

    students: list[dict] = []
    for idx, row in frame.iterrows():
        sid = str(row["student_id"])
        prof = profiles.loc[sid] if sid in profiles.index else None
        seg = None
        if prof is not None:
            seg_id = str(seg_by_id.get(sid, "broad_headroom"))
            seg = {
                "segment_id": seg_id,
                "segment_label_zh": _SEG_ZH.get(seg_id, seg_id),
                "segment_label_en": _SEG_EN.get(seg_id, seg_id),
                "weaknesses": [str(w) for w in prof["weaknesses"]],
                "provenance": "type:segment",
            }

        # Model artefacts (pass probability + treeSHAP drivers) remain the g1-baseline forward
        # prediction; the current scorecard / counterfactual route are built from the g4 row.
        g4_row = g4_frame.loc[sid]
        g4_scored_row = g4_scored.loc[sid]
        obj = build_handoff(
            student_id=sid,
            sex=str(row["sex"]),
            grade="g4",
            cohort_year=int(row["enrollment_year"]),
            raws={i: float(g4_row[i]) for i in ITEM_UNITS},
            scored=g4_scored_row,
            tables=tables,
            segment=seg,
            pass_probability=float(probs[idx]),
            drivers=_drivers_for_row(shap_df.loc[idx], feature_cols),
            feature_set="g1",
            model_version=fitted.version["version"],
        )
        # Four-year history and trajectory class. Both are exact — recomputed totals and an
        # OLS slope over them — so they sit alongside the scorecard as verified facts rather
        # than with the model's predictions.
        traj = trajectories[sid]
        obj["history"] = history_by_id[sid]
        obj["trajectory"] = {
            "trajectory_id": traj.trajectory_id,
            "label_en": TRAJECTORY_LABELS_EN[traj.trajectory_id],
            "label_zh": TRAJECTORY_LABELS_ZH[traj.trajectory_id],
            "slope": traj.slope,
            "delta": traj.delta,
            "totals": list(traj.totals),
            "crossings": traj.crossings,
            "volatile": traj.volatile,
            "is_priority": traj.trajectory_id in PRIORITY_CLASSES,
            "slope_threshold": round(slope_threshold, 3),
            "provenance": "trajectory:class",
        }
        obj["_teacher_view"] = for_role(obj, "teacher")
        students.append(obj)

    out = _assemble(students, fitted, explainer, feature_cols, seg_profiles, prof_input, assigned)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(_sanitize(out), ensure_ascii=False, allow_nan=False), "utf-8")

    n_fail = sum(1 for s in students if not s["score"]["pass"])
    print(f"\nWrote {len(students)} SYNTHETIC hand-off objects -> {OUT}")
    print(f"  ids            : {SYNTHETIC_ID_BASE + 1} .. {SYNTHETIC_ID_BASE + len(students)}  (9xxxx band, disjoint from real 1..{REAL_ID_MAX})")
    print(f"  below the gate : {n_fail} ({n_fail / len(students):.1%})")
    print(f"  model          : AUC={fitted.metrics['auc_test']:.3f} (measured on the real panel)")


def _drivers_for_row(shap_row: pd.Series, feature_cols: list[str]) -> list[dict]:
    """Per-student treeSHAP drivers for actionable item features (descending |SHAP|)."""
    drivers: list[dict] = []
    for feat in feature_cols:
        item = FEATURE_TO_ITEM.get(feat)
        if item is None:
            continue  # skip g1_total, enrollment_year, is_male (non-actionable)
        val = float(shap_row[feat])
        drivers.append({
            "indicator_id": item,
            "provenance": f"measure:{item}",
            "driver_provenance": f"driver:{item}",
            "direction": "helps" if val >= 0 else "lowers",
            "strength": round(abs(val), 4),
            "shap": round(val, 4),
            "method": "treeSHAP",
            "explanation": (
                "Contributes positively to the predicted pass probability."
                if val >= 0
                else "Lowers the predicted pass probability; a candidate focus area."
            ),
            "actionable": True,
        })
    drivers.sort(key=lambda d: d["strength"], reverse=True)
    return drivers[:4]


def _segment_profiles(seg_profiles, prof_input, assigned) -> list[dict]:
    """Per-cluster profile the teacher UI needs to describe a group, not just name it.

    Everything here is an AGGREGATE over the cluster: its size, its mean total, the share
    below the gate, and its centroid in item-score space. The centroid is what makes a group
    legible — "this group averages 42 on flexibility and 78 on endurance" is a teachable
    fact, where a bare label is not.
    """
    merged = prof_input.set_index("student_id").join(
        assigned.set_index("student_id")[["segment_id"]]
    )
    out = []
    for _, row in seg_profiles.iterrows():
        seg_id = str(row["segment_id"])
        members = merged[merged["segment_id"] == seg_id]
        out.append({
            "segment_id": seg_id,
            "segment_label_zh": _SEG_ZH.get(seg_id, str(row["label_zh"])),
            "segment_label_en": _SEG_EN.get(seg_id, str(row["label_en"])),
            "headroom_item": str(row["headroom_item"]),
            "relative_strength": str(row["relative_strength"]),
            "is_low_baseline": bool(row["is_low_baseline"]),
            "n": int(len(members)),
            "mean_total": round(float(members["total"].mean()), 1) if len(members) else None,
            "share_below_pass": (
                round(float((members["total"] < PASS_THRESHOLD).mean()), 3) if len(members) else None
            ),
            "mean_item_scores": {
                item: round(float(members[f"score_{item}"].mean()), 1)
                for item in ITEM_UNITS
                if len(members)
            },
            "provenance": "type:segment",
        })
    out.sort(key=lambda d: (d["mean_total"] is None, d["mean_total"]))
    return out


def _assemble(students, fitted, explainer, feature_cols, seg_profiles, prof_input, assigned) -> dict:
    """Cohort aggregates computed from the SYNTHETIC set; model metrics kept separate."""
    sv_test = explainer(fitted.x_test.to_numpy()).values
    if isinstance(sv_test, list):
        sv_test = sv_test[1]
    sv_test = np.asarray(sv_test)
    if sv_test.ndim == 3:
        sv_test = sv_test[:, :, 1]
    mean_abs = np.abs(sv_test).mean(axis=0)
    global_drivers = sorted(
        (
            {"indicator_id": FEATURE_TO_ITEM[f], "importance": round(float(m), 4)}
            for f, m in zip(feature_cols, mean_abs, strict=True)
            if f in FEATURE_TO_ITEM
        ),
        key=lambda d: d["importance"],
        reverse=True,
    )

    probs = [s["progress"]["pass_probability"] for s in students if s["progress"].get("available")]
    totals = [s["score"]["total"] for s in students]
    bands: dict[str, int] = {}
    risks: dict[str, int] = {}
    segments: dict[str, int] = {}
    needs_human = 0
    for s in students:
        bands[s["score"]["band"]] = bands.get(s["score"]["band"], 0) + 1
        if s["progress"].get("available"):
            risks[s["progress"]["risk"]] = risks.get(s["progress"]["risk"], 0) + 1
        seg = s["type"]["segment_id"]
        segments[seg] = segments.get(seg, 0) + 1
        if s["route"].get("needs_human"):
            needs_human += 1

    m = fitted.metrics
    ci = m.get("bootstrap_ci") or {}
    return {
        "schema_version": "0.2",
        "generated_by": "scripts/precompute/build_synthetic_cohort.py",
        "synthetic": True,
        "$note": (
            "Every student in this file is GENERATED. Ids are demo_NNNN, measurements are "
            "drawn from per-(sex, grade) means and covariances of the real panel, then scored "
            "through the real rule engine and predicted by the real fitted model. No real "
            "student_id, measurement, or prediction is present. `cohort_aggregates` describes "
            "THIS synthetic cohort; `progress_model` reports metrics measured on the real "
            "panel and does not describe these students."
        ),
        "pass_threshold": PASS_THRESHOLD,
        "progress_model": {
            "measured_on": "real panel (aggregate metrics only)",
            "method": (
                "GradientBoostingClassifier (tuned, early-stopped) + isotonic calibration "
                "+ treeSHAP; per-horizon, sentinel-masked, monotonicity-guarded"
            ),
            "feature_set": fitted.feature_set,
            "eval_grade": fitted.eval_grade,
            "horizon_years": fitted.horizon_years,
            "target": "g4 scholarship pass (eval year > feature year, never circular)",
            "split_kind": m.get("split_kind"),
            "accuracy": round(m["accuracy_test"], 4),
            "auc": round(m["auc_test"], 4),
            "brier": round(m["brier_test"], 4),
            "log_loss": round(m["log_loss_test"], 4),
            "threshold_support": round(fitted.threshold, 4),
            "sensitivity_target": m.get("sensitivity_target"),
            "confusion_support": m.get("confusion_support"),
            "bootstrap_ci": ci or None,
            "n_train": int(len(fitted.x_train)),
            "n_test": int(len(fitted.x_test)),
            "global_drivers": global_drivers,
            "model_version": fitted.version["version"],
        },
        "cohort_aggregates": {
            "describes": "the synthetic cohort in this file",
            "n": len(students),
            "mean_total": round(float(np.mean(totals)), 1),
            "pass_rate": round(float(np.mean([t >= PASS_THRESHOLD for t in totals])), 4),
            "mean_pass_probability": round(float(np.mean(probs)), 4) if probs else None,
            "at_risk": risks.get("at_risk", 0),
            "at_risk_rate": round(risks.get("at_risk", 0) / len(students), 4),
            "needs_human": needs_human,
            "needs_human_rate": round(needs_human / len(students), 4),
            "bands": bands,
            "risks": risks,
            "segments": segments,
        },
        "segment_profiles": _segment_profiles(seg_profiles, prof_input, assigned),
        "students": students,
    }


def _sanitize(o):
    if isinstance(o, dict):
        return {k: _sanitize(v) for k, v in o.items()}
    if isinstance(o, list):
        return [_sanitize(v) for v in o]
    if isinstance(o, np.integer):
        return int(o)
    if isinstance(o, (float, np.floating)):
        v = float(o)
        return None if (np.isnan(v) or np.isinf(v)) else v
    return o


if __name__ == "__main__":
    main()
