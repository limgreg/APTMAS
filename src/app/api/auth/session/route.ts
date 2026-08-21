import { NextRequest } from "next/server";
import { getSession } from "@/lib/aptams/api-auth";

// GET /api/auth/session — who am I? Drives the UI's choice of interface.
// Returns 200 with {authenticated:false} rather than 401 so the login page is not an error.
export async function GET(req: NextRequest) {
  const session = getSession(req);
  if (!session) return Response.json({ authenticated: false });
  return Response.json({
    authenticated: true,
    role: session.role,
    subject: session.subject,
    expires: session.expires,
  });
}
