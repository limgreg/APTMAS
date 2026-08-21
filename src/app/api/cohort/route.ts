import { NextRequest } from "next/server";
import { requireRole } from "@/lib/aptams/api-auth";
import { getStore } from "@/lib/aptams/store";

// GET /api/cohort — teacher-only cohort aggregates and progress-model fidelity.
export async function GET(req: NextRequest) {
  const gate = requireRole(req, "teacher");
  if (gate.response) return gate.response;

  const store = getStore();
  const c = store.cohort;
  return Response.json({
    n: store.studentMetadata.length,
    aggregates: c.cohort_aggregates,
    segments: c.segments,
    trajectories: c.trajectories,
    progress_model: c.progress_model,
  });
}
