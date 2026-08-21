"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { Dict } from "@/lib/i18n";
import type { CohortResponse, Locale, StudentMeta } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Cohort view — performance-tech redesign (teacher surface).
 * Band distribution column chart, SHAP driver bars, KMeans cluster cards,
 * and the roster behind a slide-over. Reads CohortResponse.aggregates,
 * .segments and .progress_model.global_importance only.
 */

function driverColor(pct: number): string {
  if (pct >= 0.6) return "#C8FF3D";
  if (pct >= 0.35) return "#E8C55A";
  return "#5C6158";
}
function bandColor(band: "excellent" | "good" | "pass" | "fail"): string {
  if (band === "excellent") return "#2E332A";
  if (band === "good") return "#E8C55A";
  if (band === "pass") return "#C8FF3D";
  return "#FF7A45";
}

export function CohortView({
  cohort,
  roster,
  tr,
  locale,
  onSelect,
  onOpenIntake,
}: {
  cohort: CohortResponse;
  roster: StudentMeta[];
  tr: Dict;
  locale: Locale;
  onSelect: (id: string) => void;
  onOpenIntake: () => void;
}) {
  const bands = ["excellent", "good", "pass", "fail"] as const;
  const maxBand = Math.max(1, ...bands.map((b) => cohort.aggregates[b]));
  const supportPct = (cohort.aggregates.at_risk / cohort.n) * 100;

  const drivers = useMemo(
    () =>
      [...cohort.progress_model.global_importance].sort(
        (a, b) => b.importance - a.importance,
      ),
    [cohort],
  );
  const maxImp = Math.max(0.0001, ...drivers.map((d) => d.importance));

  const segments = cohort.segments ?? [];

  return (
    <div className="mx-auto w-full max-w-[1240px] px-4 pb-32 pt-8 sm:px-8">
      {/* Header */}
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4" style={{ animation: "rise .6s ease-out both" }}>
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#C8FF3D]">
            {tr.teacher} · {tr.cohortOverview}
          </p>
          <h1 className="mt-2 font-display text-[30px] font-bold leading-tight tracking-[-0.02em] sm:text-[40px]">
            {cohort.n} {tr.student ?? "students"}{" "}
            <span className="text-[#FF9E75]">· {supportPct.toFixed(0)}% {tr.at_risk}</span>
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[#6F756C] sm:text-[11px]">
            acc {(cohort.progress_model.accuracy * 100).toFixed(1)} · auc {(cohort.progress_model.auc * 100).toFixed(1)} · brier {cohort.progress_model.brier.toFixed(3)}
          </span>
          <Button
            className="h-10 rounded-full bg-[#C8FF3D] px-5 font-condensed text-[13px] font-semibold uppercase tracking-[0.08em] text-[#0A0B0A] hover:bg-[#dcff7d]"
            onClick={onOpenIntake}
          >
            + {tr.addData}
          </Button>
          <RosterSheet roster={roster} tr={tr} onSelect={onSelect} />
        </div>
      </header>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.15fr_1fr]">
        {/* Band distribution */}
        <section
          className="rounded-2xl border border-[#1E211B] p-6"
          style={{ background: "var(--panel-grad)", animation: "rise .7s .1s ease-out both" }}
        >
          <h2 className="mb-6 font-condensed text-[17px] font-semibold uppercase tracking-[0.1em] text-foreground">
            {tr.band ?? "Distribution"}
          </h2>
          <div className="flex items-end justify-around gap-3" style={{ height: 190 }}>
            {bands.map((b, i) => {
              const n = cohort.aggregates[b];
              const h = (n / maxBand) * 100;
              return (
                <div key={b} className="flex flex-1 flex-col items-center" style={{ animation: "rise .8s ease-out both", animationDelay: `${0.1 + i * 0.08}s` }}>
                  <span className="mb-2 font-display text-[20px] font-bold text-foreground">{n}</span>
                  <div className="flex w-full max-w-[64px] flex-1 items-end">
                    <div
                      className="w-full rounded-t-lg"
                      style={{
                        height: `${Math.max(h, 3)}%`,
                        background: bandColor(b),
                        animation: "barFill 1s cubic-bezier(.2,.8,.2,1) both",
                        animationDelay: `${0.2 + i * 0.08}s`,
                      }}
                    />
                  </div>
                  <span className="mt-2 font-condensed text-[12px] uppercase tracking-[0.1em] text-[#8C918A]">
                    {tr[b]}
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        {/* SHAP drivers */}
        <section
          className="rounded-2xl border border-[#1E211B] p-6"
          style={{ background: "var(--panel-grad)", animation: "rise .7s .18s ease-out both" }}
        >
          <h2 className="mb-5 font-condensed text-[17px] font-semibold uppercase tracking-[0.1em] text-foreground">
            {tr.globalImportance}
          </h2>
          <div className="space-y-3">
            {drivers.slice(0, 6).map((d, i) => {
              const pct = d.importance / maxImp;
              return (
                <div key={d.indicator_id} className="flex items-center gap-3">
                  <span className="w-[132px] shrink-0 truncate text-[13px] text-[#D6DBD1]">
                    {tr[d.indicator_id as keyof Dict] ?? d.indicator_id}
                  </span>
                  <div className="h-[7px] flex-1 rounded-full bg-[#15180F]">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${pct * 100}%`,
                        background: driverColor(pct),
                        animation: "barFill 1s cubic-bezier(.2,.8,.2,1) both",
                        animationDelay: `${0.2 + i * 0.08}s`,
                      }}
                    />
                  </div>
                  <span className="w-11 text-right font-mono text-[12px] tabular-nums text-[#B9BFB4]">
                    {(d.importance * 100).toFixed(0)}%
                  </span>
                </div>
              );
            })}
          </div>
          <p className="mt-5 font-mono text-[10px] uppercase tracking-[0.1em] text-[#5C6158]">
            {cohort.progress_model.method} · {cohort.progress_model.model_version ?? ""}
          </p>
        </section>
      </div>

      {/* Cluster cards */}
      <section className="mt-5">
        <h2 className="mb-3 font-condensed text-[17px] font-semibold uppercase tracking-[0.1em] text-foreground">
          {tr.segments}
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {segments.slice(0, 4).map((s, i) => {
            const label = locale === "zh" ? s.segment_label_zh : s.segment_label_en;
            const below = s.share_below_pass != null ? Math.round(s.share_below_pass * 100) : null;
            const mean = s.mean_total != null ? s.mean_total.toFixed(1) : "—";
            return (
              <button
                key={s.segment_id}
                onClick={() => onSelect(roster.find((r) => r.segment_id === s.segment_id)?.student_id ?? "")}
                className="group relative overflow-hidden rounded-2xl border border-[#1E211B] p-5 text-left transition-all duration-200 hover:-translate-y-[3px] hover:border-[#C8FF3D]"
                style={{ background: "#0E100E", animation: "rise .6s ease-out both", animationDelay: `${0.1 + i * 0.06}s` }}
              >
                <p className="font-display text-[30px] font-bold text-[#C8FF3D]">{s.count}</p>
                <p className="mt-1 font-condensed text-[15px] font-semibold uppercase tracking-[0.06em] text-foreground">
                  {label}
                </p>
                <p className="mt-2 text-[13px] leading-relaxed text-[#8C918A]">
                  {below != null ? `${below}% below gate · mean ${mean}` : `mean ${mean}`}
                </p>
                <div
                  className="absolute bottom-0 left-0 h-[5px] bg-[#C8FF3D]"
                  style={{ width: `${below ?? 50}%` }}
                />
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function RosterSheet({
  roster,
  tr,
  onSelect,
}: {
  roster: StudentMeta[];
  tr: Dict;
  onSelect: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const [atRiskOnly, setAtRiskOnly] = useState(false);
  const [open, setOpen] = useState(false);

  const filtered = roster
    .filter((s) => (atRiskOnly ? s.risk === "at_risk" : true))
    .filter(
      (s) =>
        !q ||
        s.student_id.includes(q) ||
        s.segment_label_en.toLowerCase().includes(q.toLowerCase()) ||
        s.segment_label_zh.includes(q),
    )
    .sort((a, b) => {
      if (a.needs_human !== b.needs_human) return a.needs_human ? -1 : 1;
      if (a.risk !== b.risk) {
        const order = { at_risk: 0, watch: 1, on_track: 2 } as const;
        return order[a.risk] - order[b.risk];
      }
      return a.total - b.total;
    });

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" className="h-10 rounded-full border-[#2A2E25] bg-[#101210] font-condensed text-[13px] font-semibold uppercase tracking-[0.08em] text-[#D6DBD1] hover:bg-[#15180F] hover:text-[#C8FF3D]">
          {tr.roster} · {roster.length}
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full border-[#2A2E25] bg-[#0B0C0B] p-0 text-foreground sm:max-w-md">
        <SheetHeader className="border-b border-[#1E211B] px-5 pb-4 pt-5 text-left">
          <SheetTitle className="font-condensed text-[18px] uppercase tracking-[0.08em]">{tr.roster}</SheetTitle>
        </SheetHeader>
        <div className="space-y-3 p-5">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#5C6158]" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={tr.search}
              className="h-10 rounded-lg border-[#2A2E25] bg-[#101210] pl-9 text-[14px]"
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-[#B9BFB4]">
            <input type="checkbox" checked={atRiskOnly} onChange={(e) => setAtRiskOnly(e.target.checked)} />
            {tr.atRiskOnly}
          </label>
          <div className="max-h-[60vh] space-y-1 overflow-y-auto">
            {filtered.map((s) => (
              <button
                key={s.student_id}
                onClick={() => { onSelect(s.student_id); setOpen(false); }}
                className="flex w-full items-center justify-between rounded-lg border border-transparent px-3 py-2.5 text-left transition-colors hover:border-[#2A2E25] hover:bg-[#101210]"
              >
                <div>
                  <p className="font-mono text-[13px] text-foreground">{s.student_id}</p>
                  <p className="text-[11px] text-[#6F756C]">{s.segment_label_en}</p>
                </div>
                <div className="flex items-center gap-2">
                  {s.needs_human && <span className="h-1.5 w-1.5 rounded-full bg-[#FF7A45]" />}
                  <span
                    className={cn(
                      "font-display text-[16px] font-bold",
                      s.total >= 80 ? "text-[#C8FF3D]" : s.total >= 60 ? "text-[#E8C55A]" : "text-[#FF7A45]",
                    )}
                  >
                    {s.total}
                  </span>
                </div>
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="py-6 text-center text-[13px] text-[#5C6158]">—</p>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
