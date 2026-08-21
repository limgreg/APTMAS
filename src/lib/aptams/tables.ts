// Loader for the national-standard scoring tables extracted from the official PDF.
// Port of aptams/rule_engine/tables.py + analysis/extract_scoring_tables.py.
//
// The single auditable origin of every scored number is:
//   data/ML/...大学生国家体质健康测试评分标准.pdf  (parsed by the extractor)
//     -> src/lib/aptams/data/university_2014.json   (loaded here)
// Nothing here invents a threshold.

import university2014 from "./data/university_2014.json";
import type {
  BandZh,
  FitnessItemId,
  Grade,
  GradeGroup,
  Sex,
} from "../types";

type ThresholdPair = [score: number, raw: number];

interface ItemDef {
  id: FitnessItemId;
  label_zh: string;
  label_en: string;
  unit: string;
  direction: "higher_is_better" | "lower_is_better" | "band_optimal";
  weight: number;
  scoring: "threshold" | "categorical";
  sex_specific_test?: boolean;
  thresholds?: Record<Sex, Record<GradeGroup, ThresholdPair[]>>;
  categories?: Array<{
    category: string;
    label_zh: string;
    score: number;
    male: { min: number | null; max: number | null };
    female: { min: number | null; max: number | null };
  }>;
}

interface BonusDef {
  basis: string;
  direction: "higher_is_better" | "lower_is_better";
  max_bonus: number;
  thresholds: Record<Sex, Record<GradeGroup, ThresholdPair[]>>;
}

interface TablesJson {
  standard: string;
  grade_band: string;
  score_levels: number[];
  grade_to_group: Record<Grade, GradeGroup>;
  item_bands: Record<BandZh, number[]>;
  items: ItemDef[];
  bonus: Record<string, BonusDef>;
  total_band_cutoffs: Record<BandZh, { total_min: number }>;
}

const TABLES = university2014 as unknown as TablesJson;

export function gradeToGroup(grade: Grade): GradeGroup {
  return TABLES.grade_to_group[grade];
}

export function itemMeta(item: FitnessItemId): ItemDef {
  const def = TABLES.items.find((i) => i.id === item);
  if (!def) throw new Error(`Unknown scoring item: ${item}`);
  return def;
}

/** Band (优秀/良好/...) for a single per-item score in [0,100]. */
export function bandForItemScore(score: number): BandZh {
  if (score >= 90) return "优秀";
  if (score >= 80) return "良好";
  if (score >= 60) return "及格";
  return "不及格";
}

/**
 * Score one raw measurement for an item.
 * Step function over the standard's printed [score, raw] pairs.
 * - higher_is_better: best score whose threshold raw <= value (vital capacity, jump, reach)
 * - lower_is_better:  best score whose threshold raw >= value (sprint, run time)
 * Values beyond the 100-point threshold earn a 0 per-item score here; 附加分 is
 * handled separately by bonusFor() so the bonus logic stays auditable.
 */
export function scoreItem(
  item: FitnessItemId,
  sex: Sex,
  grade: Grade,
  raw: number,
): number {
  const def = itemMeta(item);

  if (def.scoring === "categorical") {
    // Categories are anchored at their printed LOWER bounds, not matched on the
    // printed [min, max] interval. The standard prints bounds to one decimal
    // (低体重 <=17.8, 正常 17.9-23.9) but measured BMI is continuous, so a real
    // student at 17.8439 falls in none of the printed intervals. Anchoring at
    // lower bounds tiles the number line with no gap while preserving every
    // printed boundary. Port of aptams/rule_engine/tables.py::_score_categorical.
    const cats = def.categories ?? [];
    if (cats.length === 0) {
      throw new Error(`No categories defined for ${item}`);
    }
    const ordered = [...cats].sort(
      (a, b) =>
        (a[sex].min ?? Number.NEGATIVE_INFINITY) -
        (b[sex].min ?? Number.NEGATIVE_INFINITY),
    );
    let chosen: (typeof ordered)[number] | null = null;
    for (const cat of ordered) {
      const lo = cat[sex].min;
      if (lo === null || raw >= lo) chosen = cat;
    }
    if (!chosen) {
      throw new Error(`${item} ${raw} is below every category lower bound for ${sex}`);
    }
    return chosen.score;
  }

  const group = gradeToGroup(grade);
  const pairs = def.thresholds?.[sex]?.[group];
  if (!pairs || pairs.length === 0) {
    throw new Error(`No thresholds for ${item}/${sex}/${group}`);
  }

  if (def.direction === "higher_is_better") {
    // pairs are score-descending; raw thresholds also descending.
    let best = 0;
    for (const [s, r] of pairs) {
      if (raw >= r) {
        best = s;
        break;
      }
    }
    // Below the lowest (10-point) threshold -> 0.
    return best;
  }

  if (def.direction === "lower_is_better") {
    let best = 0;
    for (const [s, r] of pairs) {
      if (raw <= r) {
        best = s;
        break;
      }
    }
    return best;
  }

  throw new Error(`Unsupported direction for ${item}: ${def.direction}`);
}

/**
 * 附加分 (bonus). Awarded only by strength (reps above the 100-point threshold)
 * and endurance (seconds below the 100-point threshold). Capped per item at 10.
 * Returns the bonus points attributable to this item.
 */
export function bonusFor(
  item: FitnessItemId,
  sex: Sex,
  grade: Grade,
  raw: number,
): number {
  const bonusDef = TABLES.bonus[item];
  if (!bonusDef) return 0;

  const def = itemMeta(item);
  const group = gradeToGroup(grade);

  // The 100-point threshold is the first pair (score == 100) in the item table.
  const hundredPair = def.thresholds?.[sex]?.[group]?.find(([s]) => s === 100);
  if (!hundredPair) return 0;
  const hundredRaw = hundredPair[1];

  let excess: number;
  if (bonusDef.direction === "higher_is_better") {
    excess = raw - hundredRaw; // reps above 100-point mark
    if (excess <= 0) return 0;
  } else {
    excess = hundredRaw - raw; // seconds below 100-point mark
    if (excess <= 0) return 0;
  }

  // bonus thresholds are [bonus_points, excess] ascending in both.
  const bt = bonusDef.thresholds[sex][group];
  let points = 0;
  for (const [p, e] of bt) {
    if (excess >= e) points = p;
  }
  return Math.min(points, bonusDef.max_bonus);
}

export function itemWeight(item: FitnessItemId): number {
  return itemMeta(item).weight;
}

/**
 * The printed [score, raw] threshold pairs for an item/sex/grade group, in the
 * order stored in the standard (descending score). Each pair is an achievable
 * per-item score level and the raw value required to reach it.
 */
export function itemThresholds(
  item: FitnessItemId,
  sex: Sex,
  grade: Grade,
): Array<[number, number]> {
  const def = itemMeta(item);
  if (def.scoring === "categorical") return [];
  const group = gradeToGroup(grade);
  return def.thresholds?.[sex]?.[group] ?? [];
}

/** Bonus definition accessor (max bonus + direction) for a given item. */
export function itemBonusDef(item: FitnessItemId):
  | { max_bonus: number; direction: "higher_is_better" | "lower_is_better" }
  | undefined {
  const b = TABLES.bonus[item];
  return b ? { max_bonus: b.max_bonus, direction: b.direction } : undefined;
}

/**
 * TRUE while the total-level band cutoffs are a derived reading rather than a
 * printed table. The source standard groups per-ITEM scores under 等级 headings
 * (优秀 100-90, 良好 85-80, 及格 78-60, 不及格 50-10); applying that same
 * grouping to the weighted TOTAL is the conventional reading but is not printed
 * anywhere in the PDF. `data/scoring_tables/university_2014.json` marks it
 * `"derived": true` with "Confirm with mentors before any total-level band is
 * shown to a user" — so any UI showing a total band must mark it provisional.
 * Flip to false once mentors confirm (docs/task_a_results.md §4 item 5).
 */
export const TOTAL_BAND_IS_DERIVED = true;

/** Total weighted score -> grade band using the (derived) total cutoffs. */
export function bandForTotal(total: number): BandZh {
  const c = TABLES.total_band_cutoffs;
  if (total >= c["优秀"].total_min) return "优秀";
  if (total >= c["良好"].total_min) return "良好";
  if (total >= c["及格"].total_min) return "及格";
  return "不及格";
}

/**
 * The scholarship pass gate: evaluation-year total >= 60.0.
 *
 * RESOLVED FROM DATA, not assumed. Lowest passing score 60.0, highest failing
 * score 59.9, 100% agreement across all 20,140 students
 * (`analysis/route_to_pass.verify_pass_threshold`; docs/task_a_results.md §2).
 */
export const PASS_THRESHOLD = 60;

export const BAND_LABEL_EN: Record<BandZh, string> = {
  优秀: "Excellent",
  良好: "Good",
  及格: "Pass",
  不及格: "Fail",
};

export function allItemDefs(): ItemDef[] {
  return TABLES.items;
}

export function standardName(): string {
  return TABLES.standard;
}
