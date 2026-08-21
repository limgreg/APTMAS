"""④ Student Types — "what kinds of students are there, so advice fits the person?"

Three outputs, in increasing order of how much machinery they need:

1. **EDA** of the seven scored items — distributions, correlations, and the g1→g4 trajectory.
2. **Weakness profile** per student — which items hold them back, and by how much.
3. **Segments** — a small number of interpretable groups, each with a plain-language profile,
   including the **low-baseline group the whole system exists for**.

**Why we profile on item scores, not raw values.** The standard already normalises for sex
and grade group: 30 sit-ups and 10 pull-ups are not comparable, but the 60 points each earns
are. Profiling on scores therefore compares like with like without inventing a normalisation,
and every statement stays traceable to the rule engine.

Guardrails (``AGENTS.md``, ``docs/task_a_plan.md`` §7):

* Segments exist to **tailor guidance**, and for teachers in aggregate. They are never a
  student-facing ranking and carry no ordering.
* Labels are **directional and non-evaluative** — "endurance is where the headroom is", never
  "below standard" or "weak student".
* No weight-loss, caloric or body-image framing. BMI is reported as context only and is never
  part of a weakness profile.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.metrics import adjusted_rand_score, silhouette_score
from sklearn.mixture import GaussianMixture

from analysis.loaders import ITEM_UNITS, load_business_class, panel_long
from analysis.route_to_pass import PASS_THRESHOLD
from analysis.scorecard import score_frame
from aptams.rule_engine.tables import load_scoring_tables

REPORTS = Path("analysis/reports")
FIGURES = REPORTS / "figures"

#: Items eligible for a weakness profile. BMI is excluded on purpose — naming body mass as a
#: "weakness" is body-image framing, which this project forbids outright.
PROFILE_ITEMS = tuple(i for i in ITEM_UNITS if i != "bmi")

#: An item score at or below this is what actually holds a student back: it is the standard's
#: own 及格 line, not a threshold we invented.
ITEM_PASS_LINE = 60.0

#: Number of segments. Chosen by silhouette + interpretability in :func:`choose_k`.
DEFAULT_K = 4


def scored_panel() -> pd.DataFrame:
    """The long panel with per-item scores attached."""
    long = panel_long()
    scored = score_frame(long, load_scoring_tables())
    out = long.join(scored[[f"score_{i}" for i in ITEM_UNITS] + ["total", "band"]])
    return out


# --- 1. EDA ---------------------------------------------------------------------------------


def eda(df: pd.DataFrame, outdir: Path = FIGURES) -> dict[str, pd.DataFrame]:
    """Distributions, correlations and the grade trajectory. Saves figures, returns tables."""
    outdir.mkdir(parents=True, exist_ok=True)
    tables: dict[str, pd.DataFrame] = {}

    # Item score distributions by sex.
    fig, axes = plt.subplots(2, 4, figsize=(18, 8))
    for ax, item in zip(axes.ravel(), ITEM_UNITS, strict=False):
        for sex, colour in (("male", "#4C72B0"), ("female", "#DD8452")):
            vals = df.loc[df["sex"] == sex, f"score_{item}"]
            ax.hist(vals, bins=20, alpha=0.55, label=sex, color=colour)
        ax.set_title(item)
        ax.set_xlabel("item score")
    axes.ravel()[-1].axis("off")
    axes.ravel()[0].legend()
    fig.suptitle("Item score distributions by sex (national standard scoring)")
    fig.tight_layout()
    fig.savefig(outdir / "item_score_distributions.png", dpi=110)
    plt.close(fig)

    # Correlation of item scores with the total.
    corr = (
        df[[f"score_{i}" for i in ITEM_UNITS] + ["total"]]
        .corr()["total"]
        .drop("total")
        .sort_values(ascending=False)
        .rename("corr_with_total")
        .to_frame()
    )
    corr["weight"] = [
        load_scoring_tables().item_weight(item=i.removeprefix("score_")) for i in corr.index
    ]
    tables["correlation_with_total"] = corr

    fig, ax = plt.subplots(figsize=(8, 4.5))
    ax.barh(
        [i.removeprefix("score_") for i in corr.index],
        corr["corr_with_total"],
        color="#4C72B0",
    )
    ax.set_xlabel("correlation with total score")
    ax.set_title("Which items move the total")
    fig.tight_layout()
    fig.savefig(outdir / "item_correlation_with_total.png", dpi=110)
    plt.close(fig)

    # Grade trajectory: mean item score by grade.
    traj = df.groupby("grade")[[f"score_{i}" for i in ITEM_UNITS]].mean()
    traj.columns = [c.removeprefix("score_") for c in traj.columns]
    tables["grade_trajectory"] = traj

    fig, ax = plt.subplots(figsize=(9, 5))
    for item in traj.columns:
        ax.plot(traj.index, traj[item], marker="o", label=item)
    ax.set_ylabel("mean item score")
    ax.set_xlabel("grade")
    ax.set_title("Item scores across the four years (same students throughout)")
    ax.legend(fontsize=8, ncol=2)
    fig.tight_layout()
    fig.savefig(outdir / "grade_trajectory.png", dpi=110)
    plt.close(fig)

    # Share of students under the pass line, by grade.
    gate = df.groupby("grade").apply(
        lambda g: pd.Series({
            "share_below_pass": float((g["total"] < PASS_THRESHOLD).mean()),
            "mean_total": float(g["total"].mean()),
        }),
        include_groups=False,
    )
    tables["pass_gate_by_grade"] = gate
    return tables


# --- 2. Weakness profile --------------------------------------------------------------------


def weakness_profile(df: pd.DataFrame) -> pd.DataFrame:
    """Per student-year: which items hold them back, ranked by recoverable points.

    ``headroom`` is the weighted points an item would add if it reached the 及格 line — the
    honest measure of what is holding a total down, because it accounts for item weight.
    Ranking by it is what makes the profile actionable rather than merely descriptive.
    """
    tables = load_scoring_tables()
    out = df[["student_id", "sex", "grade", "total", "band"]].copy()

    headroom = {}
    for item in PROFILE_ITEMS:
        weight = tables.item_weight(item=item)
        gap = (ITEM_PASS_LINE - df[f"score_{item}"]).clip(lower=0)
        headroom[item] = gap * weight
        out[f"below_pass_{item}"] = df[f"score_{item}"] < ITEM_PASS_LINE
    head = pd.DataFrame(headroom, index=df.index)

    out["n_items_below_pass"] = head.gt(0).sum(axis=1)
    out["recoverable_points"] = head.sum(axis=1).round(2)
    order = np.argsort(-head.to_numpy(), axis=1)
    cols = np.array(head.columns)
    out["weakest_item"] = np.where(
        out["recoverable_points"] > 0, cols[order[:, 0]], "none_below_pass"
    )
    out["weaknesses"] = [
        [c for c in cols[row] if head.iloc[i][c] > 0][:3]
        for i, row in enumerate(order)
    ]
    return out


# --- 3. Segments ----------------------------------------------------------------------------


def choose_k(features: np.ndarray, candidates: range = range(2, 7)) -> pd.DataFrame:
    """Silhouette across candidate k. Reported so the choice is visible, not asserted."""
    rng = np.random.default_rng(0)
    idx = rng.choice(len(features), size=min(8000, len(features)), replace=False)
    rows = []
    for k in candidates:
        km = KMeans(n_clusters=k, n_init=10, random_state=0).fit(features)
        rows.append({
            "k": k,
            "silhouette": round(float(silhouette_score(features[idx], km.labels_[idx])), 4),
            "inertia": round(float(km.inertia_), 1),
        })
    return pd.DataFrame(rows)


def _jaccard_partition(a: np.ndarray, b: np.ndarray) -> float:
    """Mean best-match Jaccard between two partitions' clusters (label-order free)."""
    scores: list[float] = []
    for ca in np.unique(a):
        members = a == ca
        # Compare this cluster against every cluster in b and take the best overlap.
        best = 0.0
        for cb in np.unique(b):
            inter = float(np.sum(members & (b == cb)))
            union = float(np.sum(members | (b == cb)))
            if union > 0:
                best = max(best, inter / union)
        scores.append(best)
    return float(np.mean(scores)) if scores else 0.0


def cluster_stability(
    features: np.ndarray,
    k: int,
    *,
    n_boot: int = 40,
    sample_rate: float = 0.8,
    random_state: int = 0,
) -> dict:
    """How stable are the k segments under resampling?

    A segmentation is only trustworthy if small changes to the input don't reshuffle
    who sits with whom. We bootstrap 80% subsamples, refit KMeans on each, and compare
    the overlapping students to a reference fit using both Adjusted Rand Index
    (global label agreement) and mean best-match Jaccard (per-cluster overlap).
    Silhouette alone cannot detect an unstable partition.
    """
    rng = np.random.default_rng(random_state)
    n = len(features)
    ref = KMeans(n_clusters=k, n_init=10, random_state=0).fit_predict(features)
    aris, jaccards = [], []
    for _ in range(n_boot):
        idx = rng.choice(n, size=int(n * sample_rate), replace=False)
        sub = features[idx]
        if len(np.unique(ref[idx])) < k:
            continue  # a rare subsample that dropped a cluster entirely
        labels = KMeans(n_clusters=k, n_init=10, random_state=0).fit_predict(sub)
        aris.append(adjusted_rand_score(ref[idx], labels))
        jaccards.append(_jaccard_partition(ref[idx], labels))
    return {
        "k": k,
        "ari_mean": round(float(np.mean(aris)), 4),
        "ari_std": round(float(np.std(aris)), 4),
        "jaccard_mean": round(float(np.mean(jaccards)), 4),
        "jaccard_std": round(float(np.std(jaccards)), 4),
        "n_boot": len(aris),
    }


def compare_gmm(features: np.ndarray, k: int, *, random_state: int = 0) -> dict:
    """Compare hard KMeans against a soft Gaussian-mixture assignment.

    If the GMM puts many students on a cluster boundary (low max posterior), the
    data is genuinely continuous and segment labels should be read as emphasis
    rather than boxes — that nuance is surfaced rather than hidden. Returns the
    ARI between the two partitions plus posterior-ambiguity statistics.
    """
    km = KMeans(n_clusters=k, n_init=10, random_state=random_state).fit_predict(features)
    gmm = GaussianMixture(
        n_components=k, covariance_type="full", n_init=3, random_state=random_state
    ).fit(features)
    soft = gmm.predict_proba(features)
    max_post = soft.max(axis=1)
    return {
        "k": k,
        "ari_kmeans_vs_gmm": round(float(adjusted_rand_score(km, gmm.predict(features))), 4),
        "gmm_bic": round(float(gmm.bic(features)), 1),
        "mean_max_posterior": round(float(max_post.mean()), 4),
        "share_ambiguous_lt_0p7": round(float((max_post < 0.7).mean()), 4),
    }


def segment(df: pd.DataFrame, k: int = DEFAULT_K) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Cluster on item scores and attach a plain-language profile to each segment.

    Item scores are already on a common 0-100 scale set by the standard, so they are clustered
    as-is: standardising them would distort distances that the standard has already made
    comparable.
    """
    feats = df[[f"score_{i}" for i in PROFILE_ITEMS]].to_numpy(dtype=float)
    km = KMeans(n_clusters=k, n_init=10, random_state=0).fit(feats)
    labels = km.labels_

    centres = pd.DataFrame(km.cluster_centers_, columns=list(PROFILE_ITEMS))
    centres["mean_total"] = [df.loc[labels == c, "total"].mean() for c in range(k)]
    centres["n"] = [int((labels == c).sum()) for c in range(k)]
    centres["share_below_pass"] = [
        float((df.loc[labels == c, "total"] < PASS_THRESHOLD).mean()) for c in range(k)
    ]

    overall = centres[list(PROFILE_ITEMS)].mean()
    profiles = []
    for c in range(k):
        row = centres.loc[c, list(PROFILE_ITEMS)]
        rel = (row - overall).sort_values()
        weakest, strongest = rel.index[0], rel.index[-1]
        low_baseline = bool(centres.loc[c, "mean_total"] == centres["mean_total"].min())
        profiles.append({
            "segment_id": _segment_id(weakest, low_baseline),
            "cluster": c,
            "label_en": _segment_label_en(weakest, strongest, low_baseline),
            "label_zh": _segment_label_zh(weakest, low_baseline),
            "headroom_item": weakest,
            "relative_strength": strongest,
            "mean_total": round(float(centres.loc[c, "mean_total"]), 1),
            "n": int(centres.loc[c, "n"]),
            "share_below_pass": round(float(centres.loc[c, "share_below_pass"]), 3),
            "is_low_baseline": low_baseline,
        })
    profile_df = pd.DataFrame(profiles).sort_values("mean_total").reset_index(drop=True)

    assigned = df[["student_id", "grade", "total"]].copy()
    mapping = dict(zip(profile_df["cluster"], profile_df["segment_id"], strict=True))
    assigned["segment_id"] = [mapping[c] for c in labels]
    return assigned, profile_df


_ITEM_EN = {
    "vital_capacity": "lung capacity", "sprint_50m": "sprint speed",
    "standing_long_jump": "explosive power", "sit_and_reach": "flexibility",
    "endurance_run": "endurance", "strength": "upper-body / core strength",
}
_ITEM_ZH = {
    "vital_capacity": "肺活量", "sprint_50m": "速度", "standing_long_jump": "爆发力",
    "sit_and_reach": "柔韧性", "endurance_run": "耐力", "strength": "力量",
}


def _segment_id(weakest: str, low_baseline: bool) -> str:
    return "broad_headroom" if low_baseline else f"{weakest}_headroom"


def _segment_label_en(weakest: str, strongest: str, low_baseline: bool) -> str:
    if low_baseline:
        return "Broad headroom — room to grow across most items; the group this system is for"
    return f"{_ITEM_EN[weakest].capitalize()} is the headroom; {_ITEM_EN[strongest]} is ahead"


def _segment_label_zh(weakest: str, low_baseline: bool) -> str:
    return "整体提升空间型" if low_baseline else f"{_ITEM_ZH[weakest]}提升空间型"


def compare_with_handcut(assigned: pd.DataFrame) -> pd.DataFrame:
    """Cross-tabulate our segments against the team's existing hand-cut labels.

    The hand-cut labels are a **baseline to compare against, not ground truth**
    (``docs/task_a_plan.md`` §5). They describe *change* (``delta_score``); ours describe the
    *shape* of a student's fitness. Low agreement is expected and informative, not a failure.
    """
    bc = load_business_class()[["student_id", "business_cat", "improve_cat", "delta_score"]]
    merged = assigned[assigned["grade"] == "g1"].merge(bc, on="student_id", how="inner")
    return pd.crosstab(merged["segment_id"], merged["business_cat"])


# --- Report ---------------------------------------------------------------------------------


def main() -> None:
    ap = argparse.ArgumentParser(description="Build Student Types (model ④).")
    ap.add_argument("--k", type=int, default=DEFAULT_K)
    ap.add_argument("--out", type=Path, default=REPORTS / "student_types.md")
    args = ap.parse_args()
    REPORTS.mkdir(parents=True, exist_ok=True)

    df = scored_panel()
    tables = eda(df)
    profile = weakness_profile(df)
    feats = df[[f"score_{i}" for i in PROFILE_ITEMS]].to_numpy(dtype=float)
    k_table = choose_k(feats)
    assigned, segments = segment(df, k=args.k)
    crosstab = compare_with_handcut(assigned)
    stability = cluster_stability(feats, k=args.k)
    gmm = compare_gmm(feats, k=args.k)

    # Per-student outputs keyed by student_id, for the hand-off object.
    per_student = profile.merge(
        assigned[["student_id", "grade", "segment_id"]], on=["student_id", "grade"]
    )
    per_student.to_parquet(REPORTS / "student_types_per_student.parquet", index=False)
    (REPORTS / "student_types_validation.json").write_text(
        json.dumps(
            {
                "k": args.k,
                "silhouette_table": k_table.to_dict(orient="records"),
                "stability": stability,
                "gmm": gmm,
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    lines = [
        "# ④ Student Types\n",
        "Generated by `python -m analysis.student_types`. Profiling uses **item scores** from",
        "the rule engine, which the national standard has already normalised for sex and grade",
        "group — so 30 sit-ups and 10 pull-ups are compared as the points they actually earn.\n",
        "## Segments\n",
        segments.drop(columns=["cluster"]).to_markdown(index=False),
        "\n> Segments describe the *shape* of a student's fitness so guidance can be tailored.",
        "> They are not a ranking, carry no ordering, and are never shown to a student as a",
        "> label. `is_low_baseline` marks the group the system exists for.\n",
        "## Choosing k\n",
        k_table.to_markdown(index=False),
        f"\nk={args.k} is used: silhouette is flat across this range, so the choice is made on",
        "interpretability — each segment must have a distinct headroom item that a teacher would",
        "recognise. Reported openly rather than presented as an optimum.\n",
        "## Segment stability (bootstrap)\n",
        "Silhouette cannot tell whether the same students keep landing together. On 40",
        "80%-subsample refits the partition is compared back to the reference using Adjusted",
        "Rand Index (global agreement, 1 = identical) and mean best-match Jaccard (per-cluster",
        "overlap).\n",
        "```json",
        json.dumps(stability, indent=2),
        "```\n",
        "## KMeans vs a soft Gaussian mixture\n",
        "If many students sit on a boundary the segments are emphasis, not boxes. The GMM's",
        "max posterior < 0.7 share quantifies how many are ambiguous.\n",
        "```json",
        json.dumps(gmm, indent=2),
        "```\n",
        "## Where the headroom is\n",
        f"- Students with at least one item under the {ITEM_PASS_LINE:.0f}-point line: "
        f"**{(profile['n_items_below_pass'] > 0).mean():.1%}**",
        f"- Median recoverable points among them: "
        f"**{profile.loc[profile['n_items_below_pass'] > 0, 'recoverable_points'].median():.1f}**",
        "- Most common single headroom item:\n",
        profile["weakest_item"].value_counts().to_frame("students").to_markdown(),
        "\n## Item scores across the four years\n",
        tables["grade_trajectory"].round(1).to_markdown(),
        "\n## Correlation with the total\n",
        tables["correlation_with_total"].round(3).to_markdown(),
        "\n## Share under the pass gate, by grade\n",
        tables["pass_gate_by_grade"].round(3).to_markdown(),
        "\n## Our segments vs the team's hand-cut labels\n",
        crosstab.to_markdown(),
        "\nThe hand-cut labels describe *change* (`delta_score`); these segments describe the",
        "*shape* of current fitness. They are answering different questions, so a loose",
        "correspondence is the expected result rather than a defect.\n",
        "## Figures\n",
        "- `figures/item_score_distributions.png`",
        "- `figures/item_correlation_with_total.png`",
        "- `figures/grade_trajectory.png`",
    ]
    args.out.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(segments.drop(columns=["cluster"]).to_string(index=False))
    print(f"\nPer-student output: {REPORTS / 'student_types_per_student.parquet'}")
    print(f"Report: {args.out}")


if __name__ == "__main__":
    main()
