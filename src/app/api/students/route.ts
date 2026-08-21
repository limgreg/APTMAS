import { NextRequest } from "next/server";
import { requireRole } from "@/lib/aptams/api-auth";
import { getStore } from "@/lib/aptams/store";

// GET /api/students — teacher-scoped roster. Returns triage metadata only;
// raw self-report (reported layer) is stripped at the store boundary.
export async function GET(req: NextRequest) {
  const gate = requireRole(req, "teacher");
  if (gate.response) return gate.response;

  const store = getStore();
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.toLowerCase() ?? "";
  const band = searchParams.get("band");
  const atRiskOnly = searchParams.get("at_risk") === "1";
  const needsHumanOnly = searchParams.get("needs_human") === "1";

  const rows = store.studentMetadata
    .filter((m) => (band ? m.band === band : true))
    .filter((m) => (atRiskOnly ? m.risk === "at_risk" : true))
    .filter((m) => (needsHumanOnly ? m.needs_human : true))
    .filter((m) =>
      q
        ? m.student_id.toLowerCase().includes(q) ||
          m.segment_label_zh.includes(q) ||
          m.segment_label_en.toLowerCase().includes(q)
        : true,
    );

  return Response.json({ students: rows, count: rows.length });
}
