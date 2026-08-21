"""Shared data loading for Task A. **Import this rather than reading CSVs directly.**

One place owns file paths, encodings, column naming and the join key, so Person A, B and C
all analyse the same rows under the same names and their outputs merge on ``student_id``
without reconciliation.

Data lives under ``data/`` and is git-ignored. Nothing here writes to it.

Vocabulary note: the CSVs name the endurance column ``endurance_run_sec``; the scoring
standard and the Task B hand-off contract both call the item ``endurance_run``. The mapping
lives in :data:`ITEM_COLUMNS` and is applied on load, so downstream code only ever sees the
contract's names (``docs/task_b_handoff.md`` §3).
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

import pandas as pd

from aptams.rule_engine.models import (
    Measurement,
    Sex,
    StudentAssessment,
)

# --- Locations -------------------------------------------------------------------------

DATA_DIR = Path(os.environ.get("APTAMS_DATA_DIR", "data/ML"))
PANEL_CSV = "policy_year_data/pft (all students in china data).csv"
SCHOLARSHIP_CSV = "policy_year_data/student_2024_scholarship_status.csv"
BUSINESS_CLASS_CSV = "policy_year_data/student_business_class.csv"
ENCODING = "utf-8-sig"

#: Study years present in the panel, freshman → senior.
GRADES = ("g1", "g2", "g3", "g4")

#: Contract item id → column stem in the panel CSV.
ITEM_COLUMNS = {
    "bmi": "bmi",
    "vital_capacity": "vital_capacity",
    "sprint_50m": "sprint_50m",
    "standing_long_jump": "standing_long_jump",
    "sit_and_reach": "sit_and_reach",
    "endurance_run": "endurance_run_sec",
    "strength": "strength",
}

#: Units, as measured. Kept beside the loader so every consumer labels values identically.
ITEM_UNITS = {
    "bmi": "kg/m2",
    "vital_capacity": "ml",
    "sprint_50m": "s",
    "standing_long_jump": "cm",
    "sit_and_reach": "cm",
    "endurance_run": "s",
    "strength": "count",
}

#: Non-scored context columns carried alongside the items.
CONTEXT_COLUMNS = ("height", "weight")


class DataUnavailable(FileNotFoundError):
    """A required data file is missing. Raised with the path so the fix is obvious."""


def _resolve(relative: str) -> Path:
    path = DATA_DIR / relative
    if not path.exists():
        raise DataUnavailable(
            f"Expected data file not found: {path}. Real data is git-ignored — obtain it "
            "from the team and place it under data/ (see data/README.md). Override the root "
            "with APTAMS_DATA_DIR."
        )
    return path


# --- Loaders ---------------------------------------------------------------------------


@lru_cache(maxsize=1)
def load_panel() -> pd.DataFrame:
    """The balanced 4-year PFT panel, one row per student, wide by grade.

    Adds ``sex`` (``male``/``female``) alongside the original ``gender`` (男/女) so callers
    never hand a Chinese label to the scoring tables. Columns are otherwise untouched.
    """
    df = pd.read_csv(_resolve(PANEL_CSV), encoding=ENCODING, low_memory=False)
    df["student_id"] = df["student_id"].astype(str)
    df["sex"] = df["gender"].map({"男": Sex.MALE.value, "女": Sex.FEMALE.value})
    if df["sex"].isna().any():
        bad = df.loc[df["sex"].isna(), "gender"].unique()
        raise ValueError(f"Unrecognised gender labels in the panel: {bad}")
    return df


@lru_cache(maxsize=1)
def load_scholarship() -> pd.DataFrame:
    """2024 scholarship outcome per student — the policy label Progress Check predicts."""
    df = pd.read_csv(_resolve(SCHOLARSHIP_CSV), encoding=ENCODING, low_memory=False)
    df["student_id"] = df["student_id"].astype(str)
    if df["pass_scholarship"].dtype == object:
        normalised = df["pass_scholarship"].astype(str).str.strip().str.lower()
        df["pass_scholarship"] = normalised.map({"true": True, "false": False})
    return df


@lru_cache(maxsize=1)
def load_business_class() -> pd.DataFrame:
    """Team-derived hand-cut labels (``delta_score``, ``improve_cat``, ``business_cat``).

    These are a **baseline to compare against, not ground truth** (``docs/task_a_plan.md``
    §5, Group 2).
    """
    df = pd.read_csv(_resolve(BUSINESS_CLASS_CSV), encoding=ENCODING, low_memory=False)
    df["student_id"] = df["student_id"].astype(str)
    return df


def panel_long() -> pd.DataFrame:
    """The panel reshaped to one row per (student, grade) — the analysis-friendly form.

    Columns: ``student_id``, ``sex``, ``gender``, ``enrollment_year``, ``grade``, the seven
    contract-named item columns, ``height``/``weight``, and ``total_score``.
    """
    wide = load_panel()
    frames = []
    for grade in GRADES:
        cols = {f"{stem}_{grade}": item for item, stem in ITEM_COLUMNS.items()}
        cols |= {f"{c}_{grade}": c for c in CONTEXT_COLUMNS}
        cols[f"total_score_{grade}"] = "total_score"
        missing = [c for c in cols if c not in wide.columns]
        if missing:
            raise ValueError(f"Panel is missing expected columns for {grade}: {missing}")
        frame = wide[["student_id", "sex", "gender", "enrollment_year", *cols]].rename(
            columns=cols
        )
        frame["grade"] = grade
        frames.append(frame)
    long = pd.concat(frames, ignore_index=True)
    ordered = [
        "student_id", "sex", "gender", "enrollment_year", "grade",
        *ITEM_COLUMNS, *CONTEXT_COLUMNS, "total_score",
    ]
    return long[ordered].sort_values(["student_id", "grade"]).reset_index(drop=True)


def measurement_year(enrollment_year: int, grade: str) -> int:
    """Calendar year a grade's test was taken. ``g1`` is the enrolment year itself."""
    return int(enrollment_year) + GRADES.index(grade)


# --- Bridging to the rule engine --------------------------------------------------------


def assessment_from_row(row: pd.Series) -> StudentAssessment:
    """Build a :class:`StudentAssessment` from one row of :func:`panel_long`.

    Only the seven scored items travel into the engine; height and weight are context (BMI
    is the scored derivative and is supplied directly by the data).
    """
    measurements = tuple(
        Measurement(item=item, value=float(row[item]), unit=ITEM_UNITS[item])
        for item in ITEM_COLUMNS
        if pd.notna(row[item])
    )
    return StudentAssessment(
        student_id=str(row["student_id"]),
        sex=Sex(row["sex"]),
        grade=str(row["grade"]),
        measurements=measurements,
    )
