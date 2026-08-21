import { NextRequest } from "next/server";
import { authenticate } from "@/lib/aptams/credentials";
import { encodeSession, sessionCookie } from "@/lib/aptams/session";
import { jsonError } from "@/lib/aptams/api-auth";

// POST /api/auth/login — exchange demo credentials for a signed session cookie.
//
// The role is decided HERE, on the server, and sealed into the cookie. The client never gets
// to assert it. Failures return a single generic message regardless of cause so the endpoint
// cannot be used to enumerate which student ids exist.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    identifier?: string;
    password?: string;
  } | null;

  if (!body?.identifier || !body?.password) {
    return jsonError("identifier and password are required", 400);
  }

  const result = authenticate(body.identifier, body.password);
  if (!result.ok || !result.role || !result.subject) {
    return jsonError("invalid credentials", 401);
  }

  return Response.json(
    { role: result.role, subject: result.subject },
    { headers: { "Set-Cookie": sessionCookie(encodeSession(result.role, result.subject)) } },
  );
}
