// Server-side data store for the precomputed cohort.
// Consumes the build-time artifact produced by the REFERENCE Task A pipeline
// (scripts/precompute/build_reference_cohort.py), which emits hand-off objects
// conforming to docs/task_b_handoff.md schema v0.1.
//
// Role-aware accessors enforce the privacy boundary: teachers never receive
// teacher_visible:false self-report (the reference for_role() runs at build
// time into _teacher_view; this file is a second line of defence).

import cohortJson from "./data/cohort.json";
import { bonusFor, itemMeta, itemWeight, scoreItem } from "./tables";
import { scoreIntakeRow, type IntakeRow } from "./intake";
import type { FitnessItemId, Grade as EngineGrade } from "./types";
import type { CohortResponse, StudentMeta } from "@/lib/types";

export type BandEn = "excellent" | "good" | "pass" | "fail";
export type Sex = "male" | "female";
export type Grade = "g1" | "g2" | "g3" | "g4";
export type Layer = "verified" | "measured" | "reported";
export type Dimension =
  | "fitness"
  | "metabolism"
  | "behaviour"
  | "psychology"
  | "environment";
export type Risk = "on_track" | "watch" | "at_risk";

const BAND_ZH_TO_EN: Record<string, BandEn> = {
  优秀: "excellent",
  良好: "good",
  及格: "pass",
  不及格: "fail",
};

export interface Indicator {
  indicator_id: string;
  dimension: Dimension;
  layer: Layer;
  value: number | string;
  unit: string | null;
  teacher_visible: boolean;
  provenance: string;
  reference?: { who_min?: number; who_max?: number };
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

export interface RouteChange {
  indicator_id: string;
  delta: number;
  unit: string;
  from_points: number;
  to_points: number;
  effort_sd: number;
  from_raw?: number;
  to_raw?: number;
  causal?: false;
}

export interface RouteOption {
  id: string;
  changes: RouteChange[];
  projected_total: number;
  effort_estimate: string;
  effort_is_placeholder: boolean;
  provenance: string;
}

export interface Student {
  schema_version: string;
  student_id: string;
  meta: { sex: Sex; grade: Grade; cohort_year: number; as_of: string };
  score: {
    items: ScoreItem[];
    total: number;
    bonus: number;
    band: string;
    band_en: BandEn;
    band_is_derived: boolean;
    pass: boolean;
    pass_threshold: number;
    provenance: string;
  };
  route: {
    target: string;
    target_total: number;
    already_met: boolean;
    options: RouteOption[];
    needs_human: boolean;
    unreachable_reason: string | null;
    causal: false;
    note_zh: string;
    note_en: string;
  };
  progress: {
    available: boolean;
    on_track: boolean;
    risk: Risk;
    pass_probability: number;
    uncertainty: string;
    drivers: Driver[];
    provenance: string;
    /** Build-time model version hash (e.g. pc-g1-g4-xxxxxxxxxxxx). */
    model_version?: string;
  };
  type: {
    segment_id: string;
    segment_label_zh: string;
    segment_label_en: string;
    weaknesses: string[];
    provenance: string;
  };
  indicators: Indicator[];
  flags: string[];
  /** Four-year history, oldest first. Absent for manually entered students. */
  history?: HistoryPoint[];
  /** Trajectory class from Task A trajectories.py. Absent without a history. */
  trajectory?: TrajectoryInfo;
}

export interface HistoryPoint {
  grade: Grade;
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
  /** Points per year from an OLS fit over the four sittings. */
  slope: number;
  /** g4 total minus g1 total — the number a student recognises about themselves. */
  delta: number;
  totals: number[];
  crossings: number;
  /** Crossed the gate more than once, so the class is less settled than it looks. */
  volatile: boolean;
  is_priority: boolean;
  slope_threshold: number;
  provenance: string;
}

interface CohortFile {
  schema_version: string;
  generated_by: string;
  model: string;
  pass_threshold: number;
  progress_model: {
    method: string;
    feature_set: string;
    eval_grade?: string;
    horizon_years?: number;
    split_kind?: string;
    target: string;
    accuracy: number;
    auc: number;
    brier: number;
    log_loss?: number;
    threshold_support?: number;
    sensitivity_target?: number;
    n_train: number;
    n_test: number;
    model_version?: string;
    global_drivers: { indicator_id: string; importance: number }[];
  };
  cohort_aggregates: {
    n: number;
    pass_rate_model: number;
    at_risk: number;
    at_risk_rate: number;
    mean_pass_probability: number;
    mean_total: number;
    bands: Record<string, number>;
    risks: Record<string, number>;
    segments: Record<string, number>;
  };
  segment_profiles?: Array<{
    segment_id: string;
    segment_label_zh: string;
    segment_label_en: string;
    headroom_item: string;
    relative_strength: string;
    is_low_baseline: boolean;
    n: number;
    mean_total: number | null;
    share_below_pass: number | null;
    mean_item_scores: Record<string, number>;
  }>;
  students: unknown[];
}

const DATA = cohortJson as unknown as CohortFile;

const ROUTE_NOTE_ZH =
  "路径基于评分表的算术测算，并非因果预测——训练不一定带来等幅提升。请以体育老师指导为准。";
const ROUTE_NOTE_EN =
  "Routes are arithmetic over the scoring table, not a causal prediction — training may not produce the same gain. Follow PE-teacher guidance.";

function bandEn(zh: string): BandEn {
  return BAND_ZH_TO_EN[zh] ?? "pass";
}

/** Project the raw value for a route change (higher_better adds; times subtract). */
function projectRaw(item: ScoreItem, change: RouteChange): number {
  if (change.unit === "s") return Math.round((item.raw + change.delta) * 10) / 10;
  return Math.round((item.raw + change.delta) * 10) / 10;
}

// Fitness items that can sensibly be trained to improve a score. BMI is
// intentionally excluded — the product never gives weight/body-shape advice.
const TRAINABLE: FitnessItemId[] = [
  "vital_capacity",
  "sprint_50m",
  "sit_and_reach",
  "standing_long_jump",
  "strength",
  "endurance_run",
];

// Conservative cap on a plausible single-test improvement per item (ported from
// counterfactual.ts SAFE_CAP). Times improve downward, hence negative.
const NEXT_BAND_CAP: Partial<Record<FitnessItemId, number>> = {
  vital_capacity: 600,
  sprint_50m: -0.8,
  sit_and_reach: 6,
  standing_long_jump: 15,
  strength: 8,
  endurance_run: -30,
};

function nextBandTarget(total: number): { target_total: number; target_label: string } {
  if (total < 60) return { target_total: 60, target_label: "pass" };
  if (total < 80) return { target_total: 80, target_label: "good" };
  if (total < 90) return { target_total: 90, target_label: "excellent" };
  return { target_total: 90, target_label: "excellent" };
}

/**
 * For a student who has already met the pass line, build a non-causal
 * "next band" suggestion: the cheapest single-item improvement (by raw
 * magnitude) that lifts the weighted total to the next band cutoff. This is
 * arithmetic over the scoring table, never a promise that training delivers it.
 */
function buildNextBandRoute(
  sex: Sex,
  grade: Grade,
  total: number,
  items: ScoreItem[],
): Student["route"] {
  const { target_total, target_label } = nextBandTarget(total);
  const gap = target_total - total;

  const base: Student["route"] = {
    target: target_label,
    target_total,
    already_met: false,
    options: [],
    needs_human: false,
    unreachable_reason: null,
    causal: false,
    note_zh: ROUTE_NOTE_ZH,
    note_en: ROUTE_NOTE_EN,
  };

  if (gap <= 0) {
    // Already at/above excellent cutoff — no higher band exists.
    return { ...base, already_met: true };
  }

  // Project a new total by recomputing ONLY the varied item. The other items
  // keep their audited points; we add the weighted per-item delta (and any
  // bonus delta, capped to +10 like the engine). This avoids rescoring items
  // whose raw values sit at edges of the categorical table (e.g. BMI).
  const project = (
    item: FitnessItemId,
    rawValue: number,
  ): { total: number; points: number; bonus: number } => {
    const current = items.find((it) => it.indicator_id === item)!;
    const newPoints = scoreItem(item, sex, grade as EngineGrade, rawValue);
    const newBonus = bonusFor(item, sex, grade as EngineGrade, rawValue);
    const w = itemWeight(item) / 100;
    const pointsDelta = (newPoints - current.points) * w;
    // Bonus is added to the weighted total then capped at 10 by the engine.
    const currentBonus = items.reduce((acc, it) => acc + it.bonus, 0);
    const bonusDelta = newBonus - (current.bonus ?? 0);
    const projectedBonus = Math.min(10, currentBonus + bonusDelta);
    const bonusCapDelta = projectedBonus - Math.min(10, currentBonus);
    const projectedTotal = Math.round((total + pointsDelta + bonusCapDelta) * 10) / 10;
    return { total: projectedTotal, points: newPoints, bonus: newBonus };
  };

  let best: {
    item: FitnessItemId;
    delta: number;
    to_points: number;
    projected_total: number;
    effort_sd: number;
    reaches_band: boolean;
    gain: number;
  } | null = null;
  let bestEffort = Infinity;

  for (const item of TRAINABLE) {
    const current = items.find((it) => it.indicator_id === item);
    if (!current) continue;
    const cap = NEXT_BAND_CAP[item] ?? 0;
    const def = itemMeta(item);
    const improvesDown = def.direction === "lower_is_better";
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
    const maxSteps = Math.floor(Math.abs(cap) / Math.abs(step));

    // Walk up to the safe cap. Remember the smallest effort that reaches the
    // band; if none reaches it, keep the largest safe gain as a suggestion.
    let itemBest: {
      delta: number;
      to_points: number;
      projected_total: number;
      gain: number;
      reaches_band: boolean;
    } | null = null;

    for (let k = 1; k <= maxSteps; k++) {
      const delta = step * k;
      const trialRaw = improvesDown
        ? Math.max(1, current.raw + delta)
        : Math.max(0, current.raw + delta);
      let proj: { total: number; points: number };
      try {
        proj = project(item, trialRaw);
      } catch {
        // A trial step may land outside the printed table range; skip it.
        continue;
      }
      const gain = Math.round((proj.total - total) * 10) / 10;
      if (gain <= 0) continue;
      const newPoints = proj.points;
      const reaches = proj.total >= target_total;
      const candidate = {
        delta,
        to_points: newPoints,
        projected_total: proj.total,
        gain,
        reaches_band: reaches,
      };
      if (reaches) {
        // Smallest delta that reaches the band.
        itemBest = candidate;
        break;
      }
      // Otherwise track the largest safe gain for this item.
      if (!itemBest || gain > itemBest.gain) itemBest = candidate;
    }

    if (!itemBest) continue;
    const absEffort = Math.abs(itemBest.delta);
    // Prefer options that reach the band (smallest effort wins); among
    // non-reaching suggestions prefer the largest gain, tie-broken by effort.
    const better =
      !best ||
      (itemBest.reaches_band && !best.reaches_band) ||
      (itemBest.reaches_band === best.reaches_band &&
        itemBest.reaches_band &&
        absEffort < bestEffort) ||
      (itemBest.reaches_band === best.reaches_band &&
        !itemBest.reaches_band &&
        (itemBest.gain > best.gain ||
          (itemBest.gain === best.gain && absEffort < bestEffort)));
    if (better) {
      bestEffort = absEffort;
      best = { item, ...itemBest, effort_sd: Math.round(absEffort * 1000) / 1000 };
    }
  }

  if (!best) {
    return {
      ...base,
      needs_human: true,
      unreachable_reason:
        "No safe single-item improvement is shown; consult your PE teacher for a plan.",
    };
  }

  const change: RouteChange = {
    indicator_id: best.item,
    delta: best.delta,
    unit: itemMeta(best.item).unit,
    from_points: items.find((it) => it.indicator_id === best!.item)?.points ?? 0,
    to_points: best.to_points,
    effort_sd: best.effort_sd,
    causal: false,
  };
  const item = items.find((it) => it.indicator_id === best!.item)!;
  change.from_raw = item.raw;
  change.to_raw = projectRaw(item, change);

  base.options = [
    {
      id: best.reaches_band ? "next-band" : "next-band-suggestion",
      changes: [change],
      projected_total: best.projected_total,
      effort_estimate: "PLACEHOLDER — awaiting mentor expert rules",
      effort_is_placeholder: true,
      provenance: best.reaches_band ? "route:next-band" : "route:next-band-suggestion",
    },
  ];
  return base;
}

/**
 * The reference v0.1 hand-off ships an empty `indicators` array; the audited
 * test measurements live on `score.items`. We expose those items as `verified`
 * fitness indicators so the "Your measurements" tab has real, sourced data.
 * (Behavioural/self-report indicators are not present in the reference cohort
 * and are therefore not fabricated here.)
 */
function deriveIndicators(items: ScoreItem[]): Indicator[] {
  return items.map((it) => ({
    indicator_id: it.indicator_id,
    dimension: "fitness",
    layer: "verified",
    value: it.raw,
    unit: it.unit,
    teacher_visible: true,
    provenance: it.provenance,
  }));
}

function normalize(raw: unknown): Student {
  const s = raw as Record<string, unknown>;
  const score = s.score as Student["score"];
  const route = s.route as Student["route"];
  const progress = s.progress as Student["progress"];
  const type = s.type as Student["type"];
  const indicators = (s.indicators as Indicator[]) ?? [];
  const meta = s.meta as Student["meta"];
  const items = score.items as ScoreItem[];

  // The reference cohort ships indicators: []; derive verified fitness
  // indicators from the audited score items so measurements are never empty.
  const mergedIndicators =
    indicators.length > 0 ? indicators : deriveIndicators(items);

  const needsHuman =
    Boolean(route.needs_human) ||
    (Array.isArray(s.flags) && (s.flags as string[]).includes("needs_human"));

  const normalizedScore: Student["score"] = {
    ...score,
    band_en: bandEn(score.band),
    items,
  };

  const baseRoute: Student["route"] = {
    ...route,
    needs_human: needsHuman,
    causal: false,
    note_zh: ROUTE_NOTE_ZH,
    note_en: ROUTE_NOTE_EN,
    options: route.options.map((o) => ({
      ...o,
      causal: false as const,
      changes: o.changes.map((c) => {
        const item = items.find((it) => it.indicator_id === c.indicator_id);
        const fromRaw = item?.raw ?? 0;
        const toRaw = projectRaw(item ?? ({} as ScoreItem), c);
        return {
          ...c,
          from_raw: fromRaw,
          to_raw: toRaw,
          from_points: c.from_points,
          to_points: c.to_points,
          causal: false as const,
        };
      }),
    })),
  };

  // Students who already pass still get a non-causal suggestion toward the
  // next band (good/excellent), rather than an empty "how to improve" tab.
  const finalRoute = route.already_met
    ? buildNextBandRoute(meta.sex, meta.grade, normalizedScore.total, items)
    : baseRoute;

  return {
    schema_version: s.schema_version as string,
    student_id: s.student_id as string,
    meta,
    score: normalizedScore,
    route: finalRoute,
    progress: {
      available: progress.available ?? true,
      on_track: Boolean(progress.on_track),
      risk: (progress.risk ?? "watch") as Risk,
      pass_probability: progress.pass_probability ?? 0,
      uncertainty:
        progress.uncertainty ??
        "Projected from earlier features; a risk flag, not a forecast.",
      drivers: (progress.drivers ?? []) as Driver[],
      provenance: progress.provenance ?? "progress:flag",
      ...(progress.model_version ? { model_version: progress.model_version as string } : {}),
    },
    type: {
      segment_id: type.segment_id,
      segment_label_zh: type.segment_label_zh,
      segment_label_en: type.segment_label_en,
      weaknesses: type.weaknesses ?? [],
      provenance: type.provenance ?? "type:segment",
    },
    indicators: mergedIndicators,
    flags: (s.flags as string[]) ?? [],
    history: s.history as HistoryPoint[] | undefined,
    trajectory: s.trajectory as TrajectoryInfo | undefined,
  };
}

const STUDENTS: Student[] = (DATA.students as unknown[]).map(normalize);

// --- Teacher intake overlay -----------------------------------------------------------------
//
// Students a teacher enters by hand or uploads as a CSV. They live IN MEMORY ONLY, for the
// lifetime of the server process, and are never written to disk.
//
// That is a deliberate safety property, not a shortcut. A teacher may well type a real
// student's real measurements into this form. Persisting them would put real records into the
// repository or the deployed bundle, which AGENTS.md forbids and which scripts/check-data.mjs
// exists to prevent. Keeping intake in memory means the demo can accept real input without
// ever retaining it: restart the server and it is gone.
//
// Consequence to keep in mind: intake students disappear on restart, and in a multi-instance
// deployment they exist only on the instance that received them. Both are acceptable for a
// demo and both must be reconsidered before this becomes a real product, at which point the
// answer is a database with the same role-scoped access the API already enforces.
const INTAKE = new Map<string, Student>();

/** Build a full Student record from an intake row, scored by the real engine. */
function buildIntakeStudent(row: IntakeRow): Student {
  const scored = scoreIntakeRow(row);

  const items: ScoreItem[] = scored.items.map((it) => ({
    indicator_id: it.item,
    raw: it.raw,
    unit: it.unit,
    points: it.score,
    bonus: it.bonus,
    band: it.band,
    provenance: `measure:${it.item}`,
  }));

  const route = buildNextBandRoute(row.sex, row.grade, scored.total, items);

  return {
    schema_version: DATA.schema_version,
    student_id: row.student_id,
    meta: {
      sex: row.sex,
      grade: row.grade,
      cohort_year: row.cohort_year ?? new Date().getFullYear(),
      as_of: new Date().toISOString().slice(0, 10),
    },
    score: {
      items,
      total: scored.total,
      bonus: scored.bonus_total,
      band: scored.band,
      band_en: bandEn(scored.band),
      band_is_derived: scored.band_is_derived,
      pass: scored.pass,
      pass_threshold: DATA.pass_threshold,
      provenance: "score:total",
    },
    route,
    // No trajectory, so no prediction. The Progress Check model is fitted on four-year
    // histories; producing a risk band from a single sitting would be fabrication, so the
    // record says plainly that it is unavailable and the UI renders that instead of a number.
    progress: {
      available: false,
      on_track: false,
      risk: "watch",
      pass_probability: 0,
      uncertainty:
        "Not available: the risk model needs an earlier year's results, and this student has " +
        "one sitting only.",
      drivers: [],
      provenance: "progress:unavailable",
    },
    type: {
      segment_id: "unsegmented",
      segment_label_zh: "未分型（新录入）",
      segment_label_en: "Unsegmented (newly entered)",
      weaknesses: [],
      provenance: "type:unavailable",
    },
    indicators: deriveIndicators(items),
    flags: ["manually_entered"],
  };
}

/**
 * Add or replace intake students. Returns what was accepted, so the caller can report
 * per-row outcomes rather than a bare count.
 */
export function addIntakeStudents(rows: IntakeRow[]): {
  added: string[];
  replaced: string[];
} {
  const added: string[] = [];
  const replaced: string[] = [];
  for (const row of rows) {
    const existing = INTAKE.has(row.student_id);
    INTAKE.set(row.student_id, buildIntakeStudent(row));
    (existing ? replaced : added).push(row.student_id);
  }
  _store = null; // roster/aggregates are derived; force a rebuild
  return { added, replaced };
}

/** Forget every manually entered student. */
export function clearIntakeStudents(): number {
  const n = INTAKE.size;
  INTAKE.clear();
  _store = null;
  return n;
}

export function intakeCount(): number {
  return INTAKE.size;
}

/** Cohort students plus intake students; intake wins on an id collision. */
function allRecords(): Student[] {
  if (INTAKE.size === 0) return STUDENTS;
  const overlaid = STUDENTS.filter((s) => !INTAKE.has(s.student_id));
  return [...overlaid, ...INTAKE.values()];
}

class Store {
  readonly studentMetadata: StudentMeta[];
  readonly cohort: {
    n: number;
    cohort_aggregates: CohortResponse["aggregates"];
    segments: CohortResponse["segments"];
    trajectories: CohortResponse["trajectories"];
    progress_model: CohortResponse["progress_model"];
  };
  readonly defaultStudentId: string;

  constructor() {
    const agg = DATA.cohort_aggregates;

    this.studentMetadata = allRecords().map((s) => ({
      student_id: s.student_id,
      sex: s.meta.sex,
      total: s.score.total,
      band: s.score.band_en,
      pass: s.score.pass,
      risk: s.progress.available ? s.progress.risk : "watch",
      pass_probability: s.progress.pass_probability,
      segment_id: s.type.segment_id,
      segment_label_zh: s.type.segment_label_zh,
      segment_label_en: s.type.segment_label_en,
      flags: s.flags,
      needs_human: s.route.needs_human,
      at_risk: s.progress.risk === "at_risk",
      pass_threshold: s.score.pass_threshold,
      trajectory_id: s.trajectory?.trajectory_id,
      trajectory_label_zh: s.trajectory?.label_zh,
      trajectory_label_en: s.trajectory?.label_en,
      trajectory_slope: s.trajectory?.slope,
      trajectory_priority: s.trajectory?.is_priority ?? false,
    }));

    const segLabels = new Map<string, { zh: string; en: string }>();
    for (const s of allRecords()) {
      if (!segLabels.has(s.type.segment_id)) {
        segLabels.set(s.type.segment_id, {
          zh: s.type.segment_label_zh,
          en: s.type.segment_label_en,
        });
      }
    }
    // Group counts, enriched with each cluster's profile where the build emitted one.
    // Counts are recomputed from the live records rather than read from the build-time
    // aggregate, so a teacher's newly entered students appear in the right group.
    const liveCounts = new Map<string, number>();
    for (const s of allRecords()) {
      liveCounts.set(s.type.segment_id, (liveCounts.get(s.type.segment_id) ?? 0) + 1);
    }
    const profileById = new Map(
      (DATA.segment_profiles ?? []).map((p) => [p.segment_id, p]),
    );
    const segments = Array.from(liveCounts.entries())
      .map(([id, count]) => {
        const p = profileById.get(id);
        return {
          segment_id: id,
          segment_label_zh: p?.segment_label_zh ?? segLabels.get(id)?.zh ?? id,
          segment_label_en: p?.segment_label_en ?? segLabels.get(id)?.en ?? id,
          count,
          headroom_item: p?.headroom_item,
          relative_strength: p?.relative_strength,
          is_low_baseline: p?.is_low_baseline,
          mean_total: p?.mean_total,
          share_below_pass: p?.share_below_pass,
          mean_item_scores: p?.mean_item_scores,
        };
      })
      .sort((a, b) => (a.mean_total ?? 999) - (b.mean_total ?? 999));

    // Trajectory groups, counted from the live records so intake students are included
    // (they land in no class, and are simply absent rather than guessed into one).
    const trajCounts = new Map<string, { n: number; zh: string; en: string; priority: boolean; slopeSum: number }>();
    for (const s of allRecords()) {
      const t = s.trajectory;
      if (!t) continue;
      const cur = trajCounts.get(t.trajectory_id) ?? {
        n: 0, zh: t.label_zh, en: t.label_en, priority: t.is_priority, slopeSum: 0,
      };
      cur.n += 1;
      cur.slopeSum += t.slope;
      trajCounts.set(t.trajectory_id, cur);
    }
    const trajectories = Array.from(trajCounts.entries())
      .map(([id, v]) => ({
        trajectory_id: id,
        label_zh: v.zh,
        label_en: v.en,
        count: v.n,
        is_priority: v.priority,
        mean_slope: Math.round((v.slopeSum / v.n) * 100) / 100,
      }))
      // Priority classes first, then by steepest decline — the order a teacher triages in.
      .sort((a, b) => {
        if (a.is_priority !== b.is_priority) return a.is_priority ? -1 : 1;
        return a.mean_slope - b.mean_slope;
      });

    const bandDist = {
      excellent: agg.bands["优秀"] ?? 0,
      good: agg.bands["良好"] ?? 0,
      pass: agg.bands["及格"] ?? 0,
      fail: agg.bands["不及格"] ?? 0,
    };
    const riskDist = {
      on_track: agg.risks.on_track ?? 0,
      watch: agg.risks.watch ?? 0,
      at_risk: agg.risks.at_risk ?? 0,
    };
    const needsHuman = STUDENTS.filter((s) => s.route.needs_human).length;

    this.cohort = {
      n: agg.n,
      cohort_aggregates: {
        ...bandDist,
        ...riskDist,
        needs_human: needsHuman,
        mean_total: agg.mean_total,
        pass_rate: agg.pass_rate_model,
        at_risk_rate: agg.at_risk_rate,
        mean_pass_probability: agg.mean_pass_probability,
        bands: bandDist,
        risks: riskDist,
      },
      segments,
      trajectories,
      progress_model: {
        accuracy: DATA.progress_model.accuracy,
        auc: DATA.progress_model.auc,
        brier: DATA.progress_model.brier,
        method: DATA.progress_model.method,
        n_train: DATA.progress_model.n_train,
        n_test: DATA.progress_model.n_test,
        feature_set: DATA.progress_model.feature_set,
        target: DATA.progress_model.target,
        global_importance: DATA.progress_model.global_drivers,
        ...(DATA.progress_model.eval_grade
          ? { eval_grade: DATA.progress_model.eval_grade }
          : {}),
        ...(DATA.progress_model.horizon_years !== undefined
          ? { horizon_years: DATA.progress_model.horizon_years }
          : {}),
        ...(DATA.progress_model.split_kind
          ? { split_kind: DATA.progress_model.split_kind }
          : {}),
        ...(DATA.progress_model.log_loss !== undefined
          ? { log_loss: DATA.progress_model.log_loss }
          : {}),
        ...(DATA.progress_model.threshold_support !== undefined
          ? { threshold_support: DATA.progress_model.threshold_support }
          : {}),
        ...(DATA.progress_model.sensitivity_target !== undefined
          ? { sensitivity_target: DATA.progress_model.sensitivity_target }
          : {}),
        ...(DATA.progress_model.model_version
          ? { model_version: DATA.progress_model.model_version }
          : {}),
      },
    };

    const atRisk = STUDENTS.find(
      (s) => s.progress.risk === "at_risk" || s.route.needs_human,
    );
    this.defaultStudentId = (atRisk ?? STUDENTS[0]).student_id;
  }

  getStudent(id: string): Student | undefined {
    return INTAKE.get(id) ?? STUDENTS.find((s) => s.student_id === id);
  }

  /** Teacher view: self-report indicators are filtered at the boundary. */
  getStudentForTeacher(id: string) {
    const s = this.getStudent(id);
    if (!s) return undefined;
    const visible = s.indicators.filter((i) => i.teacher_visible);
    const hidden = s.indicators.filter((i) => !i.teacher_visible);
    return {
      ...s,
      indicators: visible,
      withheld_self_report: hidden.length
        ? {
            count: hidden.length,
            dimensions: Array.from(new Set(hidden.map((i) => i.dimension))).sort(),
          }
        : undefined,
    };
  }
}

let _store: Store | null = null;
export function getStore(): Store {
  if (!_store) _store = new Store();
  return _store;
}

export function getStudent(id: string): Student | undefined {
  return getStore().getStudent(id);
}

export function listStudentIds(): string[] {
  return allRecords().map((s) => s.student_id);
}

/** The privacy chokepoint: strip any indicator a teacher may not see raw. */
export function forTeacher(student: Student) {
  const { indicators, ...rest } = student;
  return {
    ...rest,
    indicators: indicators.filter((i) => i.teacher_visible),
  };
}

export function triageFeed() {
  return getStore().studentMetadata.slice().sort((a, b) => {
    const order = { at_risk: 0, watch: 1, on_track: 2 } as const;
    if (a.needs_human !== b.needs_human) return a.needs_human ? -1 : 1;
    if (order[a.risk] !== order[b.risk]) return order[a.risk] - order[b.risk];
    return a.total - b.total;
  });
}

export function cohortAggregates() {
  return getStore().cohort.cohort_aggregates;
}

export function progressModelInfo() {
  return getStore().cohort.progress_model;
}

export function globalImportance() {
  return DATA.progress_model.global_drivers;
}

export function allStudents(): Student[] {
  return allRecords();
}
