// Teacher data intake: turn raw measurements into a scored student record.
//
// A teacher types a student's seven test results, or uploads a CSV of a whole class, and gets
// back the same scored object the precomputed cohort carries — scorecard, band, route to the
// next target — computed by the SAME engine, so an intake student and a cohort student are
// scored identically. Nothing here re-implements the standard.
//
// What intake deliberately does NOT produce: a pass probability, risk band, SHAP drivers, or a
// segment. Those come from a model fitted on four-year trajectories in the Python pipeline;
// inventing them from one sitting of measurements would be fabrication, and the UI shows
// "not available for manually entered students" instead. Only the exact, checkable half is
// offered — which is the same discipline the rest of the system runs on.

import { scoreStudent } from "./engine";
import { itemMeta } from "./tables";
import type { FitnessItemId, Grade, Sex } from "./types";

/** The seven scored items, in the order the standard prints them. */
export const INTAKE_ITEMS: readonly FitnessItemId[] = [
  "bmi",
  "vital_capacity",
  "sprint_50m",
  "standing_long_jump",
  "sit_and_reach",
  "endurance_run",
  "strength",
] as const;

/**
 * Physiologically plausible bounds. A value outside these is a data-entry error far more often
 * than a real measurement — a 50 m sprint of 0.5 s, a vital capacity of 40. Rejecting them
 * here means a typo surfaces as a clear message on the row rather than as a silently absurd
 * score, and it is the only place the app second-guesses an input.
 */
export const INTAKE_BOUNDS: Record<FitnessItemId, { min: number; max: number }> = {
  bmi: { min: 10, max: 50 },
  vital_capacity: { min: 500, max: 9000 },
  sprint_50m: { min: 5, max: 20 },
  standing_long_jump: { min: 50, max: 350 },
  sit_and_reach: { min: -30, max: 40 },
  endurance_run: { min: 100, max: 900 },
  strength: { min: 0, max: 200 },
};

/** Column aliases accepted in a CSV header, so a teacher's own export usually just works. */
const COLUMN_ALIASES: Record<string, string> = {
  // identity
  student_id: "student_id", studentid: "student_id", id: "student_id",
  学号: "student_id", 学生学号: "student_id",
  sex: "sex", gender: "sex", 性别: "sex",
  grade: "grade", year: "grade", 年级: "grade",
  // items
  bmi: "bmi", 体重指数: "bmi",
  vital_capacity: "vital_capacity", vitalcapacity: "vital_capacity", 肺活量: "vital_capacity",
  sprint_50m: "sprint_50m", sprint50m: "sprint_50m", "50m": "sprint_50m", 五十米: "sprint_50m",
  "50米跑": "sprint_50m", "50米": "sprint_50m",
  standing_long_jump: "standing_long_jump", longjump: "standing_long_jump",
  立定跳远: "standing_long_jump",
  sit_and_reach: "sit_and_reach", sitandreach: "sit_and_reach", 坐位体前屈: "sit_and_reach",
  endurance_run: "endurance_run", endurance: "endurance_run", 耐力跑: "endurance_run",
  "800m": "endurance_run", "1000m": "endurance_run",
  strength: "strength", 力量: "strength", 引体向上: "strength", 仰卧起坐: "strength",
};

const SEX_ALIASES: Record<string, Sex> = {
  male: "male", m: "male", 男: "male", 男生: "male", "1": "male",
  female: "female", f: "female", 女: "female", 女生: "female", "2": "female",
};

const GRADE_ALIASES: Record<string, Grade> = {
  g1: "g1", "1": "g1", 大一: "g1", freshman: "g1",
  g2: "g2", "2": "g2", 大二: "g2", sophomore: "g2",
  g3: "g3", "3": "g3", 大三: "g3", junior: "g3",
  g4: "g4", "4": "g4", 大四: "g4", senior: "g4",
};

export interface IntakeRow {
  student_id: string;
  sex: Sex;
  grade: Grade;
  cohort_year?: number;
  measurements: Record<FitnessItemId, number>;
}

export interface RowError {
  /** 1-based row number as the teacher sees it in their file; 0 for a manual entry. */
  row: number;
  student_id?: string;
  field: string;
  message: string;
}

export interface ParseResult {
  rows: IntakeRow[];
  errors: RowError[];
}

/** Normalise a header cell to a canonical field name, or null if unrecognised. */
function canonical(header: string): string | null {
  const key = header.trim().toLowerCase().replace(/[\s_-]/g, "");
  const direct = COLUMN_ALIASES[header.trim().toLowerCase()];
  if (direct) return direct;
  for (const [alias, field] of Object.entries(COLUMN_ALIASES)) {
    if (alias.toLowerCase().replace(/[\s_-]/g, "") === key) return field;
  }
  return null;
}

/**
 * Split one CSV line, honouring double-quoted fields (which may contain commas).
 * Deliberately minimal: intake files are simple exports, and a full CSV grammar would be more
 * surface than the feature needs.
 */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/** Coerce a parsed CSV/JSON cell to a trimmed string (numbers arrive unquoted). */
function asStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

/** Validate one already-split record into an IntakeRow, collecting every problem it has. */
export function validateRecord(
  record: Record<string, unknown>,
  rowNumber: number,
): { row?: IntakeRow; errors: RowError[] } {
  const errors: RowError[] = [];
  const id = asStr(record.student_id);

  if (!id) {
    errors.push({ row: rowNumber, field: "student_id", message: "Student id is required." });
  }

  const sex = SEX_ALIASES[asStr(record.sex).toLowerCase()];
  if (!sex) {
    errors.push({
      row: rowNumber, student_id: id, field: "sex",
      message: `Sex must be one of male/female/男/女 (got "${asStr(record.sex)}").`,
    });
  }

  const grade = GRADE_ALIASES[asStr(record.grade).toLowerCase()];
  if (!grade) {
    errors.push({
      row: rowNumber, student_id: id, field: "grade",
      message: `Grade must be g1-g4 / 大一-大四 (got "${asStr(record.grade)}").`,
    });
  }

  const measurements = {} as Record<FitnessItemId, number>;
  for (const item of INTAKE_ITEMS) {
    const rawText = asStr(record[item]);
    if (rawText === "") {
      errors.push({
        row: rowNumber, student_id: id, field: item,
        message: `${itemMeta(item).label_en} is required.`,
      });
      continue;
    }
    const value = Number(rawText);
    if (!Number.isFinite(value)) {
      errors.push({
        row: rowNumber, student_id: id, field: item,
        message: `${itemMeta(item).label_en} must be a number (got "${rawText}").`,
      });
      continue;
    }
    const bounds = INTAKE_BOUNDS[item];
    if (value < bounds.min || value > bounds.max) {
      errors.push({
        row: rowNumber, student_id: id, field: item,
        message:
          `${itemMeta(item).label_en} ${value}${itemMeta(item).unit} is outside the plausible ` +
          `range ${bounds.min}-${bounds.max}. Check for a typo or a unit mismatch.`,
      });
      continue;
    }
    measurements[item] = value;
  }

  if (errors.length > 0) return { errors };

  const yearText = asStr(record.cohort_year);
  const year = Number(yearText);
  return {
    row: {
      student_id: id,
      sex: sex!,
      grade: grade!,
      cohort_year: Number.isFinite(year) && year > 1900 ? year : undefined,
      measurements,
    },
    errors: [],
  };
}

/** Parse a CSV file into validated rows plus per-row errors. Never throws on bad input. */
export function parseCsv(text: string): ParseResult {
  const lines = text
    .replace(/^﻿/, "") // strip a BOM; Excel exports carry one
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "");

  if (lines.length === 0) {
    return { rows: [], errors: [{ row: 0, field: "file", message: "The file is empty." }] };
  }

  const headerCells = splitCsvLine(lines[0]);
  const fields = headerCells.map(canonical);

  const required = ["student_id", "sex", "grade", ...INTAKE_ITEMS];
  const missing = required.filter((f) => !fields.includes(f));
  if (missing.length > 0) {
    return {
      rows: [],
      errors: [{
        row: 1, field: "header",
        message:
          `Missing column(s): ${missing.join(", ")}. Expected a header row with ` +
          `student_id, sex, grade and the seven test items.`,
      }],
    };
  }

  const rows: IntakeRow[] = [];
  const errors: RowError[] = [];
  const seen = new Set<string>();

  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const record: Record<string, string> = {};
    fields.forEach((field, idx) => {
      if (field) record[field] = cells[idx] ?? "";
    });

    const { row, errors: rowErrors } = validateRecord(record, i + 1);
    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
      continue;
    }
    if (seen.has(row!.student_id)) {
      errors.push({
        row: i + 1, student_id: row!.student_id, field: "student_id",
        message: `Duplicate student id "${row!.student_id}" in this file.`,
      });
      continue;
    }
    seen.add(row!.student_id);
    rows.push(row!);
  }

  return { rows, errors };
}

/** Score an intake row through the real engine. Same code path as the cohort. */
export function scoreIntakeRow(row: IntakeRow) {
  return scoreStudent({
    sex: row.sex,
    grade: row.grade,
    measurements: INTAKE_ITEMS.map((item) => ({ item, value: row.measurements[item] })),
  });
}

/** A CSV template a teacher can download, fill in, and upload back. */
export function csvTemplate(): string {
  const header = ["student_id", "sex", "grade", ...INTAKE_ITEMS].join(",");
  const example = ["10001", "male", "g1", "21.5", "4100", "7.4", "230", "13.0", "245", "10"];
  const example2 = ["10002", "female", "g2", "20.1", "3000", "9.1", "168", "17.5", "238", "32"];
  return [header, example.join(","), example2.join(",")].join("\n") + "\n";
}
