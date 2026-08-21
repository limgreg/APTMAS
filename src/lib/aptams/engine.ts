// The deterministic scoring pipeline — port of aptams/rule_engine/engine.py.
// Raw measurements -> per-item scores -> weighted total -> grade band + 附加分.
// Pure and side-effect-free: same inputs always produce same output, which is
// what lets downstream layers treat it as ground truth.

import {
  BAND_LABEL_EN,
  PASS_THRESHOLD,
  TOTAL_BAND_IS_DERIVED,
  bandForItemScore,
  bandForTotal,
  bonusFor,
  itemMeta,
  itemWeight,
  scoreItem,
} from "./tables";
import type {
  ItemScore,
  RawMeasurement,
  Sex,
  Grade,
  TotalScore,
} from "./types";

export interface ScoreInput {
  sex: Sex;
  grade: Grade;
  measurements: RawMeasurement[];
}

/** Decimal places the recorded totals carry. Port of analysis/scorecard.TOTAL_DECIMALS. */
export const TOTAL_DECIMALS = 1;

/**
 * Round a total to the recorded precision, half away from zero.
 *
 * Port of `analysis/scorecard.round_total`. Binary floats make half-way cases
 * ambiguous — 62.95 is stored slightly below 62.95, so a naive
 * `Math.round(x * 10) / 10` can land either side of the tie depending on the
 * order the seven contributions were summed in.
 *
 * An exact total is always an integer multiple of 0.05: item scores are
 * integers and every weight is a multiple of 0.05, and 附加分 is an integer. So
 * we snap to that grid first, which removes accumulation noise entirely and
 * makes this agree with the Python engine bit-for-bit regardless of summation
 * order. `steps * 0.5` is exactly representable in binary (0.5 is a power of
 * two), so the second rounding step carries no float error of its own.
 */
export function roundTotal(value: number): number {
  if (!Number.isFinite(value)) return value;
  const steps = Math.round(value / 0.05); // snap to the 0.05 grid, half up
  const tenths = Math.round(steps * 0.5); // exact; half up to 1 dp
  return tenths / 10;
}

export function scoreStudent(input: ScoreInput): TotalScore {
  const { sex, grade, measurements } = input;
  const items: ItemScore[] = [];
  let weighted = 0;
  let bonusTotal = 0;

  for (const m of measurements) {
    const meta = itemMeta(m.item);
    const score = scoreItem(m.item, sex, grade, m.value);
    const bonus = bonusFor(m.item, sex, grade, m.value);
    const band = bandForItemScore(score);
    const weight = itemWeight(m.item);
    items.push({
      item: m.item,
      raw: m.value,
      unit: meta.unit,
      score,
      bonus,
      band,
      label_zh: meta.label_zh,
      label_en: meta.label_en,
      weight,
    });
    weighted += score * (weight / 100);
    bonusTotal += bonus;
  }

  // 附加分 is added on top of the weighted total and the result is NOT capped
  // at 100 — verified against the cohort's own recorded totals, which reach
  // 104.4 (analysis/verify_scorecard.py). Each item's bonus is already bounded
  // by its own max_bonus in the scoring table; there is no additional
  // cross-item cap in the standard, so none is applied here.
  const total = roundTotal(weighted + bonusTotal);
  const base_total = roundTotal(weighted);
  const band = bandForTotal(total);

  return {
    total,
    base_total,
    bonus_total: bonusTotal,
    band,
    band_is_derived: TOTAL_BAND_IS_DERIVED,
    pass: total >= PASS_THRESHOLD,
    items,
  };
}

export { BAND_LABEL_EN, PASS_THRESHOLD, TOTAL_BAND_IS_DERIVED };
