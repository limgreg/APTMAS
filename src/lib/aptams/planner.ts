// Client-side improvement planner. Mirrors the deterministic arithmetic used at
// build time, but runs in the browser so the "How to improve" card can let a
// student pick a target band and recompute instantly. Everything here is exact
// arithmetic over the national scoring table — NOT a causal training claim.
//
// It enumerates the discrete score levels printed in the standard, then searches
// combinations of 1..4 items. For each target it returns up to three
// stylistically distinct routes (balanced / focused / spread) plus per-item
// diagnostics, so a student can choose a path that fits how they want to train.
//
// INJURY SAFETY: every candidate change is bounded by SAFETY_CAP_SD cohort
// standard deviations (port of aptams/counterfactual/planner.py). A change
// larger than that is not a training target, it is an injury risk, and it is
// refused rather than displayed. When no route survives the cap the plan
// carries `needs_human` and the UI must escalate to a PE teacher instead of
// showing an unreachable number.

import cohortSdData from "./data/cohort_sd.json";
import {
  bonusFor,
  itemBonusDef,
  itemMeta,
  itemThresholds,
  itemWeight,
} from "./tables";
import type { FitnessItemId, Sex } from "../types";

export type ImprovementTarget = "pass" | "credit" | "good" | "excellent";
export type RouteStyle = "balanced" | "focused" | "spread";

/**
 * Largest single-item change we will ever propose, in cohort standard
 * deviations. Beyond this a "route" stops being guidance and becomes an
 * injury risk, so we escalate to a human instead.
 * Port of aptams/counterfactual/planner.SAFETY_CAP_SD.
 */
export const SAFETY_CAP_SD = 1.0;

/**
 * Items no route may ever propose changing. A BMI route is weight-loss advice
 * under another name, which AGENTS.md forbids outright.
 * Port of aptams/counterfactual/planner.NON_ACTIONABLE_ITEMS.
 */
export const NON_ACTIONABLE_ITEMS: ReadonlySet<FitnessItemId> = new Set([
  "bmi",
] as FitnessItemId[]);

type SdTable = { sd: Record<string, Record<string, number>> };
const COHORT_SD = (cohortSdData as unknown as SdTable).sd;

/** Per-item cohort SD for a (sex, grade) cell; falls back across grades. */
function cohortSdFor(
  sex: Sex,
  grade: PlannerGrade,
): Record<string, number> | null {
  return COHORT_SD[`${sex}|${grade}`] ?? COHORT_SD[`${sex}|g1`] ?? null;
}

export interface PlannedChange {
  indicator_id: FitnessItemId;
  delta: number;
  unit: string;
  from_points: number;
  to_points: number;
  from_raw: number;
  to_raw: number;
  effort: number;
  /** |delta| in cohort standard deviations. Always <= SAFETY_CAP_SD. */
  effort_sd: number;
  /** Normalized 0..1 span from current raw toward the 100-point raw. */
  span: number;
  /** True when the change asks for a very large result jump (>=70% of the
   *  distance from current to the 100-point raw). Shown as a warning, never
   *  used as a training recommendation by itself. */
  large_span: boolean;
}

export interface RouteArchetype {
  style: RouteStyle;
  label: string;
  min_items: number;
  max_items: number;
  /** 0..1 emphasis on minimizing the max single-item jump (balance) vs total
   *  effort. Higher = more pressure on no single item being huge. */
  balance_weight: number;
}

export interface PlannedRoute {
  target: ImprovementTarget;
  target_total: number;
  already_met: boolean;
  style: RouteStyle;
  changes: PlannedChange[];
  projected_total: number;
  reaches_target: boolean;
  unreachable: boolean;
  causal: false;
  /** Highest single-item normalized span among changes. */
  max_span: number;
  /** True if any change is flagged large_span. */
  has_large_span: boolean;
}

export interface MultiRoutePlan {
  target: ImprovementTarget;
  target_total: number;
  already_met: boolean;
  needed_gain: number;
  routes: PlannedRoute[];
  unreachable: boolean;
  /**
   * True when no route reaches the target within the injury safety cap. The UI
   * MUST show an escalation to a PE teacher in this state and MUST NOT show a
   * partial route as if it were a plan. About 16.8% of failing students land
   * here (docs/task_a_results.md §2).
   */
  needs_human: boolean;
  /** Human-readable reason, present exactly when needs_human is true. */
  unreachable_reason: string | null;
  causal: false;
}

export interface ItemDiagnosis {
  indicator_id: FitnessItemId;
  unit: string;
  raw: number;
  points: number;
  bonus: number;
  weight: number;
  ceiling_raw: number | null;
  ceiling_points: number;
  /** weighted points still available before bonus, rounded to 1dp. */
  points_to_ceiling: number;
  /** The next better discrete level above current, if any. */
  next_raw: number | null;
  next_points: number | null;
  /** Weighted points gained by moving to next_raw. */
  next_gain: number;
  /** effort (normalized) to reach next_raw. */
  next_effort: number;
  /** points per unit effort for the next step — marginal efficiency. */
  marginal_efficiency: number;
  trainable: boolean;
}

interface ScoreItemLike {
  indicator_id: string;
  raw: number;
  unit: string;
  points: number;
  bonus: number;
}

type PlannerGrade = "g1" | "g2" | "g3" | "g4";

export const BAND_CUTOFF: Record<ImprovementTarget, number> = {
  pass: 60,
  credit: 70,
  good: 80,
  excellent: 90,
};

const TRAINABLE: FitnessItemId[] = [
  "vital_capacity",
  "sprint_50m",
  "sit_and_reach",
  "standing_long_jump",
  "strength",
  "endurance_run",
];

// Reference "full range" per item, used only to normalize effort so different
// units (ml, s, cm, reps) can be compared on one scale. Not a safe cap.
const REFERENCE_RANGE: Partial<Record<FitnessItemId, number>> = {
  vital_capacity: 2000,
  sprint_50m: 3,
  sit_and_reach: 20,
  standing_long_jump: 100,
  strength: 30,
  endurance_run: 120,
};

// Above this normalized span (0..1 toward the 100-point raw), a change is
// flagged as a large jump and surfaced with a warning.
const LARGE_SPAN = 0.7;

export const ROUTE_ARCHETYPES: RouteArchetype[] = [
  { style: "balanced", label: "Balanced", min_items: 3, max_items: 3, balance_weight: 0.65 },
  { style: "focused", label: "Focused", min_items: 1, max_items: 2, balance_weight: 0.3 },
  { style: "spread", label: "Low-pressure spread", min_items: 3, max_items: 4, balance_weight: 0.85 },
];

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

interface Level {
  points: number;
  bonus: number;
  raw: number;
}

/**
 * Every achievable (points, bonus, raw) state for an item from the current raw
 * upward, i.e. equal or better performance. Bonus tiers beyond the 100-point
 * raw threshold are enumerated for strength/endurance.
 */
function achievableLevels(
  item: FitnessItemId,
  sex: Sex,
  grade: PlannerGrade,
  currentRaw: number,
): Level[] {
  const def = itemMeta(item);
  const pairs = itemThresholds(item, sex, grade);
  const out: Level[] = [];
  const seen = new Set<string>();

  const add = (points: number, raw: number) => {
    const bonus = bonusFor(item, sex, grade, raw);
    const key = `${points}:${bonus}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ points, bonus, raw: round1(raw) });
  };

  if (def.direction === "higher_is_better") {
    for (const [s, r] of pairs) {
      if (r >= currentRaw - 1e-9) add(s, r);
    }
  } else {
    for (const [s, r] of pairs) {
      if (r <= currentRaw + 1e-9) add(s, r);
    }
  }

  // Bonus-tier extension for items that award 附加分 beyond the 100-pt mark.
  const bdef = itemBonusDef(item);
  if (bdef && pairs.length > 0) {
    const hundredPair = pairs.find(([s]) => s === 100);
    if (hundredPair) {
      const [, hundredRaw] = hundredPair;
      const step = item === "strength" ? 1 : item === "endurance_run" ? -2 : 1;
      let raw = hundredRaw;
      for (let k = 0; k < 60; k++) {
        raw += step;
        if (def.direction === "lower_is_better" && raw <= 0) break;
        add(100, raw);
        if (bonusFor(item, sex, grade, raw) >= bdef.max_bonus) break;
      }
    }
  }

  return out;
}

function effortOf(item: FitnessItemId, delta: number): number {
  const range = REFERENCE_RANGE[item] ?? 1;
  return Math.abs(delta) / range;
}

/** Normalized 0..1 span from current raw toward the 100-point raw. */
function spanToCeiling(
  item: FitnessItemId,
  sex: Sex,
  grade: PlannerGrade,
  fromRaw: number,
  toRaw: number,
): number {
  const pairs = itemThresholds(item, sex, grade);
  const hundred = pairs.find(([s]) => s === 100);
  if (!hundred) return 0;
  const ceilingRaw = hundred[1];
  const def = itemMeta(item);
  if (def.direction === "higher_is_better") {
    const denom = ceilingRaw - fromRaw;
    if (denom <= 1e-9) return 0;
    return Math.max(0, Math.min(1, (toRaw - fromRaw) / denom));
  }
  const denom = fromRaw - ceilingRaw;
  if (denom <= 1e-9) return 0;
  return Math.max(0, Math.min(1, (fromRaw - toRaw) / denom));
}

type Cand = {
  item: FitnessItemId;
  delta: number;
  to_points: number;
  to_bonus: number;
  to_raw: number;
  pointsGain: number;
  effort: number;
  effortSd: number;
  span: number;
};

/** Build per-item candidate changes (one per achievable level). */
function buildCandidates(
  sex: Sex,
  grade: PlannerGrade,
  items: ScoreItemLike[],
): Cand[][] {
  const sd = cohortSdFor(sex, grade);
  const out: Cand[][] = [];
  for (const item of TRAINABLE) {
    if (NON_ACTIONABLE_ITEMS.has(item)) continue;
    const current = items.find((it) => it.indicator_id === item);
    if (!current) continue;
    const w = itemWeight(item) / 100;
    const levels = achievableLevels(item, sex, grade, current.raw);
    const itemSd = sd?.[item] ?? 0;
    const cands: Cand[] = [];
    for (const lvl of levels) {
      const pointsDelta = (lvl.points - current.points) * w;
      const bonusDelta = lvl.bonus - current.bonus;
      const pointsGain = round1(pointsDelta + bonusDelta);
      if (pointsGain <= 0) continue;
      const delta = round1(lvl.raw - current.raw);

      // INJURY SAFETY CAP. Effort is measured in cohort standard deviations;
      // anything beyond SAFETY_CAP_SD is refused outright rather than shown.
      // With no SD available we cannot bound the ask, so we refuse too —
      // failing closed is the only safe default here.
      const effortSd = itemSd > 0 ? Math.abs(delta) / itemSd : Infinity;
      if (effortSd > SAFETY_CAP_SD + 1e-9) continue;

      const span = spanToCeiling(item, sex, grade, current.raw, lvl.raw);
      cands.push({
        item,
        delta,
        to_points: lvl.points,
        to_bonus: lvl.bonus,
        to_raw: lvl.raw,
        pointsGain,
        effort: effortOf(item, delta),
        effortSd,
        span,
      });
    }
    if (cands.length) out.push(cands);
  }
  return out;
}

function toChange(
  c: Cand,
  items: ScoreItemLike[],
): PlannedChange {
  const from = items.find((it) => it.indicator_id === c.item)!;
  return {
    indicator_id: c.item,
    delta: c.delta,
    unit: from.unit,
    from_points: from.points,
    to_points: c.to_points,
    from_raw: from.raw,
    to_raw: c.to_raw,
    effort: c.effort,
    effort_sd: Math.round(c.effortSd * 1e4) / 1e4,
    span: c.span,
    large_span: c.span >= LARGE_SPAN,
  };
}

/** Pareto-prune each item's candidate list by (effort ascending, gain). */
function paretoPrune(candidatesByItem: Cand[][]): Cand[][] {
  return candidatesByItem.map((cands) => {
    const sorted = [...cands].sort((a, b) => a.effort - b.effort);
    const out: Cand[] = [];
    let bestGain = -Infinity;
    for (const c of sorted) {
      if (c.pointsGain > bestGain) {
        out.push(c);
        bestGain = c.pointsGain;
      }
    }
    return out;
  });
}

function subsets(
  n: number,
  minItems: number,
  maxItems: number,
): number[][] {
  const combos: number[][] = [];
  for (let a = 0; a < n; a++) {
    if (minItems <= 1 && maxItems >= 1) combos.push([a]);
    for (let b = a + 1; b < n; b++) {
      if (maxItems < 2) break;
      if (minItems <= 2) combos.push([a, b]);
      if (maxItems >= 3) {
        for (let c = b + 1; c < n; c++) {
          if (minItems <= 3) combos.push([a, b, c]);
          if (maxItems >= 4) {
            for (let d = c + 1; d < n; d++) {
              if (minItems <= 4) combos.push([a, b, c, d]);
            }
          }
        }
      }
    }
  }
  return combos;
}

type Cell = {
  gain: number;
  cost: number;
  maxSpan: number;
  picks: Cand[];
  style: RouteStyle;
};

/**
 * Search all combinations up to archetype.max_items and return the best cell
 * for that archetype's cost model.
 */
function searchArchetype(
  pruned: Cand[][],
  targetGain: number,
  archetype: RouteArchetype,
  reach: boolean,
): Cell | null {
  const n = pruned.length;
  const combos = subsets(n, archetype.min_items, archetype.max_items);

  const costOf = (picks: Cand[]): number => {
    const maxE = Math.max(...picks.map((p) => p.effort));
    const sumE = picks.reduce((a, p) => a + p.effort, 0);
    const meanE = sumE / picks.length;
    return archetype.balance_weight * maxE + (1 - archetype.balance_weight) * meanE;
  };

  let best: Cell | null = null;
  const consider = (picks: Cand[]) => {
    const gain = round1(picks.reduce((a, p) => a + p.pointsGain, 0));
    if (gain <= 0) return;
    const cost = costOf(picks);
    const maxSpan = Math.max(...picks.map((p) => p.span));
    const cell: Cell = { gain, cost, maxSpan, picks, style: archetype.style };
    const qualifies = reach ? gain >= targetGain - 1e-9 : gain < targetGain - 1e-9;
    if (!qualifies) return;
    if (!best) {
      best = cell;
      return;
    }
    if (reach) {
      // Among plans that reach: minimize cost, then span, then lower gain
      // (we don't overshoot unnecessarily).
      if (
        cost < best.cost - 1e-9 ||
        (Math.abs(cost - best.cost) < 1e-9 && maxSpan < best.maxSpan - 1e-9) ||
        (Math.abs(cost - best.cost) < 1e-9 &&
          Math.abs(maxSpan - best.maxSpan) < 1e-9 &&
          gain < best.gain)
      ) {
        best = cell;
      }
    } else {
      // Partial: maximize gain, then minimize cost/span.
      if (
        gain > best.gain + 1e-9 ||
        (Math.abs(gain - best.gain) < 1e-9 && cost < best.cost - 1e-9) ||
        (Math.abs(gain - best.gain) < 1e-9 &&
          Math.abs(cost - best.cost) < 1e-9 &&
          maxSpan < best.maxSpan - 1e-9)
      ) {
        best = cell;
      }
    }
  };

  for (const combo of combos) {
    const lists = combo.map((idx) => pruned[idx]);
    const ptr = lists.map(() => 0);
    let guard = 0;
    const maxGuard =
      lists.reduce((acc, l) => acc * Math.max(1, l.length), 1) + 1;
    while (guard++ < maxGuard) {
      const picks = lists.map((l, i) => l[ptr[i]]);
      consider(picks);
      let k = ptr.length - 1;
      while (k >= 0) {
        ptr[k]++;
        if (ptr[k] < lists[k].length) break;
        ptr[k] = 0;
        k--;
      }
      if (k < 0) break;
    }
  }
  return best;
}

function cellToRoute(
  cell: Cell,
  items: ScoreItemLike[],
  target: ImprovementTarget,
  targetTotal: number,
  total: number,
  alreadyMet: boolean,
): PlannedRoute {
  const changes = cell.picks.map((c) => toChange(c, items));
  return {
    target,
    target_total: targetTotal,
    already_met: alreadyMet,
    style: cell.style,
    changes,
    projected_total: round1(total + cell.gain),
    reaches_target: cell.gain >= targetTotal - total - 1e-9,
    unreachable: false,
    causal: false,
    max_span: round1(cell.maxSpan),
    has_large_span: changes.some((c) => c.large_span),
  };
}

/**
 * Multi-route plan. For each target, search all three archetypes. Prefer
 * routes that reach the target; if none of an archetype can, return its best
 * partial plan (flagged unreachable). De-duplicate identical change sets
 * across archetypes so the UI doesn't show two identical routes.
 */
export function planRoutes(
  sex: Sex,
  grade: PlannerGrade,
  total: number,
  items: ScoreItemLike[],
  target: ImprovementTarget,
): MultiRoutePlan {
  const targetTotal = BAND_CUTOFF[target];
  const neededGain = round1(Math.max(0, targetTotal - total));
  const alreadyMet = total >= targetTotal;

  if (alreadyMet) {
    return {
      target,
      target_total: targetTotal,
      already_met: true,
      needed_gain: 0,
      routes: [],
      unreachable: false,
      needs_human: false,
      unreachable_reason: null,
      causal: false,
    };
  }

  const candidatesByItem = buildCandidates(sex, grade, items);
  const pruned = paretoPrune(candidatesByItem);

  const seen = new Set<string>();
  const routes: PlannedRoute[] = [];
  let anyReach = false;

  for (const arch of ROUTE_ARCHETYPES) {
    let cell = searchArchetype(pruned, neededGain, arch, true);
    if (cell) anyReach = true;
    if (!cell) cell = searchArchetype(pruned, neededGain, arch, false);
    if (!cell) continue;

    const key = cell.picks
      .map((p) => `${p.item}:${p.to_raw}`)
      .sort()
      .join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    routes.push(cellToRoute(cell, items, target, targetTotal, total, false));
  }

  // Order: routes that reach first, then by max_span ascending (less pressure).
  routes.sort((a, b) => {
    if (a.reaches_target !== b.reaches_target) return a.reaches_target ? -1 : 1;
    return a.max_span - b.max_span;
  });

  // No route reaches the target within the safety cap. Escalate to a human
  // rather than show a partial plan the student would read as achievable.
  if (!anyReach) {
    return {
      target,
      target_total: targetTotal,
      already_met: false,
      needed_gain: neededGain,
      routes: [],
      unreachable: true,
      needs_human: true,
      unreachable_reason:
        `No combination of up to 4 items reaches ${targetTotal} with each ` +
        `change within ${SAFETY_CAP_SD} cohort SD. Escalate to a PE teacher.`,
      causal: false,
    };
  }

  return {
    target,
    target_total: targetTotal,
    already_met: false,
    needed_gain: neededGain,
    routes,
    unreachable: false,
    needs_human: false,
    unreachable_reason: null,
    causal: false,
  };
}

/**
 * Plan toward an arbitrary numeric total (used by the staged-progress feature
 * for ~10-point intermediate targets, e.g. 50 -> 60 -> 70). Mirrors
 * {@link planRoutes} exactly but keys the target to a number rather than a
 * named band. Every candidate change is still bounded by SAFETY_CAP_SD; a
 * stage that cannot be reached within the cap returns needs_human.
 */
export function planRoutesForTotal(
  sex: Sex,
  grade: PlannerGrade,
  total: number,
  items: ScoreItemLike[],
  targetTotal: number,
): MultiRoutePlan {
  const roundedTarget = round1(targetTotal);
  const neededGain = round1(Math.max(0, roundedTarget - total));
  const alreadyMet = total >= roundedTarget - 1e-9;

  if (alreadyMet) {
    return {
      target: "credit",
      target_total: roundedTarget,
      already_met: true,
      needed_gain: 0,
      routes: [],
      unreachable: false,
      needs_human: false,
      unreachable_reason: null,
      causal: false,
    };
  }

  const candidatesByItem = buildCandidates(sex, grade, items);
  const pruned = paretoPrune(candidatesByItem);

  const seen = new Set<string>();
  const routes: PlannedRoute[] = [];
  let anyReach = false;

  for (const arch of ROUTE_ARCHETYPES) {
    let cell = searchArchetype(pruned, neededGain, arch, true);
    if (cell) anyReach = true;
    if (!cell) cell = searchArchetype(pruned, neededGain, arch, false);
    if (!cell) continue;

    const key = cell.picks
      .map((p) => `${p.item}:${p.to_raw}`)
      .sort()
      .join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    routes.push(
      cellToRoute(cell, items, "credit", roundedTarget, total, false),
    );
  }

  routes.sort((a, b) => {
    if (a.reaches_target !== b.reaches_target) return a.reaches_target ? -1 : 1;
    return a.max_span - b.max_span;
  });

  if (!anyReach) {
    return {
      target: "credit",
      target_total: roundedTarget,
      already_met: false,
      needed_gain: neededGain,
      routes: [],
      unreachable: true,
      needs_human: true,
      unreachable_reason:
        `No combination of up to 4 items reaches ${roundedTarget} with each ` +
        `change within ${SAFETY_CAP_SD} cohort SD. Escalate to a PE teacher.`,
      causal: false,
    };
  }

  return {
    target: "credit",
    target_total: roundedTarget,
    already_met: false,
    needed_gain: neededGain,
    routes,
    unreachable: false,
    needs_human: false,
    unreachable_reason: null,
    causal: false,
  };
}

/** Back-compat single-route wrapper used by the build-time store. */
export function planImprovement(
  sex: Sex,
  grade: PlannerGrade,
  total: number,
  items: ScoreItemLike[],
  target: ImprovementTarget,
): PlannedRoute {
  const plan = planRoutes(sex, grade, total, items, target);
  if (plan.already_met) {
    return {
      target,
      target_total: plan.target_total,
      already_met: true,
      style: "balanced",
      changes: [],
      projected_total: total,
      reaches_target: true,
      unreachable: false,
      causal: false,
      max_span: 0,
      has_large_span: false,
    };
  }
  if (plan.routes.length === 0) {
    return {
      target,
      target_total: plan.target_total,
      already_met: false,
      style: "balanced",
      changes: [],
      projected_total: total,
      reaches_target: false,
      unreachable: true,
      causal: false,
      max_span: 0,
      has_large_span: false,
    };
  }
  return plan.routes[0];
}

/**
 * Per-item diagnosis: current points, ceiling (100-point) raw, points still
 * available, the next better discrete level, and the marginal efficiency
 * (weighted points per unit effort) of taking that next step.
 */
export function diagnoseItems(
  sex: Sex,
  grade: PlannerGrade,
  items: ScoreItemLike[],
): ItemDiagnosis[] {
  const out: ItemDiagnosis[] = [];
  for (const raw of items) {
    const item = raw.indicator_id as FitnessItemId;
    const w = itemWeight(item) / 100;
    const pairs = itemThresholds(item, sex, grade);
    // 100-point raw (ceiling).
    const hundred = pairs.find(([s]) => s === 100);
    const ceilingRaw = hundred ? hundred[1] : null;
    const ceilingPoints = 100;
    const pointsToCeiling = round1(
      Math.max(0, (ceilingPoints - raw.points) * w),
    );

    // Next better level: first achievable level strictly above current.
    const levels = achievableLevels(item, sex, grade, raw.raw).filter(
      (l) => l.points > raw.points + 1e-9 || l.bonus > raw.bonus + 1e-9,
    );
    const next = levels[0] ?? null;
    let nextGain = 0;
    let nextEffort = 0;
    if (next) {
      const pointsDelta = (next.points - raw.points) * w;
      nextGain = round1(pointsDelta);
      nextEffort = effortOf(item, round1(next.raw - raw.raw));
    }
    const marginal =
      nextEffort > 1e-9 ? round1(nextGain / nextEffort) : nextGain > 0 ? 999 : 0;

    out.push({
      indicator_id: item,
      unit: raw.unit,
      raw: raw.raw,
      points: raw.points,
      bonus: raw.bonus,
      weight: itemWeight(item),
      ceiling_raw: ceilingRaw,
      ceiling_points: ceilingPoints,
      points_to_ceiling: pointsToCeiling,
      next_raw: next ? next.raw : null,
      next_points: next ? next.points : null,
      next_gain: nextGain,
      next_effort: nextEffort,
      marginal_efficiency: marginal,
      trainable: TRAINABLE.includes(item),
    });
  }
  return out;
}
