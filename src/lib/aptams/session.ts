// Server-side session: the single source of truth for who is calling and what role they hold.
//
// This replaces the previous `x-aptams-role` header, which the CLIENT set. Any student could
// open devtools, send `x-aptams-role: teacher`, and receive the full roster; setting
// `x-aptams-student-id` to someone else's id returned their record. AGENTS.md is explicit
// that role scopes the API and must be enforced server-side, so the role now travels only in
// a cookie this module signs and verifies.
//
// The credentials are hardcoded demo credentials (see credentials.ts) — the USERS are fake.
// The ENFORCEMENT is not: a forged or tampered cookie fails verification and the request is
// rejected exactly as an unauthenticated one would be.

import { createHmac, timingSafeEqual } from "node:crypto";

export type Role = "student" | "teacher";

export interface Session {
  role: Role;
  /** The 5-digit student id for a student session; the teacher's username otherwise. */
  subject: string;
  /** Unix seconds. */
  issued: number;
  expires: number;
}

export const SESSION_COOKIE = "aptams_session";

/** Sessions last a working day — long enough for a demo, short enough to expire. */
const TTL_SECONDS = 12 * 60 * 60;

/**
 * The signing secret. In a real deployment this comes from the environment and rotating it
 * invalidates every session. For the demo we fall back to a fixed value so the app runs with
 * no configuration — that is safe precisely because the accounts behind it are fake, but it
 * is why this app must never hold a real student record.
 */
function secret(): Buffer {
  return Buffer.from(
    process.env.APTAMS_SESSION_SECRET ?? "aptams-demo-session-secret-not-for-production",
    "utf8",
  );
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

/** Encode a session as `<payload>.<hmac>`. */
export function encodeSession(role: Role, subject: string): string {
  const now = Math.floor(Date.now() / 1000);
  const session: Session = { role, subject, issued: now, expires: now + TTL_SECONDS };
  const payload = Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/**
 * Verify and decode a session cookie. Returns null for anything not currently valid —
 * missing, malformed, wrong signature, or expired. Callers must treat null as unauthenticated
 * and must never fall back to a default role.
 */
export function decodeSession(raw: string | undefined | null): Session | null {
  if (!raw) return null;
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return null;

  const payload = raw.slice(0, dot);
  const provided = Buffer.from(raw.slice(dot + 1), "base64url");
  const expected = Buffer.from(sign(payload), "base64url");

  // Constant-time compare; length mismatch short-circuits because timingSafeEqual throws.
  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(provided, expected)) return null;

  let session: Session;
  try {
    session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (session.role !== "student" && session.role !== "teacher") return null;
  if (typeof session.subject !== "string" || session.subject.length === 0) return null;
  if (typeof session.expires !== "number") return null;
  if (session.expires < Math.floor(Date.now() / 1000)) return null;

  return session;
}

/** The Set-Cookie value that establishes a session. HttpOnly: script must not read it. */
export function sessionCookie(value: string): string {
  // The app is routinely previewed inside Coze's IDE, where the page runs in a
  // cross-site iframe. SameSite=Lax cookies are NOT sent on the embedded
  // subrequests in that context, so after login every /api call looked
  // anonymous and the UI rendered with "no data". SameSite=None + Secure makes
  // the cookie travel in that cross-site iframe; HttpOnly is preserved so
  // script still cannot read it. Secure is only honoured over HTTPS, which the
  // deployed preview always is.
  return [
    `${SESSION_COOKIE}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=None",
    "Secure",
    `Max-Age=${TTL_SECONDS}`,
  ].join("; ");
}

/** The Set-Cookie value that clears a session. */
export function clearedCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=0`;
}
