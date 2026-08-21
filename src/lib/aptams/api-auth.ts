import { NextRequest } from "next/server";
import { SESSION_COOKIE, decodeSession, type Role, type Session } from "./session";

export type { Role, Session };

/**
 * The caller's session, or null if unauthenticated.
 *
 * This is the ONLY way an API route may learn who is calling. The previous implementation
 * read `x-aptams-role` off the request, which meant the CLIENT chose its own role: any
 * student could set `x-aptams-role: teacher` and read the whole roster, or set
 * `x-aptams-student-id` to someone else's id and read their record. AGENTS.md requires role
 * to scope the API and not merely the UI, so the role now comes from a cookie the server
 * signed and from nothing else. There is deliberately no default and no fallback — a request
 * without a verifiable session is anonymous, not a student.
 */
export function getSession(req: NextRequest): Session | null {
  return decodeSession(req.cookies.get(SESSION_COOKIE)?.value);
}

/**
 * Gate a route on a role. Returns the session, or the Response to send back:
 * 401 when nobody is signed in, 403 when the caller holds the other role.
 */
export function requireRole(
  req: NextRequest,
  role: Role,
): { session: Session; response?: never } | { session?: never; response: Response } {
  const session = getSession(req);
  if (!session) return { response: jsonError("not signed in", 401) };
  if (session.role !== role) {
    return { response: jsonError(`this endpoint is ${role}-only`, 403) };
  }
  return { session };
}

export function jsonError(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}
