// Hardcoded demo credentials.
//
// These are deliberately fake accounts for a demo. They are kept in one file, in the clear,
// so that nobody mistakes them for a real authentication store and so they are trivial to
// change or delete when a real identity provider (SIT SSO / school account) is wired in.
//
// What is fake: the users and their passwords.
// What is NOT fake: the enforcement. Login is checked server-side, the resulting role is
// carried in a signed cookie (session.ts), and every API route derives the caller's role from
// that cookie alone. A student cannot become a teacher by editing a request.
//
// Replacing this for real: swap `authenticate()` for a call to the identity provider and
// return the same {role, subject} shape. Nothing else in the app needs to change.

import type { Role } from "./session";
import { listStudentIds } from "./store";

/** Every student signs in with their 5-digit id and this shared demo password. */
export const STUDENT_PASSWORD = "aptams2026";

/** The teacher accounts. */
export const TEACHER_ACCOUNTS: ReadonlyArray<{ username: string; password: string; name: string }> =
  [
    { username: "teacher", password: "aptams-teacher", name: "体育教师 / PE Teacher" },
    { username: "pe01", password: "aptams-teacher", name: "体育教师 / PE Teacher" },
  ];

export interface AuthResult {
  ok: boolean;
  role?: Role;
  subject?: string;
  /** Machine-readable failure reason; the UI maps it to localized copy. */
  reason?: "unknown_user" | "bad_password" | "missing_fields";
}

/**
 * Check demo credentials. Student ids are validated against the cohort so a typo produces
 * "unknown user" rather than a session for a student who does not exist.
 *
 * Note this deliberately does NOT distinguish unknown-user from bad-password in timing or in
 * the message the UI shows; the distinction is kept only for the caller's logs. With real
 * accounts, leaking which ids exist would be an enumeration weakness.
 */
export function authenticate(identifier: string, password: string): AuthResult {
  const id = identifier.trim();
  if (!id || !password) return { ok: false, reason: "missing_fields" };

  const teacher = TEACHER_ACCOUNTS.find((t) => t.username === id.toLowerCase());
  if (teacher) {
    if (password !== teacher.password) return { ok: false, reason: "bad_password" };
    return { ok: true, role: "teacher", subject: teacher.username };
  }

  if (listStudentIds().includes(id)) {
    if (password !== STUDENT_PASSWORD) return { ok: false, reason: "bad_password" };
    return { ok: true, role: "student", subject: id };
  }

  return { ok: false, reason: "unknown_user" };
}
