// Shared domain types for the APTAMS web app.
// The runtime shape follows docs/task_b_handoff.md schema v0.1 (the reference
// Task A hand-off object), normalized for the UI in src/lib/aptams/store.ts.

export type DataLayer = "verified" | "measured" | "reported";
export type Locale = "zh" | "en" | "ko";
export type Sex = "male" | "female";
export type Grade = "g1" | "g2" | "g3" | "g4";
// 2014 national standard collapses g1/g2 and g3/g4 into two table groups.
export type GradeGroup = "g1_g2" | "g3_g4";
export type Band = "excellent" | "good" | "pass" | "fail";
export type BandZh = "优秀" | "良好" | "及格" | "不及格";
export type FitnessItemId =
  | "bmi"
  | "vital_capacity"
  | "sprint_50m"
  | "sit_and_reach"
  | "standing_long_jump"
  | "strength"
  | "endurance_run";
export type Risk = "on_track" | "watch" | "at_risk";

export interface Indicator {
  indicator_id: string;
  dimension:
    | "fitness"
    | "metabolism"
    | "behaviour"
    | "psychology"
    | "environment";
  layer: DataLayer;
  value: number | string;
  unit: string | null;
  teacher_visible: boolean;
  provenance: string;
  reference?: { who_min?: number; who_max?: number; source?: string };
}

export interface ScoreItem {
  indicator_id: string;
  raw: number;
  unit: string;
  points: number;
  bonus: number;
  band: string;
  provenance: string;
}

export interface Driver {
  indicator_id: string;
  provenance: string;
  driver_provenance: string;
  direction: "helps" | "lowers";
  strength: number;
  shap: number;
  method: string;
  explanation: string;
  actionable: boolean;
}

export interface Progress {
  available: boolean;
  on_track: boolean;
  risk: Risk;
  pass_probability: number;
  uncertainty: string;
  drivers: Driver[];
  provenance: string;
}

export interface StudentType {
  segment_id: string;
  segment_label_zh: string;
  segment_label_en: string;
  weaknesses: string[];
  provenance: string;
}

export interface RouteChange {
  indicator_id: string;
  delta: number;
  unit: string;
  from_points: number;
  to_points: number;
  effort_sd: number;
  from_raw?: number;
  to_raw?: number;
}

export interface RouteOption {
  id: string;
  changes: RouteChange[];
  projected_total: number;
  effort_estimate: string;
  effort_is_placeholder: boolean;
  provenance: string;
  causal: false;
}

export interface Score {
  items: ScoreItem[];
  total: number;
  bonus: number;
  band: string;
  band_en: Band;
  band_is_derived: boolean;
  pass: boolean;
  pass_threshold: number;
  provenance: string;
}

export interface Route {
  target: string;
  target_total: number;
  already_met: boolean;
  options: RouteOption[];
  needs_human: boolean;
  unreachable_reason: string | null;
  causal: false;
  note_zh: string;
  note_en: string;
}

export interface Student {
  schema_version: string;
  student_id: string;
  meta: { sex: Sex; grade: string; cohort_year: number; as_of: string };
  score: Score;
  route: Route;
  progress: Progress;
  type: StudentType;
  indicators: Indicator[];
  withheld_self_report?: { count: number; dimensions: string[] };
  flags: string[];
  /** Four sittings, oldest first. Absent for manually entered students. */
  history?: HistoryPoint[];
  /** Trajectory class over those sittings. Absent without a history. */
  trajectory?: TrajectoryInfo;
}

export interface HistoryPoint {
  grade: string;
  total: number;
  band: string;
  pass: boolean;
  items: Record<string, number>;
  provenance: string;
}

export interface TrajectoryInfo {
  trajectory_id: string;
  label_en: string;
  label_zh: string;
  /** Points per year, OLS over the four sittings. */
  slope: number;
  /** Last total minus first — the number a student recognises about themselves. */
  delta: number;
  totals: number[];
  crossings: number;
  /** Crossed the gate more than once: the direction is less settled than the label. */
  volatile: boolean;
  is_priority: boolean;
  slope_threshold: number;
  provenance: string;
}

export interface StudentMeta {
  student_id: string;
  sex: Sex;
  total: number;
  band: Band;
  pass: boolean;
  risk: Risk;
  pass_probability: number;
  segment_id: string;
  segment_label_zh: string;
  segment_label_en: string;
  flags: string[];
  needs_human: boolean;
  at_risk: boolean;
  pass_threshold: number;
  /** Trajectory class, absent for students without a four-year history. */
  trajectory_id?: string;
  trajectory_label_zh?: string;
  trajectory_label_en?: string;
  trajectory_slope?: number;
  trajectory_priority?: boolean;
}

export interface CohortResponse {
  n: number;
  aggregates: {
    excellent: number;
    good: number;
    pass: number;
    fail: number;
    on_track: number;
    watch: number;
    at_risk: number;
    needs_human: number;
    mean_total: number;
    pass_rate: number;
    at_risk_rate: number;
    mean_pass_probability: number;
    bands: { excellent: number; good: number; pass: number; fail: number };
    risks: { on_track: number; watch: number; at_risk: number };
  };
  /** Trajectory classes: how students are CHANGING, complementing `segments`. */
  trajectories?: Array<{
    trajectory_id: string;
    label_zh: string;
    label_en: string;
    count: number;
    is_priority: boolean;
    mean_slope?: number | null;
  }>;
  segments: Array<{
    segment_id: string;
    segment_label_zh: string;
    segment_label_en: string;
    count: number;
    /** Cluster profile from Task A model 4 (KMeans over item scores). Aggregates only. */
    headroom_item?: string;
    relative_strength?: string;
    is_low_baseline?: boolean;
    mean_total?: number | null;
    share_below_pass?: number | null;
    /** Centroid in item-score space — what actually characterises the group. */
    mean_item_scores?: Record<string, number>;
  }>;
  progress_model: {
    accuracy: number;
    auc: number;
    brier: number;
    method: string;
    n_train: number;
    n_test: number;
    feature_set: string;
    target: string;
    global_importance: { indicator_id: string; importance: number }[];
    eval_grade?: string;
    horizon_years?: number;
    split_kind?: string;
    log_loss?: number;
    threshold_support?: number;
    sensitivity_target?: number;
    model_version?: string;
  };
}
