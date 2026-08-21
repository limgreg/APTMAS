import { NextRequest } from "next/server";
import { requireRole } from "@/lib/aptams/api-auth";
import { getStore } from "@/lib/aptams/store";

// GET /api/students/me — the signed-in student's own full record, including self-report.
//
// The id comes from the SESSION, never from the request. That is the whole point: previously
// a caller passed `x-aptams-student-id` and could read any student's record by changing it.
// There is no way to ask this endpoint for somebody else.
export async function GET(req: NextRequest) {
  const gate = requireRole(req, "student");
  if (gate.response) return gate.response;

  const store = getStore();
  const s = store.getStudent(gate.session.subject);
  if (!s) return Response.json({ error: "student not found" }, { status: 404 });
  return Response.json(s);
}
