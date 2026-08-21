// APTAMS domain types — ports of the Python scaffold's typed contracts.
// These carry structure only; the only numbers that live here are vocabulary
// (grade bands, layers), never scoring thresholds.

export type Sex = "male" | "female";
export type Grade = "g1" | "g2" | "g3" | "g4";
export type GradeGroup = "g1g2" | "g3g4";
export type BandZh = "优秀" | "良好" | "及格" | "不及格";
export type BandEn = "excellent" | "good" | "pass" | "fail";

export type DataLayer = "verified" | "measured" | "reported";

export type Dimension =
  | "fitness"
  | "metabolism"
  | "behaviour"
  | "psychology"
  | "environment";

export type ItemDirection =
  | "higher_is_better"
  | "lower_is_better"
  | "band_optimal";

/** The seven scored fitness item ids — the controlled vocabulary. */
export type FitnessItemId =
  | "bmi"
  | "vital_capacity"
  | "sprint_50m"
  | "sit_and_reach"
  | "standing_long_jump"
  | "strength"
  | "endurance_run";

export interface ItemScore {
  item: FitnessItemId;
  raw: number;
  unit: string;
  score: number; // 0..100 per-item score
  bonus: number; // 附加分 attributed to this item
  band: BandZh;
  label_zh: string;
  label_en: string;
  weight: number; // 0..100
}

export interface TotalScore {
  total: number; // weighted + 附加分; NOT capped at 100 (recorded totals reach 104.4)
  base_total: number; // weighted without bonus
  bonus_total: number;
  band: BandZh;
  /** True while the total-level band is a derived reading, not a printed table. */
  band_is_derived: boolean;
  pass: boolean;
  items: ItemScore[];
}

export interface RawMeasurement {
  item: FitnessItemId;
  value: number;
}

export interface StudentRecord {
  student_id: string;
  sex: Sex;
  grade: Grade;
  cohort_year: number;
  measurements: RawMeasurement[];
}
