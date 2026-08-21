// Exact counterfactual search — port of aptams/counterfactual/planner.py.
// This is arithmetic over the scoring table, NOT a causal training claim.
// It finds small, safely-capped per-item improvements that reach a target
// total (pass line or next band), ranked by estimated effort.

import { scoreStudent } from "./engine";
import { itemMeta, scoreItem } from "./tables";
import type { FitnessItemId, Grade, Sex, TotalScore } from "./types";

export interface ItemChange {
  item: FitnessItemId;
  delta: number; // signed change in raw units
  unit: string;
  label_zh: string;
  label_en: string;
  gained_points: number; // total-score points this change contributes
  effort_estimate_zh: string;
  effort_estimate_en: string;
  effort_is_placeholder: boolean;
}

export interface RouteOption {
  id: string;
  changes: ItemChange[];
  projected_total: number;
  projected_band: TotalScore["band"];
  causal: false;
}

export interface RouteResult {
  target: "pass" | "next_band";
  current_total: number;
  target_total: number;
  options: RouteOption[];
  needs_human: boolean;
  causal: false;
  note_zh: string;
  note_en: string;
}

// Safe caps on plausible single-item improvement between tests. Anything beyond
// these is treated as implausible and the route escalates to a human (coach).
// These are deliberately conservative; real expert rules replace them later.
const SAFE_CAP: Partial<Record<FitnessItemId, number>> = {
  vital_capacity: 600, // ml
  sprint_50m: -0.8, // s (improvement is negative)
  sit_and_reach: 6, // cm
  standing_long_jump: 15, // cm
  strength: 8, // reps
  endurance_run: -30, // s
};

// Rough effort mapping. Marked PLACEHOLDER until mentor expert rules arrive.
function effortLabel(
  item: FitnessItemId,
  delta: number,
): { zh: string; en: string } {
  const abs = Math.abs(delta);
  const weeks =
    item === "sit_and_reach"
      ? Math.max(1, Math.round(abs / 2))
      : item === "strength"
        ? Math.max(2, Math.round(abs * 1.5))
        : item === "endurance_run"
          ? Math.max(3, Math.round(abs / 5))
          : item === "sprint_50m"
            ? Math.max(3, Math.round(abs * 6))
            : item === "vital_capacity"
              ? Math.max(3, Math.round(abs / 120))
              : Math.max(3, Math.round(abs / 4));
  return {
    zh: `约 ${weeks} 周规律训练（专家规则待定）`,
    en: `~${weeks} weeks of consistent training (expert rules TBC)`,
  };
}

function applyDelta(values: Record<string, number>, item: FitnessItemId, delta: number): number {
  const v = values[item] + delta;
  // floor at zero for physical measurements
  return item === "sprint_50m" || item === "endurance_run"
    ? Math.max(1, v)
    : Math.max(0, v);
}

/**
 * Enumerate single-item improvements up to the safe cap and pick the cheapest
 * (smallest normalized effort) option(s) that reach the target. We also return
 * 2-item combos so the UI can show alternatives. Exact, not ML.
 */
export function planRoute(
  sex: Sex,
  grade: Grade,
  measurements: { item: FitnessItemId; value: number }[],
  current: TotalScore,
  target: "pass" | "next_band" = "pass",
): RouteResult {
  const targetTotal =
    target === "pass"
      ? 60
      : current.band === "不及格"
        ? 60
        : current.band === "及格"
          ? 80
          : current.band === "良好"
            ? 90
            : 100;

  const note = {
    zh: "以下为评分表上的算术推演，展示“达到目标的一种组合”，并非训练效果的承诺。",
    en: "These are arithmetic paths over the scoring table, not promises that training will produce the stated gain.",
  };

  if (current.total >= targetTotal) {
    return {
      target,
      current_total: current.total,
      target_total: targetTotal,
      options: [],
      needs_human: false,
      causal: false,
      note_zh: note.zh,
      note_en: note.en,
    };
  }

  const values: Record<string, number> = {};
  for (const m of measurements) values[m.item] = m.value;

  const gap = targetTotal - current.total;
  const options: RouteOption[] = [];

  const scoreWith = (vals: Record<string, number>): TotalScore =>
    scoreStudent({
      sex,
      grade,
      measurements: (Object.keys(vals) as FitnessItemId[]).map((item) => ({
        item,
        value: vals[item],
      })),
    });

  const mutableItems: FitnessItemId[] = (
    ["vital_capacity", "sprint_50m", "sit_and_reach", "standing_long_jump", "strength", "endurance_run"] as FitnessItemId[]
  ).filter((it) => it in values);

  // Single-item routes — granular steps within the safe cap.
  for (const item of mutableItems) {
    const cap = SAFE_CAP[item] ?? 0;
    // scan in small steps; for lower-is-better cap is negative.
    const step =
      item === "endurance_run"
        ? -2
        : item === "sprint_50m"
          ? -0.2
          : item === "sit_and_reach"
            ? 1
            : item === "vital_capacity"
              ? 50
              : item === "strength"
                ? 1
                : 2;
    let delta = 0;
    let bestDelta = 0;
    // Iterate up to |cap|/|step|
    const maxSteps = Math.floor(Math.abs(cap) / Math.abs(step));
    for (let s = 1; s <= maxSteps; s++) {
      delta = step * s;
      const trial = { ...values, [item]: applyDelta(values, item, delta) };
      const proj = scoreWith(trial);
      if (proj.total >= targetTotal) {
        bestDelta = delta;
        const effort = effortLabel(item, delta);
        const meta = itemMeta(item);
        options.push({
          id: `single-${item}`,
          changes: [
            {
              item,
              delta,
              unit: meta.unit,
              label_zh: meta.label_zh,
              label_en: meta.label_en,
              gained_points: Math.round((proj.total - current.total) * 10) / 10,
              effort_estimate_zh: effort.zh,
              effort_estimate_en: effort.en,
              effort_is_placeholder: true,
            },
          ],
          projected_total: proj.total,
          projected_band: proj.band,
          causal: false,
        });
        break;
      }
    }
  }

  // Two-item combos: split the gap across two items at half-cap each.
  for (let i = 0; i < mutableItems.length; i++) {
    for (let j = i + 1; j < mutableItems.length; j++) {
      const a = mutableItems[i];
      const b = mutableItems[j];
      // Try proportional half-effort combos
      const candidates: Array<[number, number]> = [
        [0.5, 0.5],
        [0.3, 0.7],
        [0.7, 0.3],
      ];
      for (const [fa, fb] of candidates) {
        const capA = (SAFE_CAP[a] ?? 0) * fa;
        const capB = (SAFE_CAP[b] ?? 0) * fb;
        const trial = {
          ...values,
          [a]: applyDelta(values, a, capA),
          [b]: applyDelta(values, b, capB),
        };
        const proj = scoreWith(trial);
        if (proj.total >= targetTotal) {
          const metaA = itemMeta(a);
          const metaB = itemMeta(b);
          const effA = effortLabel(a, capA);
          const effB = effortLabel(b, capB);
          options.push({
            id: `combo-${a}-${b}-${fa}`,
            changes: [
              {
                item: a,
                delta: Math.round(capA * 10) / 10,
                unit: metaA.unit,
                label_zh: metaA.label_zh,
                label_en: metaA.label_en,
                gained_points: 0,
                effort_estimate_zh: effA.zh,
                effort_estimate_en: effA.en,
                effort_is_placeholder: true,
              },
              {
                item: b,
                delta: Math.round(capB * 10) / 10,
                unit: metaB.unit,
                label_zh: metaB.label_zh,
                label_en: metaB.label_en,
                gained_points: 0,
                effort_estimate_zh: effB.zh,
                effort_estimate_en: effB.en,
                effort_is_placeholder: true,
              },
            ],
            projected_total: proj.total,
            projected_band: proj.band,
            causal: false,
          });
          break;
        }
      }
    }
  }

  // Rank by total absolute improvement effort (use |delta| normalized by cap).
  const effortSize = (o: RouteOption): number =>
    o.changes.reduce((sum, c) => {
      const cap = Math.abs(SAFE_CAP[c.item] ?? 1);
      return sum + Math.abs(c.delta) / cap;
    }, 0);

  options.sort((a, b) => effortSize(a) - effortSize(b));
  const top = options.slice(0, 3);

  const needs_human = top.length === 0;

  return {
    target,
    current_total: current.total,
    target_total: targetTotal,
    options: top,
    needs_human,
    causal: false,
    note_zh: note.zh,
    note_en: note.en,
  };
}

// Re-export for live "what if" scoring in the UI slider explorer.
export function scoreHypothetical(
  sex: Sex,
  grade: Grade,
  values: Record<string, number>,
): TotalScore {
  return scoreStudent({
    sex,
    grade,
    measurements: (Object.keys(values) as FitnessItemId[]).map((item) => ({
      item,
      value: values[item],
    })),
  });
}

export { scoreItem };
