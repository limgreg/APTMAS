"""Exact counterfactual search over the known scoring function.

This is **search, not ML**: enumerate the item-score upgrades the standard actually offers,
price each in raw units from the scoring table, and return the lowest-effort combination that
crosses the target. Because the scoring rule is public and deterministic, the answer is
verifiable arithmetic rather than a prediction (``AGENTS.md`` §The core premise).

Three guardrails are structural, not advisory (``AGENTS.md`` §Non-negotiable design
constraints, ``docs/task_a_plan.md`` §7):

* **Non-causal.** :attr:`Counterfactual.causal` is always ``False``. A route says "this
  combination would score a pass", never "training will produce this".
* **Injury safety.** Any single change larger than :data:`SAFETY_CAP_SD` cohort standard
  deviations is refused. If no route survives the cap, the plan carries ``needs_human`` and
  escalates to a coach instead of advising.
* **No body-composition targets.** BMI is excluded from routes entirely — see
  :data:`NON_ACTIONABLE_ITEMS`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from itertools import combinations

from aptams.rule_engine.models import Sex
from aptams.rule_engine.tables import ScoringTables

#: Items a route may never propose changing.
#:
#: BMI is scored, but proposing a BMI change is a weight-loss target in everything but name —
#: forbidden outright for minors and for this project's users (``AGENTS.md``: no caloric
#: targets, deficit advice, weight-loss goals, or intake restriction guidance). Body
#: composition stays explanatory only.
NON_ACTIONABLE_ITEMS = frozenset({"bmi"})

#: Largest single-item improvement a route may propose, in cohort standard deviations.
#: A change beyond this is not a training plan, it is a different person — those escalate.
SAFETY_CAP_SD = 1.0

#: Most items a single route may ask a student to change at once.
MAX_CHANGES_PER_ROUTE = 3


@dataclass(frozen=True)
class ItemChange:
    """A single proposed change to one measured item, with its effort estimate.

    ``delta`` is in the item's own unit and signed in the direction of improvement (negative
    for lower-is-better items such as run times).

    ``effort_estimate`` is a human-readable string and is **``PLACEHOLDER`` until mentors
    supply the expert effort rules** (``data/expert_rules/``). ``effort_sd`` is not a
    placeholder: it is the required improvement expressed in cohort standard deviations, which
    is measured from our own data and is what routes are actually ranked by.
    """

    item: str
    delta: float
    unit: str
    from_score: float
    to_score: float
    target_raw: float
    effort_sd: float
    effort_estimate: str = "PLACEHOLDER — awaiting mentor expert rules"
    effort_is_placeholder: bool = True


@dataclass(frozen=True)
class Counterfactual:
    """A route to the target, as an exact set of item changes.

    Not a causal claim: arithmetic over the scoring table showing *a* combination of changes
    that would reach ``target_total``, not evidence that training produces them.
    """

    target: str  # "pass" | "next_band"
    target_total: float
    current_total: float
    projected_total: float
    changes: tuple[ItemChange, ...]
    causal: bool = False  # always False — the non-causal contract, made explicit
    effort_sd: float = 0.0

    def __post_init__(self) -> None:
        if self.causal:
            raise ValueError("Routes are table arithmetic and can never be causal.")


@dataclass(frozen=True)
class RoutePlan:
    """Every route we are willing to show, plus the escalation flag.

    ``needs_human`` is ``True`` when the student cannot reach the target through any
    combination of changes inside the safety cap. That is a signal to involve a PE teacher,
    **not** a licence to show an unsafe route.
    """

    student_id: str
    target: str
    target_total: float
    current_total: float
    already_met: bool
    options: tuple[Counterfactual, ...] = field(default_factory=tuple)
    needs_human: bool = False
    unreachable_reason: str | None = None


def _improvement_delta(direction: str, target_raw: float, current_raw: float) -> float:
    """Signed change in the item's own unit, positive meaning 'more', negative 'less'."""
    return target_raw - current_raw


def candidate_upgrades(
    *,
    tables: ScoringTables,
    item: str,
    sex: Sex,
    grade: str,
    raw: float,
    current_score: float,
    cohort_sd: float,
) -> list[ItemChange]:
    """Every score level above ``current_score`` this item can actually reach, priced.

    Levels the standard does not print for this item are skipped — male pull-ups genuinely
    cannot score 78, so no route may ask for it. Changes beyond the safety cap are dropped.
    """
    if item in NON_ACTIONABLE_ITEMS:
        return []
    spec = tables.item(item)
    if spec["scoring"] != "threshold":
        return []
    direction = spec["direction"]
    unit = spec["unit"]

    out: list[ItemChange] = []
    for score in tables.reachable_scores(item=item, sex=sex.value, grade=grade):
        if score <= current_score:
            continue
        target_raw = tables.threshold_for_score(
            item=item, sex=sex.value, grade=grade, score=score
        )
        if target_raw is None:
            continue
        delta = _improvement_delta(direction, target_raw, raw)
        # Guard against a degenerate cohort_sd so a zero-variance item cannot look free.
        effort_sd = abs(delta) / cohort_sd if cohort_sd > 0 else float("inf")
        if effort_sd > SAFETY_CAP_SD:
            continue
        out.append(
            ItemChange(
                item=item,
                delta=round(delta, 4),
                unit=unit,
                from_score=current_score,
                to_score=score,
                target_raw=target_raw,
                effort_sd=round(effort_sd, 4),
            )
        )
    return out


def plan_routes(
    *,
    tables: ScoringTables,
    student_id: str,
    sex: Sex,
    grade: str,
    raws: dict[str, float],
    item_scores: dict[str, float],
    current_total: float,
    cohort_sd: dict[str, float],
    target_total: float,
    target: str = "pass",
    max_options: int = 3,
) -> RoutePlan:
    """Find the lowest-effort change sets that reach ``target_total``.

    Search is exhaustive over combinations of at most :data:`MAX_CHANGES_PER_ROUTE` items,
    taking the *cheapest sufficient* upgrade per item, so the result is a genuine optimum over
    the standard rather than a greedy approximation.
    """
    if current_total >= target_total:
        return RoutePlan(
            student_id=student_id,
            target=target,
            target_total=target_total,
            current_total=current_total,
            already_met=True,
        )

    per_item: dict[str, list[ItemChange]] = {}
    for item, raw in raws.items():
        upgrades = candidate_upgrades(
            tables=tables,
            item=item,
            sex=sex,
            grade=grade,
            raw=raw,
            current_score=item_scores.get(item, 0.0),
            cohort_sd=cohort_sd.get(item, 0.0),
        )
        if upgrades:
            per_item[item] = sorted(upgrades, key=lambda c: c.effort_sd)

    if not per_item:
        return RoutePlan(
            student_id=student_id, target=target, target_total=target_total,
            current_total=current_total, already_met=False, needs_human=True,
            unreachable_reason=(
                "No item can be improved within the safety cap of "
                f"{SAFETY_CAP_SD} cohort SD. Escalate to a PE teacher."
            ),
        )

    gap = target_total - current_total
    found: list[Counterfactual] = []
    for size in range(1, MAX_CHANGES_PER_ROUTE + 1):
        for combo in combinations(per_item, size):
            best = _cheapest_combo(tables, per_item, combo, gap)
            if best is not None:
                gained, changes = best
                found.append(
                    Counterfactual(
                        target=target,
                        target_total=target_total,
                        current_total=current_total,
                        projected_total=round(current_total + gained, 2),
                        changes=changes,
                        effort_sd=round(sum(c.effort_sd for c in changes), 4),
                    )
                )
        if found:
            break  # prefer the fewest simultaneous changes

    if not found:
        return RoutePlan(
            student_id=student_id, target=target, target_total=target_total,
            current_total=current_total, already_met=False, needs_human=True,
            unreachable_reason=(
                f"Target {target_total} is not reachable by changing at most "
                f"{MAX_CHANGES_PER_ROUTE} items within {SAFETY_CAP_SD} cohort SD each. "
                "Escalate to a PE teacher rather than proposing an unsafe jump."
            ),
        )

    found.sort(key=lambda c: (c.effort_sd, len(c.changes)))
    return RoutePlan(
        student_id=student_id, target=target, target_total=target_total,
        current_total=current_total, already_met=False,
        options=tuple(found[:max_options]),
    )


def _cheapest_combo(
    tables: ScoringTables,
    per_item: dict[str, list[ItemChange]],
    combo: tuple[str, ...],
    gap: float,
) -> tuple[float, tuple[ItemChange, ...]] | None:
    """Cheapest set of upgrades across ``combo`` that together close ``gap``.

    Every item in the combination must contribute — a route that only needs two of its three
    changes is found (and preferred) at the smaller size.
    """
    best: tuple[float, float, tuple[ItemChange, ...]] | None = None

    def walk(idx: int, chosen: list[ItemChange], gained: float, effort: float) -> None:
        nonlocal best
        if best is not None and effort >= best[0]:
            return  # cannot beat the incumbent
        if idx == len(combo):
            if gained + 1e-9 >= gap:
                best = (effort, gained, tuple(chosen))
            return
        for change in per_item[combo[idx]]:
            weight = tables.item_weight(item=change.item)
            walk(
                idx + 1,
                [*chosen, change],
                gained + (change.to_score - change.from_score) * weight,
                effort + change.effort_sd,
            )

    walk(0, [], 0.0, 0.0)
    if best is None:
        return None
    return best[1], best[2]


def cheapest_route_to_next_band(**kwargs: object) -> RoutePlan:
    """Alias kept for the original scaffold contract. See :func:`plan_routes`."""
    return plan_routes(**kwargs)  # type: ignore[arg-type]
