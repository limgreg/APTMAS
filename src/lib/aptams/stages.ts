// Staged / progressive improvement planner (Pointer 3).
//
// This adds the "70-point target + ~10-point stages + self-assessment" flow on
// top of the deterministic route planner. Like everything else in this codebase
// it is exact arithmetic over the national scoring table — NOT a causal training
// claim and NOT LLM-generated. The LLM only narrates what this module computes.
//
// Rules (from the product spec):
//   - Targets are 60 / 70 / 80 / 90.
//   - If the final target is 60, plan directly current -> 60 (one stage).
//   - Otherwise, if the gap to the final target is <= 20 points, plan directly.
//   - If the gap is > 20 points, split into stages of roughly 10 points each,
//     starting at the next multiple of 10 above the current score.
//   - A later stage must never be shown before the previous one is reached.
//
// Every per-stage route still passes through planner.planRoutesForTotal, which
// bounds every item change by SAFETY_CAP_SD and returns needs_human when a stage
// is not safely reachable — staging does not weaken the injury cap.

import { scoreStudent, roundTotal } from "./engine";
import {
  planRoutesForTotal,
  SAFETY_CAP_SD,
  type MultiRoutePlan,
} from "./planner";
import type { FitnessItemId, Grade, Sex } from "../types";

export type FinalTarget = 60 | 70 | 80 | 90;

/** A student's starting point for the staged flow: sex, grade, total, items. */
export interface StageBaseline {
  sex: Sex;
  grade: Grade;
  total: number;
  items: Array<{ indicator_id: FitnessItemId; raw: number }>;
}

export type StageStatus =
  | "locked"
  | "training"
  | "achieved";

export interface Stage {
  /** Zero-based index. */
  index: number;
  /** Total score at the start of this stage. */
  from_total: number;
  /** Target total for this stage. */
  to_total: number;
  /** True when this is the last stage (to_total === final target). */
  is_final: boolean;
  status: StageStatus;
  /** Routes for THIS stage only (computed from the stage's starting totals). */
  plan: MultiRoutePlan;
}

export interface StagedPlan {
  final_target: FinalTarget;
  start_total: number;
  stages: Stage[];
  /** True when the current total already meets the final target. */
  already_met: boolean;
  /** Index of the stage the student is currently training on. */
  current_index: number;
  /** Stage targets as a flat list for the progress ladder, e.g. [50,60,70,80]. */
  ladder: number[];
  non_causal: true;
}

/** Gaps of this many points or less are planned directly without splitting. */
export const DIRECT_MAX_GAP = 20;
/** Stage width when a long gap is split into chunks. */
export const STAGE_WIDTH = 10;

/**
 * Compute the list of stage target totals from a starting total to a final
 * target, per the product spec. The first stage's `from` is the start total;
 * later stages start where the previous one ended.
 */
export function stageTargets(
  startTotal: number,
  finalTarget: FinalTarget,
): number[] {
  const start = roundTotal(startTotal);
  if (start >= finalTarget) return [finalTarget];

  // 60 is always a single direct stage (the scholarship/pass gate).
  if (finalTarget === 60) return [60];

  const gap = finalTarget - start;
  if (gap <= DIRECT_MAX_GAP) {
    return [finalTarget];
  }

  // Split into ~10-point stages, anchored at the next multiple of 10 above the
  // current score so the ladder reads e.g. 50 -> 60 -> 70 -> 80.
  const targets: number[] = [];
  const firstTarget = Math.min(finalTarget, Math.ceil(start / STAGE_WIDTH) * STAGE_WIDTH);
  let t = firstTarget;
  // Guard against an infinite loop if the first anchor does not advance.
  let guard = 0;
  while (t < finalTarget && guard++ < 20) {
    targets.push(t);
    t += STAGE_WIDTH;
  }
  targets.push(finalTarget);
  return targets;
}

/**
 * Build the full staged plan. Each stage's routes are computed as if the
 * student had already reached the previous stage's target — i.e. the per-stage
 * baseline assumes the earlier gains are banked. This is an arithmetic
 * projection, not a promise that training will produce the gains.
 *
 * @param completedStages  number of stages already self-assessed as reached
 *   (persisted by the UI; 0 for a fresh plan).
 */
export function buildStagedPlan(
  baseline: StageBaseline,
  finalTarget: FinalTarget,
  completedStages = 0,
): StagedPlan {
  const start = roundTotal(baseline.total);
  const targets = stageTargets(start, finalTarget);

  if (start >= finalTarget) {
    return {
      final_target: finalTarget,
      start_total: start,
      stages: [],
      already_met: true,
      current_index: 0,
      ladder: [start, finalTarget],
      non_causal: true,
    };
  }

  const stages: Stage[] = [];
  let fromTotal = start;

  targets.forEach((toTotal, index) => {
    // Project item raws forward to the previous target so the per-stage search
    // measures effort from where the student will stand. For the first stage
    // this is just the real baseline; later stages reuse the final stage's
    // chosen change set applied additively (a projection — see non_causal).
    const projectedRaw =
      index === 0 ? null : projectedRaws(baseline, stages, index);

    const scored = scoreStudent({
      sex: baseline.sex,
      grade: baseline.grade,
      measurements: (projectedRaw ?? baseline.items).map((it) => ({
        item: it.indicator_id,
        value: it.raw,
      })),
    });
    const items = scored.items.map((it) => ({
      indicator_id: it.item,
      raw: it.raw,
      unit: it.unit,
      points: it.score,
      bonus: it.bonus,
    }));

    const plan = planRoutesForTotal(
      baseline.sex,
      baseline.grade,
      fromTotal,
      items,
      toTotal,
    );

    let status: StageStatus = "locked";
    if (index < completedStages) status = "achieved";
    else if (index === completedStages) status = "training";

    stages.push({
      index,
      from_total: fromTotal,
      to_total: toTotal,
      is_final: toTotal === finalTarget,
      status,
      plan,
    });
    fromTotal = toTotal;
  });

  return {
    final_target: finalTarget,
    start_total: start,
    stages,
    already_met: false,
    current_index: Math.min(completedStages, Math.max(0, stages.length - 1)),
    ladder: [start, ...targets],
    non_causal: true,
  };
}

/**
 * Project item raws forward for a later stage by applying the best route's
 * change set from each prior stage cumulatively. This keeps the per-stage
 * safety cap measured from the projected standing rather than from g1 raw
 * values, which is the conservative reading (cap applies to each incremental
 * ask). Falls back to baseline items if a prior stage is unreachable.
 */
function projectedRaws(
  baseline: StageBaseline,
  stages: Stage[],
  upToIndex: number,
): Array<{ indicator_id: FitnessItemId; raw: number }> {
  const raws = new Map<FitnessItemId, number>();
  for (const it of baseline.items) raws.set(it.indicator_id, it.raw);

  for (let i = 0; i < upToIndex; i++) {
    const stage = stages[i];
    const route = stage.plan.routes.find((r) => r.reaches_target) ?? stage.plan.routes[0];
    if (!route) continue;
    for (const change of route.changes) {
      const prev = raws.get(change.indicator_id) ?? 0;
      raws.set(change.indicator_id, round1raw(prev + change.delta));
    }
  }

  return baseline.items.map((it) => ({
    indicator_id: it.indicator_id,
    raw: raws.get(it.indicator_id) ?? it.raw,
  }));
}

function round1raw(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Score a self-assessment: the student enters their latest RAW measurements
 * (one or more items may be blank and are kept at the prior value) and the
 * deterministic engine recomputes their total. No LLM, no guesswork.
 *
 * Returns the new total and which stage it reaches.
 */
export function scoreSelfAssessment(
  baseline: { sex: Sex; grade: Grade },
  currentItems: Array<{ indicator_id: FitnessItemId; raw: number; unit: string }>,
  updated: Partial<Record<FitnessItemId, number>>,
): { total: number; items: Array<{ indicator_id: FitnessItemId; raw: number }> } {
  const merged = currentItems.map((it) => {
    const next = updated[it.indicator_id];
    return {
      item: it.indicator_id,
      value: typeof next === "number" && Number.isFinite(next) ? next : it.raw,
    };
  });

  const scored = scoreStudent({
    sex: baseline.sex,
    grade: baseline.grade,
    measurements: merged,
  });

  return {
    total: scored.total,
    items: merged.map((m) => ({ indicator_id: m.item, raw: m.value })),
  };
}

/**
 * Decide the outcome of a self-assessment against the current stage.
 *   - met:        the new total reaches (or passes) the stage target
 *   - short:      still below the stage target (stay & keep training)
 *   - already:    new total already reaches the FINAL target (done)
 */
export function assessStage(
  plan: StagedPlan,
  newTotal: number,
): { outcome: "met" | "short" | "already"; next_index: number; gap: number } {
  const current = plan.stages[plan.current_index];
  if (!current) {
    return { outcome: "already", next_index: plan.current_index, gap: 0 };
  }
  const gap = roundTotal(current.to_total - newTotal);
  if (newTotal >= plan.final_target - 1e-9) {
    return { outcome: "already", next_index: plan.stages.length, gap: 0 };
  }
  if (newTotal >= current.to_total - 1e-9) {
    return {
      outcome: "met",
      next_index: Math.min(plan.current_index + 1, plan.stages.length),
      gap: 0,
    };
  }
  return { outcome: "short", next_index: plan.current_index, gap: Math.max(0, gap) };
}

export { SAFETY_CAP_SD };
