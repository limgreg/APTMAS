import { NextRequest } from "next/server";
import { requireRole } from "@/lib/aptams/api-auth";
import { getStore } from "@/lib/aptams/store";

// GET /api/students/[id] — teacher view of a single student. Privacy boundary:
// reported-layer indicators (mood/sleep/screen-time) are NEVER returned.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = requireRole(req, "teacher");
  if (gate.response) return gate.response;

  const { id } = await params;
  const store = getStore();
  const s = store.getStudentForTeacher(id);
  if (!s) return Response.json({ error: "student not found" }, { status: 404 });
  return Response.json(s); // store already strips reported layer for teachers
}
