"use client";

import { MessageCircle, Target, Route, Users } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import type { Dict } from "@/lib/i18n";

export type AppView = "coach" | "assessment" | "plan" | "cohort";

/**
 * Floating pill navigation (desktop) / bottom dock (mobile). Coach-first: the
 * coach is the home surface; assessment, plan, and (for teachers) cohort are
 * reached from here. The same view enum drives both layouts.
 */
export function AppNav({
  view,
  onChange,
  isTeacher,
  tr,
}: {
  view: AppView;
  onChange: (v: AppView) => void;
  isTeacher: boolean;
  tr: Dict;
}) {
  const isMobile = useIsMobile();
  const items: Array<{ id: AppView; label: string; icon: typeof MessageCircle }> = [
    { id: "coach", label: tr.coachNav ?? "Coach", icon: MessageCircle },
    { id: "assessment", label: tr.scoreNav ?? "Score", icon: Target },
    { id: "plan", label: tr.planNav ?? "Plan", icon: Route },
  ];
  if (isTeacher) {
    items.push({ id: "cohort", label: tr.cohortNav ?? "Cohort", icon: Users });
  }

  if (isMobile) {
    return (
      <nav
        className="fixed inset-x-0 bottom-0 z-30"
        style={{
          background: "linear-gradient(180deg,transparent,var(--surface-0) 32%)",
          paddingBottom: "max(env(safe-area-inset-bottom),8px)",
        }}
        aria-label="Primary"
      >
        <div className="mx-auto flex max-w-md items-stretch justify-around px-2 pb-1">
          {items.map((it) => {
            const active = view === it.id;
            const Icon = it.icon;
            return (
              <button
                key={it.id}
                type="button"
                onClick={() => onChange(it.id)}
                className="flex w-16 flex-col items-center gap-1 py-2"
                aria-current={active ? "page" : undefined}
              >
                <Icon
                  className={cn(
                    "h-[17px] w-[17px] transition-colors",
                    active ? "text-primary" : "text-[#5C6158]",
                  )}
                  strokeWidth={1.75}
                />
                <span
                  className={cn(
                    "font-condensed text-[11px] uppercase tracking-[0.1em] transition-colors",
                    active ? "text-primary" : "text-[#5C6158]",
                  )}
                >
                  {it.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    );
  }

  return (
    <nav
      className="fixed bottom-6 left-1/2 z-30 -translate-x-1/2"
      aria-label="Primary"
    >
      <div
        className="flex items-center gap-1 rounded-full border border-border-strong p-1.5 backdrop-blur-md"
        style={{ background: "rgba(12,14,12,.86)", boxShadow: "0 18px 50px -18px rgba(0,0,0,.9)" }}
      >
        {items.map((it) => {
          const active = view === it.id;
          return (
            <button
              key={it.id}
              type="button"
              onClick={() => onChange(it.id)}
              className={cn(
                "flex items-center gap-2 rounded-full px-4 py-2 text-[13px] leading-none transition-all duration-200",
                active
                  ? "bg-accent text-primary"
                  : "text-muted-foreground hover:text-primary",
              )}
              aria-current={active ? "page" : undefined}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full transition-colors",
                  active ? "bg-primary" : "bg-[#2E332A]",
                )}
              />
              {it.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
