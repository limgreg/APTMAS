"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  fetchCohort,
  fetchMe,
  fetchRoster,
  fetchSession,
  fetchStudent,
  login,
  logout,
  type Session,
  type SessionInfo,
} from "@/lib/api";
import type { CohortResponse, Locale, Student, StudentMeta } from "@/lib/types";
import { dict, type Dict } from "@/lib/i18n";
import { useLanguage } from "@/components/language-context";
import { CoachChat, type CoachHandle } from "@/components/coach-chat";
import { AssessmentView } from "@/components/assessment-view";
import { PlanView } from "@/components/plan-view";
import { TeacherView } from "@/components/teacher-view";
import { IntakeCard } from "@/components/intake-card";
import { AppNav, type AppView } from "@/components/app-nav";
import { cn } from "@/lib/utils";

export function Shell() {
  const { lang: locale, setLang: setLocale } = useLanguage();
  const [auth, setAuth] = useState<SessionInfo | null>(null);
  const [studentId, setStudentId] = useState<string>("");
  const [roster, setRoster] = useState<StudentMeta[]>([]);
  const [me, setMe] = useState<Student | null>(null);
  const [teacherStudent, setTeacherStudent] = useState<Student | null>(null);
  const [cohort, setCohort] = useState<CohortResponse | null>(null);
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [view, setView] = useState<AppView>("coach");
  const [loadError, setLoadError] = useState<string | null>(null);
  const tr = dict[locale];

  const coachRef = useRef<CoachHandle | null>(null);

  const role = auth?.role ?? "student";

  const session: Session = useMemo(
    () => ({ role, studentId, locale }),
    [role, studentId, locale],
  );

  useEffect(() => {
    let cancelled = false;
    fetchSession()
      .then((s) => {
        if (cancelled) return;
        setAuth(s);
        if (s.authenticated && s.role === "student" && s.subject) {
          setStudentId(s.subject);
        }
      })
      .catch(() => !cancelled && setAuth({ authenticated: false }));
    return () => {
      cancelled = true;
    };
  }, []);

  const reloadRoster = useCallback(() => {
    if (auth?.role !== "teacher") return;
    fetchRoster(session).then((r) => {
      setRoster(r.students);
      setStudentId((current) => {
        if (current) return current;
        const atRisk = r.students.find((s) => s.risk === "at_risk");
        return (atRisk ?? r.students[0])?.student_id ?? "";
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth?.role]);

  useEffect(() => {
    reloadRoster();
  }, [reloadRoster]);

  useEffect(() => {
    if (!auth?.authenticated) return;
    setLoadError(null);
    if (role === "student") {
      fetchMe(session)
        .then((s) => {
          setMe(s);
          setLoadError(null);
        })
        .catch((e) => {
          setMe(null);
          setLoadError(e instanceof Error ? e.message : "failed to load your record");
        });
      return;
    }
    fetchCohort(session).then(setCohort).catch(() => setCohort(null));
    if (studentId) {
      fetchStudent(session, studentId)
        .then((s) => {
          setTeacherStudent(s);
          setLoadError(null);
        })
        .catch((e) => {
          setTeacherStudent(null);
          setLoadError(e instanceof Error ? e.message : "failed to load this student");
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId, role, auth?.authenticated]);

  async function retryLoad() {
    setLoadError(null);
    if (role === "student") {
      fetchMe(session).then(setMe).catch((e) =>
        setLoadError(e instanceof Error ? e.message : "load failed"),
      );
    } else if (studentId) {
      fetchStudent(session, studentId).then(setTeacherStudent).catch((e) =>
        setLoadError(e instanceof Error ? e.message : "load failed"),
      );
      fetchCohort(session).then(setCohort).catch(() => setCohort(null));
    }
  }

  async function handleSignOut() {
    await logout();
    setAuth({ authenticated: false });
    setMe(null);
    setTeacherStudent(null);
    setCohort(null);
    setRoster([]);
    setStudentId("");
    setView("coach");
  }

  if (auth === null) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-sm text-muted-foreground">
        …
      </div>
    );
  }
  if (!auth.authenticated) {
    return (
      <LoginView
        locale={locale}
        onLocaleChange={setLocale}
        onSignedIn={(s) => {
          setAuth({ authenticated: true, role: s.role, subject: s.subject });
          if (s.role === "student") setStudentId(s.subject);
        }}
      />
    );
  }

  const active = role === "student" ? me : teacherStudent;
  const isTeacher = role === "teacher";
  // Teachers don't get the coach home in this build; land them on assessment.
  const effectiveView: AppView = isTeacher && view === "coach" ? "assessment" : view;

  const askCoach = (prompt: string) => {
    setView("coach");
    // Defer to next tick so the coach view mounts before we call its ref.
    requestAnimationFrame(() => coachRef.current?.ask(prompt));
  };

  return (
    <div className="relative min-h-dvh overflow-x-hidden">
      {/* Ambient background */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
        <div
          className="absolute -left-[10%] -top-[10%] h-[62%] w-[78%] rounded-full"
          style={{
            background: "radial-gradient(closest-side, rgba(200,255,61,.10), transparent)",
            filter: "blur(30px)",
            animation: "drift 22s ease-in-out infinite",
          }}
        />
        <div
          className="absolute -bottom-[12%] -right-[8%] h-[58%] w-[70%] rounded-full"
          style={{
            background: "radial-gradient(closest-side, rgba(120,180,255,.07), transparent)",
            filter: "blur(30px)",
            animation: "drift 28s ease-in-out infinite reverse",
          }}
        />
      </div>

      <TopBar
        tr={tr}
        locale={locale}
        onLocaleChange={setLocale}
        onSignOut={handleSignOut}
        isTeacher={isTeacher}
        subject={auth.subject ?? ""}
        student={active}
        onSelectStudent={isTeacher ? setStudentId : undefined}
        roster={roster}
        studentId={studentId}
      />

      {loadError && (
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-2 text-sm text-foreground">
          <span>
            {tr.loadError}
            <span className="ml-2 font-mono text-[11px] text-muted-foreground">{loadError}</span>
          </span>
          <Button variant="outline" size="sm" className="h-8 cursor-pointer" onClick={retryLoad}>
            {tr.retry}
          </Button>
        </div>
      )}

      <main className="px-0 pb-28 pt-2">
        {effectiveView === "coach" && active && (
          <CoachChat ref={coachRef} student={active} role={session.role} />
        )}
        {effectiveView === "assessment" && active && (
          <AssessmentView student={active} tr={tr} onAsk={askCoach} />
        )}
        {effectiveView === "plan" && active && (
          <PlanView student={active} tr={tr} locale={locale} onAsk={askCoach} />
        )}
        {effectiveView === "cohort" && isTeacher && active && cohort && (
          <TeacherView
            student={active}
            cohort={cohort}
            roster={roster}
            tr={tr}
            locale={locale}
            onSelect={setStudentId}
            onOpenIntake={() => setIntakeOpen(true)}
          />
        )}
      </main>

      <AppNav view={effectiveView} onChange={setView} isTeacher={isTeacher} tr={tr} />

      <Sheet open={intakeOpen} onOpenChange={setIntakeOpen}>
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 overflow-y-auto border-border-strong bg-surface-0 p-0 sm:max-w-lg"
        >
          <SheetHeader className="border-b border-hairline px-4 pb-3 pt-4 text-left">
            <SheetTitle className="font-display text-base">{tr.intakeTitle}</SheetTitle>
            <SheetDescription>{tr.intakeSubtitle}</SheetDescription>
          </SheetHeader>
          <div className="p-4">
            <IntakeCard tr={tr} onImported={reloadRoster} embedded />
          </div>
        </SheetContent>
      </Sheet>

      <footer className="pointer-events-none fixed bottom-0 left-0 right-0 -z-0 pb-1 text-center text-[10px] leading-relaxed text-muted-foreground/60">
        {tr.noWeight} · {tr.nonCausal}
      </footer>
    </div>
  );
}

function TopBar({
  tr,
  locale,
  onLocaleChange,
  onSignOut,
  isTeacher,
  subject,
  student,
  onSelectStudent,
  roster,
  studentId,
}: {
  tr: Dict;
  locale: Locale;
  onLocaleChange: (l: Locale) => void;
  onSignOut: () => void;
  isTeacher: boolean;
  subject: string;
  student: Student | null;
  onSelectStudent?: (id: string) => void;
  roster: StudentMeta[];
  studentId: string;
}) {
  const risk = student?.progress.risk;
  const riskLabel = risk ? tr[risk] : null;
  const gradeShort =
    student?.meta.grade === "g1"
      ? "Y1"
      : student?.meta.grade === "g2"
        ? "Y2"
        : student?.meta.grade === "g3"
          ? "Y3"
          : "Y4";
  const identity = isTeacher ? subject : `${student?.student_id ?? subject} · ${gradeShort}`;

  return (
    <header className="sticky top-0 z-20 border-b border-hairline bg-background/70 px-5 py-4 backdrop-blur-md sm:px-7">
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px] bg-primary font-display text-[17px] font-extrabold text-primary-foreground">
            A
          </div>
          <div className="leading-tight">
            <p className="font-display text-[16px] font-bold tracking-[0.12em]">{tr.appName}</p>
            <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
              Verified Fitness Intelligence
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!isTeacher && riskLabel && (
            <span className="hidden items-center gap-2 rounded-full border border-[#262A22] bg-surface-2 px-3 py-1.5 font-mono text-[11px] text-muted-foreground sm:inline-flex">
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  risk === "at_risk" ? "bg-warn" : risk === "watch" ? "bg-mid" : "bg-primary",
                )}
                style={risk === "at_risk" ? { animation: "pulseDot 1.8s ease-in-out infinite" } : undefined}
              />
              {riskLabel}
            </span>
          )}

          <span className="inline-flex items-center gap-2 rounded-full border border-[#262A22] bg-surface-2 px-2 py-1 font-mono text-[11px] text-foreground">
            <span
              className="h-6 w-6 rounded-full"
              style={{ background: "linear-gradient(140deg,#C8FF3D,#6E8F1F)" }}
            />
            {identity}
          </span>

          <Select value={locale} onValueChange={(v) => onLocaleChange(v as Locale)}>
            <SelectTrigger className="h-8 w-20 rounded-full border-border-strong bg-surface-2 text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="zh">中文</SelectItem>
              <SelectItem value="en">EN</SelectItem>
              <SelectItem value="ko">한국어</SelectItem>
            </SelectContent>
          </Select>

          <Button
            variant="outline"
            size="sm"
            onClick={onSignOut}
            className="h-8 rounded-full border-border-strong bg-surface-2 text-[11px]"
          >
            {tr.signOut}
          </Button>
        </div>
      </div>

      {/* Teacher student picker */}
      {isTeacher && onSelectStudent && (
        <div className="mx-auto mt-3 flex max-w-[1240px] flex-wrap items-center gap-2">
          <span className="text-[11px] text-muted-foreground">{tr.pickStudent}</span>
          <Select value={studentId} onValueChange={onSelectStudent}>
            <SelectTrigger className="h-8 w-56 rounded-full border-border-strong bg-surface-2 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {roster.slice(0, 80).map((s) => (
                <SelectItem key={s.student_id} value={s.student_id}>
                  {s.student_id} ·{" "}
                  {locale === "zh" ? s.segment_label_zh : s.segment_label_en} {s.total}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </header>
  );
}

function LoginView({
  locale,
  onLocaleChange,
  onSignedIn,
}: {
  locale: Locale;
  onLocaleChange: (l: Locale) => void;
  onSignedIn: (s: { role: "student" | "teacher"; subject: string }) => void;
}) {
  const tr = dict[locale];
  const [tab, setTab] = useState<"student" | "teacher">("student");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  function switchTab(next: "student" | "teacher") {
    setTab(next);
    setIdentifier("");
    setPassword("");
    setError(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(false);
    const result = await login(identifier, password);
    setBusy(false);
    if (!result) {
      setError(true);
      return;
    }
    onSignedIn(result);
  }

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-10">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div
          className="absolute -left-[15%] top-0 h-[60%] w-[70%] rounded-full"
          style={{
            background: "radial-gradient(closest-side, rgba(200,255,61,.10), transparent)",
            filter: "blur(30px)",
          }}
        />
      </div>
      <div className="w-full max-w-sm" style={{ animation: "rise .6s ease-out both" }}>
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px] bg-primary font-display text-[17px] font-extrabold text-primary-foreground">
              A
            </div>
            <div className="leading-tight">
              <p className="font-display text-[16px] font-bold tracking-[0.12em]">{tr.appName}</p>
              <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                Verified Fitness Intelligence
              </p>
            </div>
          </div>
          <Select value={locale} onValueChange={(v) => onLocaleChange(v as Locale)}>
            <SelectTrigger className="h-8 w-20 rounded-full border-border-strong bg-surface-2 text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="zh">中文</SelectItem>
              <SelectItem value="en">EN</SelectItem>
              <SelectItem value="ko">한국어</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="rounded-2xl border border-border bg-surface-2/80 p-6 backdrop-blur-md">
          <h1 className="font-display text-xl font-bold tracking-tight">{tr.signIn}</h1>
          <p className="mt-1 text-xs text-muted-foreground">{tr.signInSubtitle}</p>

          <div className="mt-5 flex rounded-full border border-border-strong bg-surface-0 p-1 text-xs">
            {(["student", "teacher"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => switchTab(t)}
                className={cn(
                  "flex-1 cursor-pointer rounded-full px-3 py-1.5 font-medium transition-colors duration-200",
                  tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t === "student" ? tr.student : tr.teacher}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="mt-5 space-y-3">
            <div className="space-y-1.5">
              <label htmlFor="identifier" className="text-xs font-medium">
                {tab === "student" ? tr.studentIdLabel : tr.usernameLabel}
              </label>
              <input
                id="identifier"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder={tab === "student" ? "90001" : "teacher"}
                inputMode={tab === "student" ? "numeric" : "text"}
                autoComplete="username"
                autoFocus
                className="h-10 w-full rounded-lg border border-border-strong bg-surface-0 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="password" className="text-xs font-medium">
                {tr.passwordLabel}
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className="h-10 w-full rounded-lg border border-border-strong bg-surface-0 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            {error && <p className="text-xs text-warn">{tr.signInFailed}</p>}

            <Button
              type="submit"
              disabled={busy}
              className="h-11 w-full rounded-full bg-primary font-condensed uppercase tracking-wide text-primary-foreground hover:bg-[#dcff7d]"
            >
              {busy ? "…" : tr.signIn}
            </Button>
          </form>

          <div className="mt-5 rounded-xl border border-dashed border-border-strong bg-surface-0/60 p-3">
            <p className="text-[11px] font-medium text-muted-foreground">{tr.demoCredentials}</p>
            <p className="mt-1 font-mono text-[11px] leading-relaxed text-muted-foreground">
              {tab === "student" ? (
                <>
                  90001 – 90240
                  <br />
                  aptams2026
                </>
              ) : (
                <>
                  teacher
                  <br />
                  aptams-teacher
                </>
              )}
            </p>
          </div>
        </div>

        <p className="mt-4 text-center text-[11px] leading-relaxed text-muted-foreground">
          {tr.syntheticNotice}
        </p>
      </div>
    </div>
  );
}
