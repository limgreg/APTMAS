import { NextRequest } from "next/server";
import { requireRole, jsonError } from "@/lib/aptams/api-auth";
import {
  csvTemplate,
  parseCsv,
  validateRecord,
  type IntakeRow,
  type RowError,
} from "@/lib/aptams/intake";
import { addIntakeStudents, clearIntakeStudents, intakeCount } from "@/lib/aptams/store";

export const runtime = "nodejs";

/**
 * Cap on one upload. A class is tens of rows; anything far beyond that is a mistake or an
 * attempt to exhaust memory, and intake is held in memory by design.
 */
const MAX_ROWS = 500;
const MAX_BYTES = 1_000_000;

// GET /api/students/intake — the CSV template, plus how many intake students are held.
export async function GET(req: NextRequest) {
  const gate = requireRole(req, "teacher");
  if (gate.response) return gate.response;

  const { searchParams } = new URL(req.url);
  if (searchParams.get("template") === "1") {
    return new Response(csvTemplate(), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="aptams-intake-template.csv"',
      },
    });
  }
  return Response.json({ count: intakeCount() });
}

/**
 * POST /api/students/intake — add students by hand or from a CSV.
 *
 * Teacher-only: entering another person's health measurements is a staff action, and the
 * session gate is what enforces that. Accepted rows are scored by the same engine the cohort
 * uses; rejected rows come back with a per-row reason so a teacher can fix the file rather
 * than guess. A partially valid file still imports its good rows — refusing all 40 because
 * one has a typo would be worse for the person doing the work.
 */
export async function POST(req: NextRequest) {
  const gate = requireRole(req, "teacher");
  if (gate.response) return gate.response;

  const body = (await req.json().catch(() => null)) as {
    csv?: string;
    rows?: Array<Record<string, unknown>>;
  } | null;
  if (!body) return jsonError("expected a JSON body with `csv` or `rows`", 400);

  let rows: IntakeRow[] = [];
  let errors: RowError[] = [];

  if (typeof body.csv === "string") {
    if (body.csv.length > MAX_BYTES) {
      return jsonError(`CSV too large (limit ${MAX_BYTES / 1000}kB)`, 413);
    }
    ({ rows, errors } = parseCsv(body.csv));
  } else if (Array.isArray(body.rows)) {
    body.rows.forEach((record, i) => {
      const { row, errors: rowErrors } = validateRecord(record, i + 1);
      if (row) rows.push(row);
      errors.push(...rowErrors);
    });
  } else {
    return jsonError("expected `csv` (string) or `rows` (array)", 400);
  }

  if (rows.length > MAX_ROWS) {
    return jsonError(`too many rows (${rows.length}); limit is ${MAX_ROWS}`, 413);
  }

  const { added, replaced } = addIntakeStudents(rows);

  return Response.json({
    accepted: rows.length,
    added,
    replaced,
    rejected: errors.length,
    errors,
    total_intake: intakeCount(),
  });
}

// DELETE /api/students/intake — forget every manually entered student.
export async function DELETE(req: NextRequest) {
  const gate = requireRole(req, "teacher");
  if (gate.response) return gate.response;
  return Response.json({ cleared: clearIntakeStudents() });
}
