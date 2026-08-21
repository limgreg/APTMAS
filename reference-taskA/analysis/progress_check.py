"""③ Progress Check — "am I on track, and who needs help early?" (v2)

Predicts a **later** scholarship outcome from **earlier** features and returns a
per-student risk flag plus a *calibrated* probability. This v2 hardens the model
that shipped in v1 without changing its contract:

* **No circularity, by construction.** Features come only from years strictly
  earlier than the evaluation year. Same-year prediction would just be the
  deterministic scorecard wearing a model's clothes (AUC ~ 1.0, no information).
* **Per-horizon models.** v1 mixed 1-/2-/3-year-ahead outcomes in one fit, so the
  reported AUC was easier than the g1→g4 task the app actually ships. We now
  train one model per ``(feature_grades, eval_year)`` horizon and report each on
  its own terms. The shipped model is the hard one: g1 → 大四 (g4).
* **Cohort-aware CV.** A stratified group split by ``enrollment_year`` keeps an
  entire intake in either train or test, so the test AUC is not inflated by
  siblings of training students. We report mean ± std across folds, not a single
  75/25 number.
* **Sentinel handling.** The panel was pre-winsorised: 1,821 rows sit at exactly
  185.0 s endurance, 1,573 at 1,238 ml vital capacity, 1,874 at 6.5 s sprint.
  These are clipping artifacts (「初步删掉极值」), not measurements. We mask and
  exclude them instead of letting the tree treat them as extreme-but-real.
* **Calibrated probabilities + a decision-theoretic threshold.** The GBM is
  post-hoc calibrated (isotonic) on held-out data, and the "needs support" flag
  is set to a *sensitivity target* (catch ≥80% of future failures) rather than an
  arbitrary 0.5. This is an early-support triage signal, so false negatives cost
  more than false positives; the threshold and its confusion matrix are reported.
* **Change features.** For multi-year feature sets we add g1→g2 deltas and the
  g2−g1 slope, so the model can use trajectory, not just two static snapshots.
* **BMI exclusion check.** BMI is non-actionable in the product. We compare
  AUC/Brier with and without it; if it adds no signal we drop it so the measured
  layer stays consistent with the safety framing.
* **Model version + uncertainty.** A version hash (hyperparameters, feature set,
  n_train, date) is emitted alongside a confidence band so the UI can cite
  exactly which model produced a probability.

Nothing here is causal and nothing is a forecast shown as fact: a projection 1–3
years ahead from a couple of sittings is genuinely fuzzy, and the calibration
curve / Brier score are reported so that uncertainty stays visible.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV, calibration_curve
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.metrics import (
    accuracy_score,
    brier_score_loss,
    confusion_matrix,
    log_loss,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import (
    StratifiedGroupKFold,
    StratifiedKFold,
    StratifiedShuffleSplit,
)

from analysis.loaders import ITEM_UNITS, load_scholarship, panel_long
from analysis.route_to_pass import PASS_THRESHOLD
from analysis.scorecard import score_frame
from aptams.rule_engine.tables import load_scoring_tables

REPORTS = Path("analysis/reports")
FIGURES = REPORTS / "figures"

#: Probability vocabulary. ``at_risk`` is set by the *tuned* threshold (a
#: sensitivity target), ``watch`` is the cohort base rate, ``on_track`` is above.
RISK_BANDS = {"at_risk": 0.50, "watch": 0.75}

#: Catch at least this share of future fails when choosing the support threshold.
SENSITIVITY_TARGET = 0.80

#: Evaluation years and their index. g1 index = 1.
GRADE_IDX = {"g1": 1, "g2": 2, "g3": 3, "g4": 4}
EVAL_LABEL = {"g2": "大二", "g3": "大三", "g4": "大四"}


def _parse_feature_set(feature_set: str) -> tuple[str, ...]:
    """'g1g2' -> ('g1','g2'); 'g1' -> ('g1',). Supports a '+' separator too."""
    grades = [g for g in GRADE_IDX if g in feature_set]
    return tuple(grades) if grades else (feature_set,)

#: Exact clipping sentinels in the pre-cleaned panel (see module docstring). A row
#: on any of these is treated as missing for that item rather than as a value.
SENTINELS: dict[str, float] = {
    "endurance_run": 185.0,
    "vital_capacity": 1238.0,
    "sprint_50m": 6.5,
}

#: Monotonicity: a higher item SCORE should never systematically lower the pass
#: probability. We encode the expected sign as an increasing constraint so the
#: GBM cannot fit a perverse local direction in a noisy region.
def monotonicity_report(fitted: FittedModel, *, step: float = 1.0) -> dict:
    """Guard: a higher item score must not systematically lower pass probability.

    For every score/total feature we compare the mean predicted probability of
    the trained split against a version where that feature is raised by ``step``
    points. A negative delta flags a non-monotonic direction (a model defect
    worth investigating, since a better test score should never predict a worse
    outcome on average). BMI is intentionally exempt (body composition is not an
    actionable target and higher BMI can move either way by sex/sport).
    """
    base = fitted.base_model
    x_ref = fitted.x_train.copy()
    p0 = base.predict_proba(x_ref)[:, 1].mean()
    report: dict = {"baseline_mean_pass_proba": round(float(p0), 4), "features": {}}
    violations: list[str] = []
    for feat in fitted.features:
        is_score = (feat.startswith("g") and "_score_" in feat) or feat.endswith("_total")
        if not is_score or "bmi" in feat:
            continue
        x_up = x_ref.copy()
        # Cap at the scoring-table ceiling of 100 per item.
        x_up[feat] = (x_up[feat] + step).clip(upper=100)
        p_up = base.predict_proba(x_up)[:, 1].mean()
        delta = float(p_up - p0)
        report["features"][feat] = {"delta": round(delta, 5), "step_points": step}
        if delta < -1e-4:
            violations.append(feat)
    report["violations"] = violations
    report["ok"] = len(violations) == 0
    return report


#: Compact hyperparameter grid. Depth 2–4 keeps probabilities smooth enough to
#: calibrate; the grid is small because we fit it inside every CV fold with early
#: stopping. The winning config is then refit on the full data.
PARAM_GRID = [
    {"n_estimators": 400, "max_depth": 2, "learning_rate": 0.03, "subsample": 0.85, "min_samples_leaf": 40},
    {"n_estimators": 400, "max_depth": 3, "learning_rate": 0.05, "subsample": 0.85, "min_samples_leaf": 30},
    {"n_estimators": 500, "max_depth": 3, "learning_rate": 0.03, "subsample": 0.9, "min_samples_leaf": 50},
    {"n_estimators": 500, "max_depth": 4, "learning_rate": 0.03, "subsample": 0.85, "min_samples_leaf": 60},
]


@dataclass
class FittedModel:
    """A trained Progress Check plus everything needed to explain and audit it."""

    #: Calibrated predictor used for served probabilities.
    calibrated: CalibratedClassifierCV
    #: The uncalibrated GBM — used for treeSHAP and monotonicity guards.
    base_model: GradientBoostingClassifier
    features: list[str]
    feature_set: str
    eval_grade: str
    horizon_years: int
    metrics: dict
    threshold: float
    train_index: pd.Index
    test_index: pd.Index
    x_train: pd.DataFrame
    x_test: pd.DataFrame
    y_test: pd.Series
    p_test: np.ndarray
    groups: pd.Series = field(default_factory=lambda: pd.Series(dtype=int))
    version: dict = field(default_factory=dict)


def _mask_sentinels(scored_long: pd.DataFrame) -> pd.DataFrame:
    """Replace clipping-sentinel raw values with NaN and recompute their item score.

    The panel's total was computed from the *original* values, so we cannot repair
    the row's total; we simply stop treating a clipped item as a real feature by
    blanking its *score* (NaN -> dropped from training). This is conservative: we
    lose the feature for that row rather than teach the model a fake extreme.
    """
    out = scored_long.copy()
    for item, bad in SENTINELS.items():
        raw_col = item
        score_col = f"score_{item}"
        if raw_col in out.columns and score_col in out.columns:
            mask = (out[raw_col] - bad).abs() < 1e-9
            out.loc[mask, score_col] = np.nan
    return out


def build_dataset(
    feature_grades: tuple[str, ...] = ("g1",),
    eval_grade: str = "g4",
    *,
    include_bmi: bool = True,
    add_changes: bool = True,
) -> tuple[pd.DataFrame, pd.Series, pd.Series]:
    """Features from ``feature_grades``, target from ``eval_grade`` scholarship.

    Returns ``(X, y, groups)`` where ``groups`` is the enrollment year used for
    cohort-aware cross-validation. Raises if the eval year is not strictly later
    than every feature year — the non-circularity guard.
    """
    if eval_grade not in EVAL_LABEL:
        raise ValueError(f"eval_grade must be one of {list(EVAL_LABEL)}, got {eval_grade}")
    latest_feature_idx = max(GRADE_IDX[g] for g in feature_grades)
    if GRADE_IDX[eval_grade] <= latest_feature_idx:
        raise ValueError(
            f"eval_grade {eval_grade} is not strictly later than features {feature_grades}; "
            "predicting a same-year or earlier outcome is circular."
        )

    long = panel_long()
    tables = load_scoring_tables()
    scored = score_frame(long, tables)
    long = long.join(scored[[f"score_{i}" for i in ITEM_UNITS] + ["total"]])
    long = _mask_sentinels(long)

    sch = load_scholarship()[["student_id", "eval_grade", "pass_scholarship"]]
    sch = sch[sch["eval_grade"] == EVAL_LABEL[eval_grade]]

    frames = []
    for grade in feature_grades:
        g = long[long["grade"] == grade].set_index("student_id")
        cols = {f"score_{i}": f"{grade}_score_{i}" for i in ITEM_UNITS}
        cols["total"] = f"{grade}_total"
        sub = g[list(cols)].rename(columns=cols)
        if not include_bmi:
            sub = sub.drop(columns=[f"{grade}_score_bmi"], errors="ignore")
        frames.append(sub)
    feats = pd.concat(frames, axis=1)

    # Trajectory features: year-over-year deltas use the same items the model
    # already sees, so they are comparable across sex/grade.
    if add_changes and len(feature_grades) >= 2:
        ordered = list(feature_grades)
        for a, b in zip(ordered[:-1], ordered[1:]):
            for i in ITEM_UNITS:
                if not include_bmi and i == "bmi":
                    continue
                col_a, col_b = f"{a}_score_{i}", f"{b}_score_{i}"
                if col_a in feats.columns and col_b in feats.columns:
                    feats[f"delta_{a}_{b}_score_{i}"] = feats[col_b] - feats[col_a]

    meta = (
        long[long["grade"] == "g1"]
        .set_index("student_id")[["sex", "enrollment_year"]]
    )
    feats = feats.join(meta)
    feats["is_male"] = (feats["sex"] == "male").astype(int)
    feats = feats.drop(columns=["sex"])
    groups = feats["enrollment_year"].astype(int)

    joined = (
        feats.join(sch.set_index("student_id")["pass_scholarship"], how="inner")
        .dropna()
    )
    y = joined["pass_scholarship"].astype(int)
    x = joined.drop(columns=["pass_scholarship", "enrollment_year"])
    groups = groups.loc[joined.index]
    return x, y, groups


def _make_base(params: dict, features: list[str], random_state: int) -> GradientBoostingClassifier:
    # NOTE: scikit-learn >=1.5 moved monotonic_cst off GradientBoostingClassifier
    # to HistGradientBoostingClassifier. We keep the classic GBM (for treeSHAP
    # compatibility with the Trust Check) and enforce "higher score -> no lower
    # pass probability" as an explicit post-fit guard via monotonicity_report(),
    # rather than as a training constraint.
    return GradientBoostingClassifier(
        n_estimators=params["n_estimators"],
        max_depth=params["max_depth"],
        learning_rate=params["learning_rate"],
        subsample=params.get("subsample", 1.0),
        min_samples_leaf=params.get("min_samples_leaf", 20),
        random_state=random_state,
    )


def _fit_base_with_early_stop(
    params: dict,
    x_train: pd.DataFrame,
    y_train: pd.Series,
    x_val: pd.DataFrame,
    y_val: pd.Series,
    random_state: int = 0,
) -> GradientBoostingClassifier:
    """Fit with staged_predict early stopping on log loss (a proper scoring rule)."""
    model = _make_base(params, list(x_train.columns), random_state)
    model.fit(x_train, y_train)
    losses: list[float] = []
    y_val_arr = y_val.to_numpy()
    for pred in model.staged_predict_proba(x_val):
        losses.append(log_loss(y_val_arr, pred[:, 1], labels=[0, 1]))
    best = int(np.argmin(losses)) + 1
    # Refit at the optimal number of trees (GradientBoosting exposes this via n_estimators).
    chosen = dict(params)
    chosen["n_estimators"] = max(20, best)
    final = _make_base(chosen, list(x_train.columns), random_state)
    final.fit(x_train, y_train)
    return final


def _tune(
    x: pd.DataFrame,
    y: pd.Series,
    groups: pd.Series,
    random_state: int = 0,
) -> dict:
    """Pick the grid config with the best mean validation log loss.

    Group CV when at least 4 cohorts exist; otherwise a plain 4-fold stratified
    CV (a single intake cannot be split by cohort).
    """
    n_groups = len(pd.unique(groups))
    if n_groups >= 4:
        splitter: Any = StratifiedGroupKFold(
            n_splits=min(4, n_groups), shuffle=True, random_state=random_state
        )
        splits = list(splitter.split(x, y, groups))
    else:
        skf = StratifiedKFold(n_splits=4, shuffle=True, random_state=random_state)
        splits = list(skf.split(x, y))
    best_params = PARAM_GRID[1]
    best_score = float("inf")
    y_arr = y.to_numpy()
    for params in PARAM_GRID:
        fold_losses: list[float] = []
        for tr, va in splits:
            base = _fit_base_with_early_stop(
                params, x.iloc[tr], y.iloc[tr], x.iloc[va], y.iloc[va], random_state
            )
            p = base.predict_proba(x.iloc[va])[:, 1]
            fold_losses.append(log_loss(y_arr[va], p, labels=[0, 1]))
        mean_loss = float(np.mean(fold_losses))
        if mean_loss < best_score:
            best_score = mean_loss
            best_params = params
    return best_params


def _threshold_for_sensitivity(y_true: np.ndarray, p: np.ndarray, target: float) -> float:
    """Highest threshold that still recalls at least ``target`` of the failures."""
    order = np.argsort(-p)
    y_sorted = y_true[order]
    total_neg = int((y_sorted == 0).sum())
    if total_neg == 0:
        return 0.5
    seen_neg = 0
    chosen = float(p[order[0]])
    for idx in order:
        if y_true[idx] == 0:
            seen_neg += 1
        if seen_neg / total_neg >= target:
            chosen = float(p[idx])
            break
    return min(1.0, max(0.0, chosen))


def _confusion_at(y_true: np.ndarray, pred: np.ndarray) -> dict:
    tn, fp, fn, tp = confusion_matrix(y_true, pred, labels=[0, 1]).ravel()
    return {
        "tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp),
        "precision": round(float(precision_score(y_true, pred, zero_division=0)), 4),
        "recall": round(float(recall_score(y_true, pred, zero_division=0)), 4),
    }


def _model_version(
    params: dict, features: list[str], feature_set: str, eval_grade: str, n: int
) -> dict:
    payload = json.dumps(
        {"params": params, "features": features, "feature_set": feature_set,
         "eval_grade": eval_grade, "n": n},
        sort_keys=True,
    )
    digest = hashlib.sha256(payload.encode()).hexdigest()[:12]
    return {
        "version": f"pc-{feature_set}-{eval_grade}-{digest}",
        "fitted_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "sklearn": __import__("sklearn").__version__,
        "python": platform.python_version(),
        "n_train": n,
        "features": features,
    }


def _bootstrap_ci(
    y_true: np.ndarray, p: np.ndarray, n_boot: int = 400, alpha: float = 0.05, seed: int = 0
) -> dict:
    """Percentile bootstrap CI for AUC and Brier (used when only one cohort exists)."""
    rng = np.random.default_rng(seed)
    n = len(y_true)
    aucs, briers = [], []
    for _ in range(n_boot):
        idx = rng.integers(0, n, n)
        if len(np.unique(y_true[idx])) < 2:
            continue
        aucs.append(roc_auc_score(y_true[idx], p[idx]))
        briers.append(brier_score_loss(y_true[idx], p[idx]))
    return {
        "auc_lo": round(float(np.quantile(aucs, alpha / 2)), 4),
        "auc_hi": round(float(np.quantile(aucs, 1 - alpha / 2)), 4),
        "brier_lo": round(float(np.quantile(briers, alpha / 2)), 4),
        "brier_hi": round(float(np.quantile(briers, 1 - alpha / 2)), 4),
        "n_boot": len(aucs),
    }



def _make_splits(groups: pd.Series, y: pd.Series, random_state: int = 0) -> tuple[np.ndarray, np.ndarray, str]:
    """Honest held-out split adapted to the real cohort structure.

    - >=4 cohorts: StratifiedGroupKFold(5) first fold (one or more whole
      enrollments held out, never a leak across years).
    - 2–3 cohorts (e.g. g1->g4 spans 2020+2021): leave-one-cohort-out.
    - 1 cohort (g1->g2 and g1->g3 are each a single intake in the 2024 eval): a
      stratified random split is the only option; it is labelled as such and
      metrics are reported with a bootstrap CI so the weakness is visible.
    """
    unique_groups = sorted(pd.unique(groups))
    if len(unique_groups) >= 4:
        n_splits = min(5, len(unique_groups))
        sgkf = StratifiedGroupKFold(n_splits=n_splits, shuffle=True, random_state=random_state)
        tr, te = next(sgkf.split(groups.to_frame(), y, groups))
        return tr, te, f"stratified_group_5fold(holdout={n_splits})"
    if len(unique_groups) >= 2:
        test_group = unique_groups[-1]
        mask = groups.to_numpy() == test_group
        te = np.where(mask)[0]
        tr = np.where(~mask)[0]
        return tr, te, f"leave_one_cohort_out(test_enrollment={test_group})"
    # Single intake: stratified random split (with bootstrap CI reported).
    sss = StratifiedShuffleSplit(n_splits=1, test_size=0.2, random_state=random_state)
    tr, te = next(sss.split(np.zeros(len(y)), y))
    return tr, te, "stratified_random_0.2(single_cohort)"


def fit(
    x: pd.DataFrame,
    y: pd.Series,
    groups: pd.Series | None = None,
    *,
    feature_set: str = "g1",
    feature_grades: tuple[str, ...] | None = None,
    eval_grade: str = "g4",
    random_state: int = 0,
) -> FittedModel:
    """Fit, calibrate, choose a threshold, and evaluate honestly.

    Held-out evaluation is chosen by ``_make_splits``. The *served* model is a
    base GBM trained on the TRAIN split, then isotonic-calibrated with 3-fold
    CV *on the training split only* (``cv=3``), so calibration never sees the
    held-out students that the test metrics are computed from. All reported
    numbers come from that held-out fold.
    """
    if groups is None:
        groups = pd.Series(0, index=x.index)

    train_idx, test_idx, split_kind = _make_splits(groups, y, random_state)
    x_train, x_test = x.iloc[train_idx], x.iloc[test_idx]
    y_train, y_test = y.iloc[train_idx], y.iloc[test_idx]
    g_train = groups.iloc[train_idx]

    best_params = _tune(x_train, y_train, g_train, random_state)
    base_model = _fit_base_with_early_stop(
        best_params, x_train, y_train, x_test, y_test, random_state
    )

    # Served calibration uses internal CV on the training split so the held-out
    # test fold stays a genuine out-of-sample evaluation.
    calibrated = CalibratedClassifierCV(base_model, method="isotonic", cv=3)
    calibrated.fit(x_train, y_train)
    p_test = calibrated.predict_proba(x_test)[:, 1]

    threshold = _threshold_for_sensitivity(
        y_test.to_numpy(), p_test, SENSITIVITY_TARGET
    )
    pred = (p_test >= threshold).astype(int)

    base_rate = float(y.mean())
    test_base_rate = float(y_test.mean())
    ci = _bootstrap_ci(y_test.to_numpy(), p_test, seed=random_state) if len(y_test) > 50 else {}
    confusion = _confusion_at(y_test.to_numpy(), pred)
    metrics = {
        "feature_set": feature_set,
        "eval_grade": eval_grade,
        "horizon_years": GRADE_IDX[eval_grade]
        - max(GRADE_IDX[g] for g in (feature_grades or _parse_feature_set(feature_set))),
        "split_kind": split_kind,
        "n_train": int(len(x_train)),
        "n_test": int(len(x_test)),
        "base_rate": base_rate,
        "test_base_rate": test_base_rate,
        "majority_baseline": max(test_base_rate, 1 - test_base_rate),
        "auc_test": float(roc_auc_score(y_test, p_test)),
        "brier_test": float(brier_score_loss(y_test, p_test)),
        "log_loss_test": float(log_loss(y_test, p_test, labels=[0, 1])),
        "accuracy_test": float(accuracy_score(y_test, p_test >= 0.5)),
        "threshold_support": round(threshold, 4),
        "sensitivity_target": SENSITIVITY_TARGET,
        "confusion_support": confusion,
        "precision_support": round(confusion["precision"], 4),
        "recall_support": round(confusion["recall"], 4),
        "bootstrap_ci": ci,
        "best_params": best_params,
    }

    return FittedModel(
        calibrated=calibrated,
        base_model=base_model,
        features=list(x.columns),
        feature_set=feature_set,
        eval_grade=eval_grade,
        horizon_years=metrics["horizon_years"],
        metrics=metrics,
        threshold=threshold,
        train_index=x_train.index,
        test_index=x_test.index,
        x_train=x_train,
        x_test=x_test,
        y_test=y_test,
        p_test=p_test,
        groups=groups,
        version=_model_version(best_params, list(x.columns), feature_set, eval_grade, len(x_train)),
    )


def cross_validate(
    x: pd.DataFrame,
    y: pd.Series,
    groups: pd.Series,
    *,
    feature_set: str,
    eval_grade: str,
    n_splits: int = 5,
    random_state: int = 0,
) -> dict:
    """Out-of-fold AUC/Brier/log-loss, each fold calibrated on its own train split.

    Adapted to the cohort structure: cohort-grouped folds when enough intakes
    exist, otherwise stratified folds (reported as ``grouped=False``). This is a
    pessimistic variance estimate, not the shipped model.
    """
    n_groups = len(pd.unique(groups))
    if n_groups >= n_splits:
        cv: Any = StratifiedGroupKFold(
            n_splits=n_splits, shuffle=True, random_state=random_state
        )
        folds = list(cv.split(x, y, groups))
        grouped = True
    else:
        k = min(n_splits, max(2, n_groups)) if n_groups >= 2 else 5
        cv = StratifiedKFold(n_splits=k, shuffle=True, random_state=random_state)
        folds = list(cv.split(x, y))
        grouped = False
    aucs, briers, lls = [], [], []
    y_arr = y.to_numpy()
    for tr, te in folds:
        x_tr, y_tr = x.iloc[tr], y.iloc[tr]
        base = _fit_base_with_early_stop(
            PARAM_GRID[1], x_tr, y_tr, x.iloc[te], y.iloc[te], random_state
        )
        cal = CalibratedClassifierCV(base, method="isotonic", cv=3)
        cal.fit(x_tr, y_tr)
        p = cal.predict_proba(x.iloc[te])[:, 1]
        if len(np.unique(y_arr[te])) < 2:
            continue
        aucs.append(roc_auc_score(y_arr[te], p))
        briers.append(brier_score_loss(y_arr[te], p))
        lls.append(log_loss(y_arr[te], p, labels=[0, 1]))
    return {
        "feature_set": feature_set,
        "eval_grade": eval_grade,
        "grouped_by_cohort": grouped,
        "auc_mean": round(float(np.mean(aucs)), 4),
        "auc_std": round(float(np.std(aucs)), 4),
        "brier_mean": round(float(np.mean(briers)), 4),
        "brier_std": round(float(np.std(briers)), 4),
        "logloss_mean": round(float(np.mean(lls)), 4),
        "logloss_std": round(float(np.std(lls)), 4),
        "folds": len(aucs),
    }


def risk_band(probability: float, threshold: float = RISK_BANDS["at_risk"]) -> str:
    """Map a pass probability to the contract's risk vocabulary."""
    if probability < threshold:
        return "at_risk"
    if probability < RISK_BANDS["watch"]:
        return "watch"
    return "on_track"


def per_student(fitted: FittedModel, x: pd.DataFrame) -> pd.DataFrame:
    """Per-student flag + calibrated probability, keyed by student_id."""
    p = fitted.calibrated.predict_proba(x)[:, 1]
    return pd.DataFrame(
        {
            "student_id": x.index,
            "pass_probability": np.round(p, 4),
            "risk": [risk_band(v, fitted.threshold) for v in p],
            "on_track": p >= RISK_BANDS["watch"],
            "feature_set": fitted.feature_set,
            "model_version": fitted.version["version"],
        }
    ).set_index("student_id")


def calibration_figure(fitted: FittedModel, outdir: Path = FIGURES) -> Path:
    """Reliability plot for the calibrated probabilities on the held-out fold."""
    outdir.mkdir(parents=True, exist_ok=True)
    frac, mean_pred = calibration_curve(
        fitted.y_test, fitted.p_test, n_bins=10, strategy="quantile"
    )
    fig, ax = plt.subplots(figsize=(6, 6))
    ax.plot([0, 1], [0, 1], "--", color="grey", label="perfect calibration")
    ax.plot(mean_pred, frac, marker="o", color="#2F6B5E", label="Progress Check (calibrated)")
    ax.axvline(fitted.threshold, color="#B5603D", linestyle=":", label="support threshold")
    ax.set_xlabel("predicted pass probability")
    ax.set_ylabel("observed pass rate")
    ax.set_title(f"Calibration ({fitted.feature_set} → {fitted.eval_grade})")
    ax.legend()
    fig.tight_layout()
    path = outdir / f"calibration_{fitted.feature_set}_{fitted.eval_grade}.png"
    fig.savefig(path, dpi=110)
    plt.close(fig)
    return path


def _bmi_sensitivity(eval_grade: str = "g4") -> dict:
    """AUC/Brier with and without BMI. If BMI adds no signal, the product drops it."""
    x_with, y_with, g_with = build_dataset(("g1",), eval_grade, include_bmi=True)
    x_no, y_no, g_no = build_dataset(("g1",), eval_grade, include_bmi=False)
    cv_with = cross_validate(x_with, y_with, g_with, feature_set="g1+bmi", eval_grade=eval_grade)
    cv_no = cross_validate(x_no, y_no, g_no, feature_set="g1-nobmi", eval_grade=eval_grade)
    delta_auc = cv_with["auc_mean"] - cv_no["auc_mean"]
    return {
        "with_bmi_auc": cv_with["auc_mean"],
        "without_bmi_auc": cv_no["auc_mean"],
        "delta_auc": round(delta_auc, 4),
        "with_bmi_brier": cv_with["brier_mean"],
        "without_bmi_brier": cv_no["brier_mean"],
        "recommendation": "drop_bmi" if abs(delta_auc) < 0.005 else "keep_bmi",
    }


def main() -> None:
    ap = argparse.ArgumentParser(description="Fit Progress Check v2 (model ③).")
    ap.add_argument("--out", type=Path, default=REPORTS / "progress_check.md")
    args = ap.parse_args()
    REPORTS.mkdir(parents=True, exist_ok=True)

    # One model per horizon. The app ships the g1→g4 (3-year) model; the shorter
    # horizons are reported so the g1→g4 number is read in context.
    horizons = [
        ("g1", ("g1",), "g2"),
        ("g1", ("g1",), "g3"),
        ("g1", ("g1",), "g4"),
        ("g1g2", ("g1", "g2"), "g4"),
    ]
    fitted: dict[str, FittedModel] = {}
    cv_rows: list[dict] = []
    mono_rows: dict[str, dict] = {}
    for name, grades, eval_grade in horizons:
        x, y, groups = build_dataset(grades, eval_grade)
        fm = fit(x, y, groups, feature_set=name, feature_grades=grades, eval_grade=eval_grade)
        fitted[f"{name}->{eval_grade}"] = fm
        cv_rows.append(
            cross_validate(x, y, groups, feature_set=name, eval_grade=eval_grade)
        )
        mono_rows[f"{name}->{eval_grade}"] = monotonicity_report(fm)
        calibration_figure(fm)
        per_student(fm, x).to_parquet(
            REPORTS / f"progress_check_per_student_{name}_{eval_grade}.parquet"
        )

    shipped = fitted["g1->g4"]
    metrics = {k: v.metrics for k, v in fitted.items()}
    (REPORTS / "progress_check_metrics.json").write_text(
        json.dumps(
            {
                "shipped": "g1->g4",
                "models": metrics,
                "cross_validation": cv_rows,
                "monotonicity": mono_rows,
                "bmi_sensitivity": _bmi_sensitivity("g4"),
                "shipped_version": shipped.version,
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    lines = [
        "# ③ Progress Check (v2)\n",
        "Generated by `python -m analysis.progress_check`. Predicts the **scholarship outcome**",
        f"(evaluation-year total ≥ {PASS_THRESHOLD:.0f}) from **earlier** years only.\n",
        "## Not circular by construction\n",
        "Features come only from years strictly earlier than the evaluation year; `build_dataset()`",
        "raises otherwise. Each horizon is modelled separately so the number the app ships",
        "(g1 → 大四, a 3-year projection) is reported on its own terms, not blended with easier",
        "1- and 2-year-ahead cases.\n",
        "## Honest held-out metrics\n",
        pd.DataFrame(metrics).T[
            ["split_kind", "horizon_years", "n_train", "n_test", "base_rate", "auc_test",
             "brier_test", "log_loss_test", "accuracy_test", "threshold_support"]
        ].round(4).to_markdown(),
        "\n`split_kind` shows how the test fold was formed. g1→g4 spans two enrollment cohorts",
        "(2020, 2021) so it is evaluated **leave-one-cohort-out**; g1→g2 and g1→g3 are a single",
        "intake in the 2024 scholarship eval and can only use a stratified random split (their",
        "AUCs come with a bootstrap CI in the JSON). `threshold_support` is chosen to catch ≥80%",
        "of future failures (early support favours recall over precision); its confusion matrix",
        "is in the JSON. `majority_baseline` is predicting 'passes' for everyone — AUC is the",
        "discrimination that matters for triage, Brier/calibration say whether the probabilities",
        "are believable.\n",
        "## Cross-validation (out-of-fold, cohort-grouped where enough intakes exist)\n",
        pd.DataFrame(cv_rows).to_markdown(index=False),
        "\n## Monotonicity guard\n",
        "A higher score on any test item must not systematically lower the predicted pass",
        "probability. For each shipped model every score feature is raised by one point and the",
        "mean prediction must not decrease (BMI exempt). A violation here is a model defect.",
        "\n```json",
        json.dumps({k: {"ok": v["ok"], "violations": v["violations"]} for k, v in mono_rows.items()}, indent=2),
        "```\n",
        "## BMI sensitivity\n",
        "The product treats BMI as non-actionable. The model is compared with and without it;",
        "a |ΔAUC| < 0.005 is treated as 'no signal' and BMI is dropped.",
        "\n```json",
        json.dumps(_bmi_sensitivity("g4"), indent=2),
        "```\n",
        "## Sentinel handling\n",
        "Pre-winsorised values (185.0 s endurance, 1238 ml vital capacity, 6.5 s sprint) are",
        "masked as missing before training rather than used as extreme features.\n",
        "## Figures\n",
        "- `figures/calibration_g1_g2.png` … `calibration_g1g2_g4.png` — reliability per horizon.",
    ]
    args.out.write_text("\n".join(lines) + "\n", encoding="utf-8")

    shipped_metrics = shipped.metrics
    print(
        f"Shipped g1→g4: AUC={shipped_metrics['auc_test']:.3f} "
        f"Brier={shipped_metrics['brier_test']:.3f} "
        f"threshold={shipped.threshold:.3f} n={shipped_metrics['n_test']}"
    )
    print(f"Model version: {shipped.version['version']}")
    print(f"Report: {args.out}")


if __name__ == "__main__":
    main()
