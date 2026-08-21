import { clearedCookie } from "@/lib/aptams/session";

// POST /api/auth/logout — clear the session cookie.
export async function POST() {
  return Response.json({ ok: true }, { headers: { "Set-Cookie": clearedCookie() } });
}
