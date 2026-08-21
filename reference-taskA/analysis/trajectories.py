"""Trajectory types: grouping students by how they are *changing*, not where they stand.

Model ④ (``student_types.py``) clusters students on their current item scores and answers
"what is this student weak at". This module answers a different question: **which direction are
they going, and how fast**. The two are complementary and a teacher needs both — a student on
65 who is falling is a more urgent conversation than a student on 62 who is climbing, and no
cross-sectional segment can express that.

**Why rules rather than another KMeans.** Each student contributes four annual totals. With
four points, a clustering would be fitting shapes to noise, and its output would not be
explainable to the student it describes. A slope plus the gate crossings is the honest summary
of four points, and every resulting label is a sentence a PE teacher can say out loud.

**The "meaningful change" threshold is measured, not chosen.** Calling a student "declining"
because their total moved by 0.4 would be reading noise as a trend. :func:`noise_floor`
estimates year-to-year variation that is *not* trend — the residual scatter about each
student's own fitted line — and :data:`SLOPE_THRESHOLD_SD` expresses the threshold in those
units, so the classifier adapts to how noisy the measurement actually is.

Run::

    python -m analysis.trajectories
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd

from analysis.loaders import ITEM_UNITS, panel_long
from analysis.scorecard import score_frame
from aptams.rule_engine.tables import ScoringTables, load_scoring_tables

DEFAULT_REPORT = Path("analysis/reports/trajectories.md")
DEFAULT_JSON = Path("analysis/reports/trajectories.json")

#: The four sittings, in order.
GRADES = ("g1", "g2", "g3", "g4")

#: The scholarship gate, resolved from data in ``analysis/route_to_pass``.
PASS_THRESHOLD = 60.0

#: A slope counts as a real trend once it exceeds this many noise standard deviations per year.
#: Below it we call the student steady rather than invent a direction from measurement scatter.
SLOPE_THRESHOLD_SD = 0.5

#: Trajectory classes, ordered by how urgently a teacher should look at them.
TRAJECTORY_ORDER = (
    "falling_below",
    "stable_below",
    "falling_above",
    "recovering",
    "rising_below",
    "stable_above",
    "rising_above",
)

TRAJECTORY_LABELS_EN = {
    "falling_below": "Falling and below the gate",
    "stable_below": "Persistently below the gate",
    "falling_above": "Falling, still above the gate",
    "recovering": "Was below the gate, now above",
    "rising_below": "Improving but still below the gate",
    "stable_above": "Steady above the gate",
    "rising_above": "Improving, above the gate",
}

TRAJECTORY_LABELS_ZH = {
    "falling_below": "持续下降且未达标",
    "stable_below": "长期未达标",
    "falling_above": "有所下降但仍达标",
    "recovering": "由未达标转为达标",
    "rising_below": "在提升但尚未达标",
    "stable_above": "稳定达标",
    "rising_above": "稳步提升且达标",
}

#: Classes a teacher should be shown first. Not a diagnosis — a queue.
PRIORITY_CLASSES = frozenset({"falling_below", "stable_below", "falling_above"})


@dataclass(frozen=True)
class Trajectory:
    """One student's four-year path through the total score."""

    student_id: str
    totals: tuple[float, ...]
    slope: float
    """Points per year, from an OLS fit over the four sittings."""
    delta: float
    """g4 total minus g1 total. Reported alongside the slope because it is the number a
    student actually recognises about themselves."""
    residual_sd: float
    """Scatter about the fitted line — how much of this student's movement is not trend."""
    trajectory_id: str
    crossings: int
    """How many times the student crossed the gate. A high count means the classification is
    less stable than the label suggests, and the UI should hedge accordingly."""
    volatile: bool


@dataclass
class TrajectoryProfile:
    """Aggregate description of one trajectory class."""

    trajectory_id: str
    label_en: str
    label_zh: str
    n: int
    mean_slope: float
    mean_g1: float
    mean_g4: float
    share_below_gate_g4: float
    is_priority: bool
    mean_item_slopes: dict[str, float] = field(default_factory=dict)
    """Which items are driving the movement — the actionable half of the label."""


def wide_totals(tables: ScoringTables | None = None) -> pd.DataFrame:
    """One row per student, one column per grade, holding the computed total.

    Totals are recomputed through the rule engine rather than read from the panel's own
    ``total_score`` column: that column is winsorised and carries one anomalous sitting
    (``analysis/verify_scorecard.py``), and a trajectory built on it would inherit both.
    """
    tables = tables or load_scoring_tables()
    long = panel_long()
    scored = score_frame(long, tables)
    long = long.join(scored[["total"]])

    wide = long.pivot_table(index="student_id", columns="grade", values="total")
    missing = [g for g in GRADES if g not in wide.columns]
    if missing:
        raise ValueError(f"Panel is missing grade column(s) {missing}; cannot build trajectories.")
    return wide[list(GRADES)].dropna()


def noise_floor(totals: np.ndarray) -> float:
    """Typical scatter about a student's own fitted line, in total-score points.

    This is the unit the slope threshold is expressed in. Estimating it from residuals rather
    than from raw year-to-year differences matters: a student who is genuinely improving by 4
    points a year has large differences and near-zero residuals, and should not raise the bar
    for everyone else.
    """
    x = np.arange(len(GRADES), dtype=float)
    x_centred = x - x.mean()
    denom = float((x_centred**2).sum())

    slopes = (totals - totals.mean(axis=1, keepdims=True)) @ x_centred / denom
    intercepts = totals.mean(axis=1) - slopes * x.mean()
    fitted = intercepts[:, None] + slopes[:, None] * x[None, :]
    residuals = totals - fitted

    # Two degrees of freedom are consumed by the fit (slope + intercept).
    per_student_sd = np.sqrt((residuals**2).sum(axis=1) / max(len(GRADES) - 2, 1))
    return float(np.median(per_student_sd))


def classify(
    student_id: str,
    totals: np.ndarray,
    *,
    slope_threshold: float,
) -> Trajectory:
    """Assign one student a trajectory class from their four totals."""
    x = np.arange(len(totals), dtype=float)
    x_centred = x - x.mean()
    slope = float((totals - totals.mean()) @ x_centred / (x_centred**2).sum())
    intercept = float(totals.mean() - slope * x.mean())
    residuals = totals - (intercept + slope * x)
    residual_sd = float(np.sqrt((residuals**2).sum() / max(len(totals) - 2, 1)))

    above = totals >= PASS_THRESHOLD
    crossings = int(np.sum(above[1:] != above[:-1]))
    ends_above = bool(above[-1])
    starts_above = bool(above[0])

    if slope > slope_threshold:
        direction = "rising"
    elif slope < -slope_threshold:
        direction = "falling"
    else:
        direction = "stable"

    # "Recovering" is the one class defined by where a student started rather than by slope
    # alone: crossing the gate and staying across is the outcome the system exists to produce,
    # and it deserves to be visible rather than folded into "rising".
    if not starts_above and ends_above and direction != "falling":
        trajectory_id = "recovering"
    elif direction == "stable":
        trajectory_id = "stable_above" if ends_above else "stable_below"
    else:
        trajectory_id = f"{direction}_{'above' if ends_above else 'below'}"

    return Trajectory(
        student_id=student_id,
        totals=tuple(round(float(t), 1) for t in totals),
        slope=round(slope, 3),
        delta=round(float(totals[-1] - totals[0]), 1),
        residual_sd=round(residual_sd, 3),
        trajectory_id=trajectory_id,
        crossings=crossings,
        # More than one crossing means the label rests on which side the student happened to
        # land on last, so it is marked rather than presented as settled.
        volatile=crossings > 1,
    )


def classify_all(
    wide: pd.DataFrame | None = None,
    tables: ScoringTables | None = None,
) -> tuple[pd.DataFrame, float]:
    """Classify every student. Returns the frame and the measured slope threshold."""
    wide = wide_totals(tables) if wide is None else wide
    totals = wide.to_numpy(dtype=float)

    floor = noise_floor(totals)
    threshold = SLOPE_THRESHOLD_SD * floor

    rows = [
        classify(str(sid), row, slope_threshold=threshold)
        for sid, row in zip(wide.index, totals, strict=True)
    ]
    frame = pd.DataFrame([r.__dict__ for r in rows]).set_index("student_id")
    for i, grade in enumerate(GRADES):
        frame[grade] = [t[i] for t in frame["totals"]]
    return frame, threshold


def item_slopes(tables: ScoringTables | None = None) -> pd.DataFrame:
    """Per-student slope of each item score — which items are moving, and which way."""
    tables = tables or load_scoring_tables()
    long = panel_long()
    scored = score_frame(long, tables)
    long = long.join(scored[[f"score_{i}" for i in ITEM_UNITS]])

    x = np.arange(len(GRADES), dtype=float)
    x_centred = x - x.mean()
    denom = float((x_centred**2).sum())

    out = {}
    for item in ITEM_UNITS:
        wide = long.pivot_table(index="student_id", columns="grade", values=f"score_{item}")
        wide = wide.reindex(columns=list(GRADES)).dropna()
        values = wide.to_numpy(dtype=float)
        out[item] = pd.Series(
            (values - values.mean(axis=1, keepdims=True)) @ x_centred / denom,
            index=wide.index,
        )
    return pd.DataFrame(out)


def profiles(frame: pd.DataFrame, slopes: pd.DataFrame | None = None) -> list[TrajectoryProfile]:
    """Aggregate each trajectory class, including which items drive it."""
    out: list[TrajectoryProfile] = []
    for tid in TRAJECTORY_ORDER:
        members = frame[frame["trajectory_id"] == tid]
        if members.empty:
            continue
        mean_item_slopes: dict[str, float] = {}
        if slopes is not None:
            shared = slopes.index.intersection(members.index)
            if len(shared):
                mean_item_slopes = {
                    item: round(float(slopes.loc[shared, item].mean()), 3) for item in ITEM_UNITS
                }
        out.append(
            TrajectoryProfile(
                trajectory_id=tid,
                label_en=TRAJECTORY_LABELS_EN[tid],
                label_zh=TRAJECTORY_LABELS_ZH[tid],
                n=int(len(members)),
                mean_slope=round(float(members["slope"].mean()), 3),
                mean_g1=round(float(members["g1"].mean()), 1),
                mean_g4=round(float(members["g4"].mean()), 1),
                share_below_gate_g4=round(float((members["g4"] < PASS_THRESHOLD).mean()), 3),
                is_priority=tid in PRIORITY_CLASSES,
                mean_item_slopes=mean_item_slopes,
            )
        )
    return out


def report(frame: pd.DataFrame, profs: list[TrajectoryProfile], threshold: float) -> str:
    """Render the trajectory report as markdown."""
    lines: list[str] = []
    add = lines.append

    add("# Trajectory types\n")
    add("Generated by `python -m analysis.trajectories`. Groups students by **how they are\n"
        "changing** across the four sittings, complementing model ④ which groups them by what\n"
        "they are currently weak at.\n")

    add("## Method\n")
    add("- Totals are recomputed through the rule engine, not read from the panel's own\n"
        "  `total_score`: that column is winsorised and carries one anomalous sitting, and a\n"
        "  trajectory built on it would inherit both.")
    add("- Each student's four totals are fitted by OLS; the slope is points per year.")
    floor = threshold / SLOPE_THRESHOLD_SD
    add(f"- **The threshold for calling a trend real is measured, not chosen.** Median residual\n"
        f"  scatter about a student's own line is **{floor:.2f} points**; a slope must exceed\n"
        f"  {SLOPE_THRESHOLD_SD} of that (**{threshold:.2f} points/year**) before we call it\n"
        f"  rising or falling rather than steady.")
    add("- Rules rather than clustering: four points per student cannot support a cluster shape\n"
        "  that would also be explainable to the student it describes.\n")

    add("## Classes\n")
    add("| Class | n | Share | Mean slope | Mean g1 | Mean g4 | Below gate at g4 | Priority |")
    add("|---|---:|---:|---:|---:|---:|---:|:--:|")
    total = len(frame)
    for p in profs:
        add(
            f"| {p.label_en} | {p.n:,} | {p.n / total:.1%} | {p.mean_slope:+.2f} | "
            f"{p.mean_g1} | {p.mean_g4} | {p.share_below_gate_g4:.1%} | "
            f"{'yes' if p.is_priority else ''} |"
        )
    add("")

    priority = frame[frame["trajectory_id"].isin(PRIORITY_CLASSES)]
    add("## What a teacher should look at first\n")
    add(f"**{len(priority):,} students ({len(priority) / total:.1%})** are in a priority class —\n"
        "falling, or persistently below the gate. That is the triage queue, and it is a\n"
        "different set from 'currently below 60': a student comfortably above the gate but\n"
        "losing 3 points a year is in it, and a student below the gate who is climbing is not.\n")

    volatile = int(frame["volatile"].sum())
    add(f"**{volatile:,} students ({volatile / total:.1%})** cross the gate more than once. For\n"
        "those the class rests on which side they happened to land on last, so they carry a\n"
        "`volatile` flag and the wording should hedge rather than assert a direction.\n")

    add("## Which items move\n")
    add("Mean per-year change in each item's score, by class. This is the actionable half:\n"
        "the class says a student is falling, these columns say what is falling.\n")
    header = "| Class | " + " | ".join(ITEM_UNITS) + " |"
    add(header)
    add("|---" * (len(ITEM_UNITS) + 1) + "|")
    for p in profs:
        if not p.mean_item_slopes:
            continue
        cells = " | ".join(f"{p.mean_item_slopes.get(i, 0):+.2f}" for i in ITEM_UNITS)
        add(f"| {p.label_en} | {cells} |")
    add("")
    return "\n".join(lines)


def main() -> None:
    ap = argparse.ArgumentParser(description="Classify four-year score trajectories.")
    ap.add_argument("--out", type=Path, default=DEFAULT_REPORT)
    ap.add_argument("--json", type=Path, default=DEFAULT_JSON)
    args = ap.parse_args()

    tables = load_scoring_tables()
    frame, threshold = classify_all(tables=tables)
    slopes = item_slopes(tables)
    profs = profiles(frame, slopes)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(report(frame, profs, threshold), encoding="utf-8")
    args.json.write_text(
        json.dumps(
            {
                "slope_threshold": round(threshold, 4),
                "noise_floor": round(threshold / SLOPE_THRESHOLD_SD, 4),
                "pass_threshold": PASS_THRESHOLD,
                "n": int(len(frame)),
                "profiles": [p.__dict__ for p in profs],
            },
            ensure_ascii=False,
            indent=1,
        ),
        encoding="utf-8",
    )

    print(f"Students classified : {len(frame):,}")
    print(f"Noise floor         : {threshold / SLOPE_THRESHOLD_SD:.3f} points")
    print(f"Slope threshold     : {threshold:.3f} points/year")
    for p in profs:
        flag = "  <-- priority" if p.is_priority else ""
        print(f"  {p.trajectory_id:<16} n={p.n:>6,} ({p.n / len(frame):5.1%})  "
              f"slope={p.mean_slope:+.2f}{flag}")
    print(f"Report written to   : {args.out}")


if __name__ == "__main__":
    main()
