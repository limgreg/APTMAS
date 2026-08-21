"""Assemble the Task A → Task B hand-off object.

Implements the frozen contract in ``docs/task_b_handoff.md`` §2: one provenance-bearing
object per student per evaluation point, carrying everything Task B's agent is allowed to see
and nothing else.

Three rules this module enforces structurally rather than by convention:

* **Every value-bearing node carries a ``provenance`` id.** The agent may only assert things
  tied to one of these ids; ``aptams.agent.provenance.validate_grounding`` rejects the rest.
  :func:`validate_handoff` checks the ids are present and unique before an object ships.
* **Certainty is typed.** ``score`` is exact, ``route`` is exact-but-``causal: false``,
  ``progress`` is a fuzzy risk flag with an ``uncertainty`` string. The agent's wording has to
  match, so the object has to say which is which.
* **``teacher_visible: false`` indicators never reach a teacher.** :func:`for_role` filters
  server-side; the PWA honouring it is a second line of defence, not the first.

Fixtures for Task B are **synthetic** (:func:`synthetic_cohort`). Real student data is
git-ignored and never leaves ``data/``, so Task B can build against the real shape today
without any sensitive record being shared.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from analysis.indicators import by_id as indicators_by_id
from analysis.loaders import ITEM_UNITS, measurement_year
from analysis.progress_check import risk_band
from analysis.route_to_pass import PASS_THRESHOLD, cohort_sd
from analysis.scorecard import score_frame
from aptams.counterfactual.planner import RoutePlan, plan_routes
from aptams.rule_engine.models import Sex
from aptams.rule_engine.tables import ScoringTables, load_scoring_tables

SCHEMA_VERSION = "0.1"
REPORTS = Path("analysis/reports")
FIXTURES = Path("data/synthetic")


class HandoffValidationError(ValueError):
    """The assembled object violates the contract. Raised rather than shipped."""


def _score_section(scored: pd.Series, tables: ScoringTables) -> dict[str, Any]:
    items = []
    for item in ITEM_UNITS:
        points = float(scored[f"score_{item}"])
        items.append({
            "indicator_id": item,
            "raw": float(scored[f"raw_{item}"]),
            "unit": ITEM_UNITS[item],
            "points": points,
            "bonus": float(scored[f"bonus_{item}"]),
            "band": _item_band(points, tables),
            "provenance": f"score:{item}",
        })
    total = float(scored["total"])
    return {
        "items": items,
        "total": total,
        "bonus": float(scored["bonus"]),
        "band": str(scored["band"]),
        "band_is_derived": tables.total_band_cutoffs_are_derived,
        "pass": bool(total >= PASS_THRESHOLD),
        "pass_threshold": PASS_THRESHOLD,
        "provenance": "score:total",
    }


def _item_band(points: float, tables: ScoringTables) -> str:
    for label, levels in tables.raw.get("item_bands", {}).items():
        if points in levels:
            return label
    return "不及格"


def _route_section(plan: RoutePlan) -> dict[str, Any]:
    return {
        "target": plan.target,
        "target_total": plan.target_total,
        "already_met": plan.already_met,
        "options": [
            {
                "id": f"r{n}",
                "changes": [
                    {
                        "indicator_id": c.item,
                        "delta": c.delta,
                        "unit": c.unit,
                        "from_points": c.from_score,
                        "to_points": c.to_score,
                        "effort_sd": c.effort_sd,
                    }
                    for c in option.changes
                ],
                "projected_total": option.projected_total,
                "effort_estimate": (
                    option.changes[0].effort_estimate if option.changes else "n/a"
                ),
                "effort_is_placeholder": any(c.effort_is_placeholder for c in option.changes),
                "provenance": f"route:r{n}",
            }
            for n, option in enumerate(plan.options, start=1)
        ],
        "needs_human": plan.needs_human,
        "unreachable_reason": plan.unreachable_reason,
        "causal": False,  # always — routes are table arithmetic, never a promise
    }


def _progress_section(
    pass_probability: float | None,
    drivers: list[dict[str, Any]] | None,
    feature_set: str,
    model_version: str | None = None,
) -> dict[str, Any]:
    if pass_probability is None:
        return {
            "available": False,
            "reason": "No Progress Check prediction for this student-year.",
            "provenance": "progress:flag",
        }
    risk = risk_band(pass_probability)
    section: dict[str, Any] = {
        "available": True,
        "on_track": risk == "on_track",
        "risk": risk,
        "pass_probability": round(float(pass_probability), 4),
        "uncertainty": (
            f"wide — projected from {feature_set} features to an evaluation year up to three "
            "years later; a risk flag, not a forecast"
        ),
        "drivers": drivers or [],
        "provenance": "progress:flag",
    }
    if model_version:
        section["model_version"] = model_version
    return section


def _indicator_section(values: dict[str, Any]) -> list[dict[str, Any]]:
    """Layer-tagged indicator nodes. Unknown ids are refused rather than passed through."""
    catalogue = indicators_by_id()
    out = []
    for ind_id, value in values.items():
        spec = catalogue.get(ind_id)
        if spec is None:
            raise HandoffValidationError(
                f"Indicator {ind_id!r} is not in the A1 catalogue. The catalogue is the "
                "controlled vocabulary for Task B's knowledge graph; ad-hoc ids are refused."
            )
        node = {
            "indicator_id": ind_id,
            "dimension": spec.dimension,
            "layer": spec.layer.value,
            "value": value,
            "unit": spec.unit,
            "teacher_visible": spec.teacher_visible,
            "provenance": f"ind:{ind_id}",
        }
        if spec.reference:
            node["reference"] = spec.reference
        out.append(node)
    return out


def build_handoff(
    *,
    student_id: str,
    sex: str,
    grade: str,
    cohort_year: int,
    raws: dict[str, float],
    scored: pd.Series,
    tables: ScoringTables,
    segment: dict[str, str] | None = None,
    pass_probability: float | None = None,
    drivers: list[dict[str, Any]] | None = None,
    indicator_values: dict[str, Any] | None = None,
    feature_set: str = "g1",
    model_version: str | None = None,
) -> dict[str, Any]:
    """Assemble one complete, contract-shaped hand-off object."""
    enriched = scored.copy()
    for item, value in raws.items():
        enriched[f"raw_{item}"] = value

    plan = plan_routes(
        tables=tables,
        student_id=student_id,
        sex=Sex(sex),
        grade=grade,
        raws=raws,
        item_scores={i: float(scored[f"score_{i}"]) for i in ITEM_UNITS},
        current_total=float(scored["total"]),
        cohort_sd=cohort_sd().get((sex, grade), {}),
        target_total=PASS_THRESHOLD,
    )

    flags: list[str] = []
    if plan.needs_human:
        flags.append("needs_human")
    if pass_probability is not None and risk_band(pass_probability) == "at_risk":
        flags.append("at_risk")

    obj = {
        "schema_version": SCHEMA_VERSION,
        "student_id": student_id,
        "meta": {
            "sex": "male" if sex == "male" else "female",
            "grade": grade,
            "cohort_year": int(cohort_year),
            "as_of": f"{measurement_year(cohort_year, grade)}-11-01",
        },
        "score": _score_section(enriched, tables),
        "route": _route_section(plan),
        "progress": _progress_section(pass_probability, drivers, feature_set, model_version),
        "type": segment
        or {
            "segment_id": "unassigned",
            "segment_label_zh": "未分组",
            "segment_label_en": "Unassigned",
            "weaknesses": [],
            "provenance": "type:segment",
        },
        "indicators": _indicator_section(indicator_values or {}),
        "flags": flags,
    }
    validate_handoff(obj)
    return obj


def provenance_ids(obj: dict[str, Any]) -> list[str]:
    """Every provenance id in the object, in document order."""
    found: list[str] = []

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            if isinstance(node.get("provenance"), str):
                found.append(node["provenance"])
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(obj)
    return found


def validate_handoff(obj: dict[str, Any]) -> None:
    """Check the contract before an object ships. Raises on the first violation."""
    for key in ("schema_version", "student_id", "meta", "score", "route", "progress",
                "type", "indicators", "flags"):
        if key not in obj:
            raise HandoffValidationError(f"Hand-off object is missing required key {key!r}.")
    if obj["route"]["causal"] is not False:
        raise HandoffValidationError("route.causal must always be False.")
    if obj["meta"]["grade"] not in {"g1", "g2", "g3", "g4"}:
        raise HandoffValidationError(f"Unknown grade {obj['meta']['grade']!r}.")
    if obj["meta"]["sex"] not in {"male", "female"}:
        raise HandoffValidationError(f"Unknown sex {obj['meta']['sex']!r}.")

    ids = provenance_ids(obj)
    if not ids:
        raise HandoffValidationError("Object carries no provenance ids; the agent could say "
                                     "nothing groundable.")
    dupes = {i for i in ids if ids.count(i) > 1}
    if dupes:
        raise HandoffValidationError(f"Duplicate provenance ids: {sorted(dupes)}")
    if obj["route"]["needs_human"] and "needs_human" not in obj["flags"]:
        raise HandoffValidationError("route.needs_human set but the flag is missing.")


def for_role(obj: dict[str, Any], role: str) -> dict[str, Any]:
    """Scope an object to a caller's role. **This is the privacy boundary.**

    A teacher never receives ``teacher_visible: false`` indicators — self-report (mood, stress,
    environment) stays with the student and reaches a teacher only as a non-specific flag
    (``AGENTS.md`` §Privacy boundary). Filtering here, on the server side of the hand-off,
    means a UI bug cannot leak them.
    """
    if role not in {"student", "teacher"}:
        raise HandoffValidationError(f"Unknown role {role!r}.")
    if role == "student":
        return obj

    scoped = json.loads(json.dumps(obj))
    hidden = [i for i in scoped["indicators"] if not i["teacher_visible"]]
    scoped["indicators"] = [i for i in scoped["indicators"] if i["teacher_visible"]]
    if hidden:
        # A non-specific flag only: how many dimensions were withheld, never which values.
        scoped["withheld_self_report"] = {
            "count": len(hidden),
            "dimensions": sorted({i["dimension"] for i in hidden}),
            "note": "Self-report values are not shown to teachers. Not an omission — a rule.",
        }
    return scoped


# --- Synthetic fixtures for Task B ------------------------------------------------------------


def synthetic_cohort(n: int = 12, seed: int = 20240818) -> list[dict[str, Any]]:
    """Generate synthetic students conforming to the contract.

    Values are drawn to be plausible and are then scored through the **real** rule engine, so
    the fixtures are internally consistent with the standard. No real student record is used,
    so these are safe to commit and safe to hand to Task B.
    """
    rng = np.random.default_rng(seed)
    tables = load_scoring_tables()

    # Plausible ranges per item and sex, chosen to span pass and fail outcomes.
    means = {
        "male": {"bmi": 21.5, "vital_capacity": 4000, "sprint_50m": 7.6,
                 "standing_long_jump": 225, "sit_and_reach": 12.0,
                 "endurance_run": 250, "strength": 9},
        "female": {"bmi": 20.5, "vital_capacity": 2900, "sprint_50m": 9.2,
                   "standing_long_jump": 165, "sit_and_reach": 15.0,
                   "endurance_run": 250, "strength": 30},
    }
    spreads = {"bmi": 2.5, "vital_capacity": 600, "sprint_50m": 0.8,
               "standing_long_jump": 22, "sit_and_reach": 6.0,
               "endurance_run": 35, "strength": 6}

    rows = []
    for i in range(n):
        sex = "male" if i % 2 == 0 else "female"
        grade = ["g1", "g2", "g3", "g4"][i % 4]
        row = {"student_id": f"SYN{i + 1:04d}", "sex": sex, "grade": grade,
               "cohort_year": int(rng.choice([2020, 2021, 2022]))}
        for item in ITEM_UNITS:
            row[item] = float(np.round(
                rng.normal(means[sex][item], spreads[item]),
                1 if item != "vital_capacity" else 0,
            ))
        row["strength"] = float(max(0, round(row["strength"])))
        rows.append(row)

    frame = pd.DataFrame(rows)
    scored = score_frame(frame, tables)

    objects = []
    for idx, row in frame.iterrows():
        prob = float(np.clip(rng.normal(0.7, 0.22), 0.02, 0.99))
        obj = build_handoff(
            student_id=row["student_id"],
            sex=row["sex"],
            grade=row["grade"],
            cohort_year=row["cohort_year"],
            raws={i: float(row[i]) for i in ITEM_UNITS},
            scored=scored.loc[idx],
            tables=tables,
            segment={
                "segment_id": "endurance_run_headroom",
                "segment_label_zh": "耐力提升空间型",
                "segment_label_en": "Endurance is the headroom",
                "weaknesses": ["endurance_run"],
                "provenance": "type:segment",
            },
            pass_probability=prob,
            drivers=[
                {"indicator_id": "endurance_run", "direction": "higher_hurts",
                 "strength": 0.198, "method": "shap", "actionable": True,
                 "provenance": "driver:endurance_run"},
                {"indicator_id": "standing_long_jump", "direction": "higher_helps",
                 "strength": 0.202, "method": "shap", "actionable": True,
                 "provenance": "driver:standing_long_jump"},
            ],
            indicator_values={
                "weekly_moderate_minutes": float(max(0, rng.normal(90, 60))),
                "exercise_freq_per_week": int(max(0, rng.normal(2.7, 2))),
                "body_fat_pct": round(float(rng.normal(19, 6)), 1),
                "mood": str(rng.choice(["low", "ok", "good"])),
                "facility_access": str(rng.choice(["limited", "ok", "good"])),
            },
        )
        objects.append(obj)
    return objects


def main() -> None:
    ap = argparse.ArgumentParser(description="Emit synthetic hand-off fixtures for Task B.")
    ap.add_argument("--n", type=int, default=12)
    ap.add_argument("--out", type=Path, default=FIXTURES / "handoff_fixtures.json")
    args = ap.parse_args()
    args.out.parent.mkdir(parents=True, exist_ok=True)

    objects = synthetic_cohort(args.n)
    payload = {
        "schema_version": SCHEMA_VERSION,
        "generated_by": "analysis/handoff.py",
        "synthetic": True,
        "note": (
            "Synthetic students, scored through the real rule engine so the objects are "
            "internally consistent with the national standard. No real student record is used. "
            "Safe to commit and to share with Task B."
        ),
        "students": objects,
    }
    args.out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    teacher_view = for_role(objects[0], "teacher")
    student_ids = len(provenance_ids(objects[0]))
    print(f"Wrote {len(objects)} synthetic hand-off objects to {args.out}")
    print(f"Provenance ids in the first object : {student_ids}")
    print(f"Indicators, student view           : {len(objects[0]['indicators'])}")
    print(f"Indicators, teacher view           : {len(teacher_view['indicators'])}")
    print(f"Withheld from teacher              : "
          f"{teacher_view.get('withheld_self_report', {}).get('dimensions')}")
    print(f"needs_human in cohort              : "
          f"{sum('needs_human' in o['flags'] for o in objects)}/{len(objects)}")


if __name__ == "__main__":
    main()
