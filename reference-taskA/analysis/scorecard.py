"""① Scorecard — raw results → official item scores, total, band, pass/fail.

Two entry points over the *same* tables:

* :func:`score_one` — one student through :func:`aptams.rule_engine.engine.score_student`.
  Authoritative and fully typed.
* :func:`score_frame` — a vectorised pass over a whole cohort, for analysis at panel scale.

The vectorised path is a performance shortcut, not a second source of truth: it reads the
same :class:`ScoringTables` and ``tests/test_scorecard_vectorised_matches_engine.py`` asserts
the two agree row-for-row. If they ever diverge, the engine wins.

Nothing here invents a threshold (``AGENTS.md`` §The core premise).
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from math import isfinite

import numpy as np
import pandas as pd

from analysis.loaders import ITEM_UNITS
from aptams.rule_engine.engine import score_student
from aptams.rule_engine.models import Measurement, Sex, StudentAssessment, TotalScore
from aptams.rule_engine.tables import ScoringTables, load_scoring_tables

#: The recorded totals carry one decimal; the weighted sum can land on 0.05 granularity.
#: Verified against the cohort's own totals — rounding to 1dp raises exact agreement from
#: 78.3% to 83.0% and never lowers it (``analysis/verify_scorecard.py``).
TOTAL_DECIMALS = 1


def round_total(value: float) -> float:
    """Round a total to the recorded precision, half away from zero.

    Binary floats make half-way cases ambiguous — 62.95 is stored slightly below 62.95, so
    ``round()`` yields 62.9 while ``numpy.round`` yields 63.0, and summing the same seven
    contributions in a different order can land either side of the tie.

    An exact total is always an integer multiple of 0.05: item scores are integers and every
    weight is a multiple of 0.05, and 附加分 is an integer. So we snap to that grid first,
    which removes accumulation noise entirely and makes the engine and the vectorised path
    agree bit-for-bit regardless of summation order. Only then do we round to the recorded
    precision, half away from zero.
    """
    if not isfinite(value):
        return value
    grid = Decimal("0.05")
    steps = (Decimal(value) / grid).to_integral_value(rounding=ROUND_HALF_UP)
    quantum = Decimal(1).scaleb(-TOTAL_DECIMALS)
    return float((steps * grid).quantize(quantum, rounding=ROUND_HALF_UP))


def score_one(row: pd.Series, tables: ScoringTables | None = None) -> TotalScore:
    """Score one row of :func:`analysis.loaders.panel_long` via the rule engine."""
    tables = tables or load_scoring_tables()
    measurements = tuple(
        Measurement(item=item, value=float(row[item]), unit=ITEM_UNITS[item])
        for item in ITEM_UNITS
        if item in row and pd.notna(row[item])
    )
    assessment = StudentAssessment(
        student_id=str(row["student_id"]),
        sex=Sex(row["sex"]),
        grade=str(row["grade"]),
        measurements=measurements,
    )
    return score_student(assessment, tables)


# --- Vectorised path -----------------------------------------------------------------------


@dataclass(frozen=True)
class _Ladder:
    """One (item, sex, grade-group) threshold ladder, prepared for ``searchsorted``."""

    thresholds: np.ndarray  # ascending
    scores: np.ndarray  # aligned to thresholds
    higher_is_better: bool

    def lookup(self, raw: np.ndarray) -> np.ndarray:
        """Vectorised step-function lookup. Below the lowest printed threshold scores 0."""
        out = np.zeros(raw.shape, dtype=float)
        valid = np.isfinite(raw)
        if self.higher_is_better:
            # Highest score whose threshold the value reaches.
            idx = np.searchsorted(self.thresholds, raw[valid], side="right") - 1
            hit = idx >= 0
            vals = np.zeros(idx.shape, dtype=float)
            vals[hit] = self.scores[idx[hit]]
        else:
            # Highest score whose (time) threshold the value comes in under.
            idx = np.searchsorted(self.thresholds, raw[valid], side="left")
            hit = idx < len(self.thresholds)
            vals = np.zeros(idx.shape, dtype=float)
            vals[hit] = self.scores[idx[hit]]
        out[valid] = vals
        return out


def _ladder(tables: ScoringTables, item: str, sex: str, group: str) -> _Ladder:
    spec = tables.item(item)
    pairs = spec["thresholds"][sex][group]
    higher = spec["direction"] == "higher_is_better"
    arr = np.array(sorted(pairs, key=lambda p: p[1]), dtype=float)  # ascending by threshold
    return _Ladder(thresholds=arr[:, 1], scores=arr[:, 0], higher_is_better=higher)


def _score_bmi(tables: ScoringTables, raw: np.ndarray, sex_is_male: np.ndarray) -> np.ndarray:
    """Categorical BMI scoring, anchored at printed lower bounds (see the rule engine)."""
    spec = tables.item("bmi")
    out = np.zeros(raw.shape, dtype=float)
    for sex, mask in (("male", sex_is_male), ("female", ~sex_is_male)):
        ordered = sorted(
            spec["categories"],
            key=lambda c: (c[sex]["min"] if c[sex]["min"] is not None else float("-inf")),
        )
        for cat in ordered:  # later categories overwrite earlier -> last reached wins
            lo = cat[sex]["min"]
            hit = mask if lo is None else (mask & (raw >= lo))
            out[hit] = float(cat["score"])
    return out


def _bonus(
    tables: ScoringTables, item: str, raw: np.ndarray, sex_is_male: np.ndarray, group: str
) -> np.ndarray:
    """Vectorised 附加分 for one bonus-eligible item."""
    spec = tables.bonus.get(item)
    out = np.zeros(raw.shape, dtype=float)
    if spec is None:
        return out
    higher = spec["direction"] == "higher_is_better"
    for sex, mask in (("male", sex_is_male), ("female", ~sex_is_male)):
        if not mask.any():
            continue
        hundred = next(
            t for s, t in tables.item(item)["thresholds"][sex][group] if float(s) == 100.0
        )
        margin = (raw - hundred) if higher else (hundred - raw)
        pairs = np.array(sorted(spec["thresholds"][sex][group], key=lambda p: p[1]), dtype=float)
        idx = np.searchsorted(pairs[:, 1], margin, side="right") - 1
        earned = np.where(idx >= 0, pairs[np.clip(idx, 0, None), 0], 0.0)
        out[mask] = np.clip(np.where(margin[mask] > 0, earned[mask], 0.0), 0, spec["max_bonus"])
    return out


def score_frame(df: pd.DataFrame, tables: ScoringTables | None = None) -> pd.DataFrame:
    """Score a whole cohort at once.

    ``df`` needs ``sex``, ``grade`` and the seven item columns (i.e. the output of
    :func:`analysis.loaders.panel_long`). Returns a frame indexed like ``df`` with
    ``score_<item>``, ``bonus_<item>``, ``weighted_total``, ``bonus``, ``total`` and ``band``.
    """
    tables = tables or load_scoring_tables()
    out = pd.DataFrame(index=df.index)
    sex_is_male = (df["sex"] == Sex.MALE.value).to_numpy()
    group = df["grade"].map(tables.grade_to_group).to_numpy()

    weighted = np.zeros(len(df), dtype=float)
    bonus_total = np.zeros(len(df), dtype=float)

    for item in tables.item_ids():
        raw = df[item].to_numpy(dtype=float)
        weight = tables.item_weight(item=item)
        if tables.item(item)["scoring"] == "categorical":
            scores = _score_bmi(tables, raw, sex_is_male)
            bonuses = np.zeros(len(df), dtype=float)
        else:
            scores = np.zeros(len(df), dtype=float)
            bonuses = np.zeros(len(df), dtype=float)
            for g in np.unique(group):
                for sex, sex_mask in (("male", sex_is_male), ("female", ~sex_is_male)):
                    mask = (group == g) & sex_mask
                    if not mask.any():
                        continue
                    scores[mask] = _ladder(tables, item, sex, g).lookup(raw[mask])
                if item in tables.bonus:
                    gmask = group == g
                    bonuses[gmask] = _bonus(
                        tables, item, raw[gmask], sex_is_male[gmask], g
                    )
        out[f"score_{item}"] = scores
        out[f"bonus_{item}"] = bonuses
        weighted += scores * weight
        bonus_total += bonuses

    out["weighted_total"] = weighted
    out["bonus"] = bonus_total
    out["total"] = [round_total(v) for v in (weighted + bonus_total)]
    cutoffs = sorted(
        (
            (label, spec["total_min"])
            for label, spec in tables.total_band_cutoffs.items()
            if isinstance(spec, dict) and "total_min" in spec
        ),
        key=lambda kv: -kv[1],
    )
    band = pd.Series(cutoffs[-1][0], index=df.index, dtype=object)
    for label, minimum in reversed(cutoffs):
        band[out["total"] >= minimum] = label
    out["band"] = band
    return out
