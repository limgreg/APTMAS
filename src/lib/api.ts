import type {
  CohortResponse,
  Locale,
  Student,
  StudentMeta,
} from "./types";

export interface Session {
  role: "student" | "teacher";
  studentId: string;
  locale: Locale;
}

// Identity travels in the HttpOnly session cookie the browser sends automatically, so there
// is nothing for the client to assert. The previous version put the role in a header, which
// meant this function was the only thing standing between a student and the teacher roster.
// `credentials: "same-origin"` is the browser default for same-origin fetches; it is stated
// explicitly here because the correctness of every call below depends on the cookie going.
const REQUEST: RequestInit = {
  headers: { "Content-Type": "application/json" },
  // The app is often previewed inside Coze's cross-site iframe. "include" makes
  // the browser send the (HttpOnly, SameSite=None) session cookie on those
  // embedded API calls; with "same-origin" teammates could log in but then every
  // data call looked anonymous. Auth is still enforced server-side by the signed
  // cookie, so this does not change the trust boundary.
  credentials: "include",
  cache: "no-store",
};

export async function fetchMe(_session: Session): Promise<Student> {
  const res = await fetch("/api/students/me", REQUEST);
  if (!res.ok) throw new Error(`me failed: ${res.status}`);
  return res.json();
}

export async function fetchStudent(
  _session: Session,
  id: string,
): Promise<Student> {
  const res = await fetch(`/api/students/${id}`, REQUEST);
  if (!res.ok) throw new Error(`student failed: ${res.status}`);
  return res.json();
}

export async function fetchRoster(
  _session: Session,
  params: {
    q?: string;
    band?: string;
    at_risk?: boolean;
    needs_human?: boolean;
  } = {},
): Promise<{ students: StudentMeta[]; count: number }> {
  const usp = new URLSearchParams();
  if (params.q) usp.set("q", params.q);
  if (params.band) usp.set("band", params.band);
  if (params.at_risk) usp.set("at_risk", "1");
  if (params.needs_human) usp.set("needs_human", "1");
  const res = await fetch(`/api/students?${usp.toString()}`, REQUEST);
  if (!res.ok) throw new Error(`roster failed: ${res.status}`);
  return res.json();
}

export async function fetchCohort(
  _session: Session,
): Promise<CohortResponse> {
  const res = await fetch("/api/cohort", REQUEST);
  if (!res.ok) throw new Error(`cohort failed: ${res.status}`);
  return res.json();
}

export type ChatEvent =
  | { event: "sources"; sources: SourceInfo[] }
  | { event: "delta"; text: string }
  | { event: "sentence"; text: string; source_node_ids: string[]; kind?: string }
  | { event: "done"; grounded: boolean; groundedCount?: number }
  | { event: "error"; message: string };

export interface SourceInfo {
  id: string;
  kind: string;
  layer: "verified" | "measured" | "reported";
  summary_zh: string;
  summary_en: string;
  summary_ko?: string;
}

export async function streamChat(
  session: Session,
  message: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  onEvent: (ev: ChatEvent) => void,
): Promise<void> {
  const res = await fetch("/api/agent/chat", {
    ...REQUEST,
    method: "POST",
    body: JSON.stringify({
      message,
      history,
      // Ignored by the server for a student session; used by a teacher to name a student.
      student_id: session.role === "teacher" ? session.studentId : undefined,
      locale: session.locale,
    }),
  });
  if (!res.ok || !res.body) {
    throw new Error(`chat failed: ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const evType = /^event:\s*(.+)$/m.exec(part)?.[1]?.trim();
      const dataLine = /^data:\s*(.+)$/m.exec(part)?.[1];
      if (!evType || !dataLine) continue;
      try {
        const data = JSON.parse(dataLine);
        onEvent({ event: evType, ...data } as ChatEvent);
      } catch {
        // ignore malformed frame
      }
    }
  }
}


// --- authentication ------------------------------------------------------------------------

export interface MealAnalysis {
  food_items: string[];
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  confidence: "high" | "medium" | "low";
  disclaimer: string;
}

/** Analyze a meal photo. `dataUri` must be a data: URI; returns a neutral estimate only. */
export async function analyzeMealPhoto(
  dataUri: string,
  locale: Locale,
): Promise<MealAnalysis> {
  const res = await fetch("/api/coach/meal", {
    ...REQUEST,
    method: "POST",
    body: JSON.stringify({ imageDataUri: dataUri, locale }),
  });
  if (!res.ok) throw new Error(`meal analysis failed: ${res.status}`);
  return res.json();
}

export interface SessionInfo {
  authenticated: boolean;
  role?: "student" | "teacher";
  subject?: string;
}

/** Who am I? Drives which interface the app renders. */
export async function fetchSession(): Promise<SessionInfo> {
  const res = await fetch("/api/auth/session", REQUEST);
  if (!res.ok) return { authenticated: false };
  return res.json();
}

/** Exchange credentials for a session cookie. Resolves to null on success, else an error key. */
export async function login(
  identifier: string,
  password: string,
): Promise<{ role: "student" | "teacher"; subject: string } | null> {
  const res = await fetch("/api/auth/login", {
    ...REQUEST,
    method: "POST",
    body: JSON.stringify({ identifier, password }),
  });
  if (!res.ok) return null;
  return res.json();
}

export async function logout(): Promise<void> {
  await fetch("/api/auth/logout", { ...REQUEST, method: "POST" });
}

// --- teacher data intake -------------------------------------------------------------------

export interface IntakeRowError {
  row: number;
  student_id?: string;
  field: string;
  message: string;
}

export interface IntakeResult {
  accepted: number;
  added: string[];
  replaced: string[];
  rejected: number;
  errors: IntakeRowError[];
  total_intake: number;
}

/** Submit either a CSV file's text or a list of manual records. Teacher-only server-side. */
export async function submitIntake(
  payload: { csv: string } | { rows: Array<Record<string, string>> },
): Promise<IntakeResult> {
  const res = await fetch("/api/students/intake", {
    ...REQUEST,
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(body.error ?? `intake failed: ${res.status}`);
  }
  return res.json();
}

export async function clearIntake(): Promise<{ cleared: number }> {
  const res = await fetch("/api/students/intake", { ...REQUEST, method: "DELETE" });
  if (!res.ok) throw new Error(`clear failed: ${res.status}`);
  return res.json();
}

export const INTAKE_TEMPLATE_URL = "/api/students/intake?template=1";
