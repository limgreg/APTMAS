"use client";

import { useEffect, useMemo, useState } from "react";
import { Info } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { Dict } from "@/lib/i18n";
import type { Student } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Assessment view — performance-tech redesign.
 * Left: animated score ring (count-up) with pass-line notch + gate rows.
 * Right: seven-item table with staggered bars, then a 7-axis radar and a
 * four-year trend line. Reads student.score / student.history only — all
 * numbers come from the deterministic engine, nothing is hardcoded.
 */

// points >= 80 -> lime, >= 60 -> mid, else warn (per design spec).
function pointColor(points: number): string {
  if (points >= 80) return "text-[#C8FF3D]";
  if (points >= 60) return "text-[#E8C55A]";
  return "text-[#FF7A45]";
}
function pointHex(points: number): string {
  if (points >= 80) return "#C8FF3D";
  if (points >= 60) return "#E8C55A";
  return "#FF7A45";
}

function useCountUp(target: number, durationMs = 1400, run = true): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!run) {
      setN(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const from = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      // cubic ease-out
      const eased = 1 - Math.pow(1 - t, 3);
      setN(from + (target - from) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs, run]);
  return n;
}

function shortLabel(tr: Dict, id: string): string {
  switch (id) {
    case "bmi": return "BMI";
    case "vital_capacity": return tr.itemVital;
    case "sprint_50m": return tr.itemSprint;
    case "standing_long_jump": return tr.itemJump;
    case "sit_and_reach": return tr.itemReach;
    case "endurance_run": return tr.itemEndurance;
    case "strength": return tr.itemStrength;
    default: return id;
  }
}

function axisTiny(label: string): string {
  // Very short axis tokens used on the radar: BMI LUNG 50M JUMP REACH RUN STR
  switch (label) {
    case "bmi": return "BMI";
    case "vital_capacity": return "LUNG";
    case "sprint_50m": return "50M";
    case "standing_long_jump": return "JUMP";
    case "sit_and_reach": return "REACH";
    case "endurance_run": return "RUN";
    case "strength": return "STR";
    default: return label.slice(0, 3).toUpperCase();
  }
}

function formatRaw(value: number, id: string, unit: string, showRaw: boolean): string {
  if (!showRaw) return "—";
  if (id === "bmi" || unit === "kg/m2") return value.toFixed(1);
  if (unit === "s") return value.toFixed(1);
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(1);
}

export function AssessmentView({
  student,
  tr,
  onAsk,
}: {
  student: Student;
  tr: Dict;
  onAsk?: (prompt: string) => void;
}) {
  // Remount key on student id so the entrance animations replay when switching
  // students (teacher flow), per the interaction spec.
  return <AssessmentInner key={student.student_id} student={student} tr={tr} onAsk={onAsk} />;
}

function AssessmentInner({
  student,
  tr,
  onAsk,
}: {
  student: Student;
  tr: Dict;
  onAsk?: (prompt: string) => void;
}) {
  const score = student.score;
  const passGate = score.pass_threshold; // 60
  const shown = useCountUp(score.total);

  // Ring geometry: r=120 => circumference 2*pi*120 ≈ 754.
  const R = 120;
  const C = 2 * Math.PI * R;
  const pct = Math.max(0, Math.min(100, score.total)) / 100;
  const dashOffset = C * (1 - pct);
  const arcColor = score.pass ? "#C8FF3D" : "#FF7A45";

  // Pass-line notch at 60% of the sweep, placed on the ring.
  const notchAngle = -Math.PI / 2 + Math.PI * 2 * (passGate / 100);
  const notchX = 150 + R * Math.cos(notchAngle);
  const notchY = 150 + R * Math.sin(notchAngle);

  const items = score.items;
  const labels = useMemo(
    () => items.map((it) => shortLabel(tr, it.indicator_id)),
    [items, tr],
  );
  const showRaw = true;

  // Gate rows.
  const toPass = Math.max(0, passGate - score.total);
  const toGood = Math.max(0, 80 - score.total);
  const first = student.history?.[0];
  const sinceG1 = first ? score.total - first.total : 0;

  // Radar geometry (per spec: viewBox 0 0 280 240, centre 140,118, R 84).
  const rvW = 280, rvH = 240, rcx = 140, rcy = 118, rR = 84;
  const rAngle = (i: number) => -Math.PI / 2 + (i / items.length) * Math.PI * 2;
  const rPoint = (i: number, r: number) =>
    [rcx + r * Math.cos(rAngle(i)), rcy + r * Math.sin(rAngle(i))] as const;
  const rRings = [25, 50, 75, 100];
  const rRingPath = (pctv: number) =>
    items
      .map((_, i) => {
        const [x, y] = rPoint(i, (rR * pctv) / 100);
        return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ") + " Z";
  const dataPath =
    items
      .map((it, i) => {
        const r = rR * (Math.max(0, Math.min(100, it.points)) / 100);
        const [x, y] = rPoint(i, r);
        return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ") + " Z";

  // Four-year trend: viewBox 0 0 300 168.
  const hist = student.history ?? [];
  const tVals = hist.map((h) => h.total);
  const tMin = Math.min(44, ...tVals) - 2;
  const tMax = Math.max(74, ...tVals) + 2;
  const tW = 300, tH = 168, padL = 8, padR = 8, padT = 18, padB = 26;
  const tx = (i: number) =>
    padL + (i * (tW - padL - padR)) / Math.max(1, hist.length - 1);
  const ty = (v: number) =>
    padT + (1 - (v - tMin) / (tMax - tMin)) * (tH - padT - padB);
  const trendPath = hist
    .map((h, i) => `${i === 0 ? "M" : "L"}${tx(i).toFixed(1)},${ty(h.total).toFixed(1)}`)
    .join(" ");
  const slope =
    hist.length >= 2
      ? (hist[hist.length - 1].total - hist[0].total) / (hist.length - 1)
      : 0;
  const crossings = hist.filter((h) => h.pass).length;
  const volatile = crossings > 0 && crossings < hist.length;

  const yLabel = (g: string) =>
    g === "g1" ? tr.year1 : g === "g2" ? tr.year2 : g === "g3" ? tr.year3 : tr.year4;

  return (
    <div className="mx-auto w-full max-w-[1240px] px-4 pb-32 pt-6 sm:px-8">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[300px_1fr] lg:gap-[34px]">
        {/* LEFT — score ring */}
        <section className="flex flex-col items-center" style={{ animation: "rise .6s ease-out both" }}>
          <div className="relative">
            <svg width="300" height="300" viewBox="0 0 300 300">
              <circle
                cx="150" cy="150" r={R}
                fill="none" stroke="#191C16" strokeWidth="14"
              />
              <circle
                cx="150" cy="150" r={R}
                fill="none" stroke={arcColor} strokeWidth="14" strokeLinecap="round"
                strokeDasharray={C}
                strokeDashoffset={dashOffset}
                transform="rotate(-90 150 150)"
                style={{ animation: "ringDraw 1.5s cubic-bezier(.2,.8,.2,1) both" }}
              />
              {/* pass-line notch */}
              <circle cx={notchX} cy={notchY} r="5" fill="#0B0C0B" stroke="#C8FF3D" strokeWidth="2.5" />
            </svg>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span
                className="font-display font-extrabold leading-none tracking-[-0.05em]"
                style={{ fontSize: 88, color: arcColor }}
              >
                {Math.round(shown)}
              </span>
              <span className="mt-1 font-mono text-[11px] uppercase tracking-[0.2em] text-[#8C918A]">
                / 100 · Y{student.meta.grade.slice(1)}
              </span>
              <span
                className="mt-3 rounded-full px-3 py-1 font-condensed text-[15px] font-bold uppercase tracking-[0.14em]"
                style={{
                  background: score.pass ? "rgba(200,255,61,.14)" : "rgba(255,122,69,.14)",
                  color: score.pass ? "#C8FF3D" : "#FF9E75",
                }}
              >
                {score.pass ? tr.pass : (tr.belowPass ?? `≥${passGate}`)}
              </span>
            </div>
          </div>

          <div className="mt-6 grid w-full gap-2">
            <GateRow label={tr.gateLabel.replace("{gate}", String(passGate))} value={`+${toPass.toFixed(1)}`} tone="warn" />
            <GateRow label={tr.targetGood} value={`+${toGood.toFixed(1)}`} tone="mid" />
            <GateRow label={tr.sinceG1} value={`${sinceG1 >= 0 ? "+" : ""}${sinceG1.toFixed(1)}`} tone={sinceG1 >= 0 ? "lime" : "warn"} />
          </div>
        </section>

        {/* RIGHT — items + radar + trend */}
        <section className="min-w-0">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-baseline gap-3">
              <h2 className="font-condensed text-[22px] font-semibold uppercase tracking-[0.06em] text-foreground">
                {tr.items}
              </h2>
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#6F756C]">
                ✓ {tr.verified} · GB/T 2014
              </span>
            </div>
            {onAsk && (
              <button
                onClick={() => onAsk(tr.showWeakest ?? "Show me my weakest item")}
                className="rounded-full border border-[#2A2E25] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[#B9BFB4] transition-colors hover:border-[#C8FF3D] hover:text-[#C8FF3D]"
              >
                {tr.askAssistant}
              </button>
            )}
          </div>

          <div>
            {items.map((it, i) => {
              const width = Math.max(2, it.points);
              return (
                <div
                  key={it.indicator_id}
                  className="grid grid-cols-[26px_minmax(84px,170px)_minmax(64px,96px)_1fr_64px] items-center gap-3 py-[13px] transition-colors hover:bg-[rgba(200,255,61,0.03)]"
                  style={{
                    borderTop: i === 0 ? "1px solid #171A15" : undefined,
                    borderBottom: "1px solid #171A15",
                    animation: "rise .5s ease-out both",
                    animationDelay: `${0.05 + i * 0.04}s`,
                  }}
                >
                  <span className="font-mono text-[12px] text-[#4E5449]">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="truncate text-[14px] text-[#D6DBD1]">{labels[i]}</span>
                  <span className="text-right font-mono text-[12px] tabular-nums text-[#8C918A]">
                    {formatRaw(it.raw, it.indicator_id, it.unit, showRaw)}
                    <span className="ml-0.5 text-[#5C6158]">{it.unit}</span>
                  </span>
                  <div className="h-[6px] w-full rounded-full bg-[#15180F]">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${width}%`,
                        background: pointHex(it.points),
                        animation: "barFill 1s cubic-bezier(.2,.8,.2,1) both",
                        animationDelay: `${0.2 + i * 0.07}s`,
                      }}
                    />
                  </div>
                  <span className={cn("text-right font-display text-[19px] font-bold", pointColor(it.points))}>
                    {Math.round(it.points)}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2">
            {/* PROFILE radar */}
            <div className="rounded-2xl border border-[#1E211B] p-5" style={{ background: "var(--panel-grad)" }}>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="font-condensed text-[17px] font-semibold uppercase tracking-[0.1em] text-foreground">
                  {tr.radarTitle}
                </h3>
                <InfoPopover text={tr.radarNote} />
              </div>
              <svg viewBox={`0 0 ${rvW} ${rvH}`} className="h-auto w-full" role="img" aria-label={tr.radarTitle}>
                {rRings.map((p) => (
                  <path
                    key={p}
                    d={rRingPath(p)}
                    fill="none"
                    stroke={p === 75 ? "rgba(200,255,61,.22)" : "#1D2018"}
                    strokeWidth={1}
                  />
                ))}
                {items.map((_, i) => {
                  const [x, y] = rPoint(i, rR);
                  return <line key={i} x1={rcx} y1={rcy} x2={x} y2={y} stroke="#1D2018" strokeWidth={1} />;
                })}
                <path
                  d={dataPath}
                  fill="rgba(200,255,61,.13)"
                  stroke="#C8FF3D"
                  strokeWidth={2}
                  style={{ animation: "pathDraw 1.8s cubic-bezier(.3,.7,.3,1) both" }}
                />
                {items.map((it, i) => {
                  const [x, y] = rPoint(i, rR * (Math.max(0, Math.min(100, it.points)) / 100));
                  return (
                    <circle
                      key={it.indicator_id}
                      cx={x} cy={y} r={3.2}
                      fill={pointHex(it.points)}
                      style={{ animation: "popIn .4s both", animationDelay: `${0.9 + i * 0.07}s` }}
                    />
                  );
                })}
                {items.map((it, i) => {
                  const [x, y] = rPoint(i, rR + 14);
                  return (
                    <text
                      key={it.indicator_id}
                      x={x} y={y}
                      textAnchor="middle" dominantBaseline="middle"
                      className="fill-[#8C918A] font-mono"
                      style={{ fontSize: 9.5, letterSpacing: "0.1em" }}
                    >
                      {axisTiny(it.indicator_id)}
                    </text>
                  );
                })}
              </svg>
            </div>

            {/* FOUR YEARS trend */}
            <div className="rounded-2xl border border-[#1E211B] p-5" style={{ background: "var(--panel-grad)" }}>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="font-condensed text-[17px] font-semibold uppercase tracking-[0.1em] text-foreground">
                  {tr.trendMetric}
                </h3>
                <span className={cn("font-mono text-[11px]", slope < 0 ? "text-[#FF7A45]" : "text-[#C8FF3D]")}>
                  {slope >= 0 ? "+" : ""}{slope.toFixed(2)} {tr.pointsUnit}/{tr.yearShort.replace("{year}", "")}
                </span>
              </div>
              <svg viewBox={`0 0 ${tW} ${tH}`} className="h-auto w-full" role="img">
                {/* pass line */}
                <line
                  x1={padL} x2={tW - padR} y1={ty(passGate)} y2={ty(passGate)}
                  stroke="rgba(200,255,61,.35)" strokeWidth={1.2} strokeDasharray="4 5"
                />
                <text x={tW - padR} y={ty(passGate) - 5} textAnchor="end"
                  className="fill-[#8C918A] font-mono" style={{ fontSize: 9.5, letterSpacing: "0.1em" }}>
                  PASS {passGate}
                </text>
                {hist.length > 1 && (
                  <path d={trendPath} fill="none" stroke="#C8FF3D" strokeWidth={2}
                    style={{ animation: "pathDraw 1.6s .2s both" }} />
                )}
                {hist.map((h, i) => {
                  const above = h.total >= passGate;
                  const isLast = i === hist.length - 1;
                  return (
                    <g key={h.grade} style={{ animation: "popIn .4s both", animationDelay: `${0.5 + i * 0.22}s` }}>
                      <circle
                        cx={tx(i)} cy={ty(h.total)} r={isLast ? 5 : 3.6}
                        fill={above ? "#C8FF3D" : "#FF7A45"}
                        stroke="#0B0D0B" strokeWidth={2}
                      />
                      <text x={tx(i)} y={ty(h.total) - 11} textAnchor="middle"
                        className="fill-[#E6EAE1] font-display font-bold" style={{ fontSize: 11 }}>
                        {h.total.toFixed(1)}
                      </text>
                      <text x={tx(i)} y={tH - 8} textAnchor="middle"
                        className={cn("font-mono", h.grade === student.meta.grade ? "fill-[#E6EAE1]" : "fill-[#5C6158]")}
                        style={{ fontSize: 9.5, letterSpacing: "0.1em" }}>
                        {yLabel(h.grade).replace("大", "Y")}
                      </text>
                    </g>
                  );
                })}
              </svg>
              {volatile && (
                <p className="mt-1 text-[12px] leading-relaxed text-[#6F756C]">
                  {tr.volatileNote ?? "Crossed the pass line — direction is less settled than the label suggests."}
                </p>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function GateRow({ label, value, tone }: { label: string; value: string; tone: "lime" | "mid" | "warn" }) {
  const color = tone === "lime" ? "#C8FF3D" : tone === "mid" ? "#E8C55A" : "#FF7A45";
  return (
    <div
      className="flex items-center justify-between rounded-xl px-3 py-[11px] text-[13px]"
      style={{ border: "1px solid #1E211B", background: "#0E100E" }}
    >
      <span className="text-[#B9BFB4]">{label}</span>
      <span className="font-mono font-semibold tabular-nums" style={{ color }}>{value}</span>
    </div>
  );
}

function InfoPopover({ text }: { text: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[#6F756C] transition-colors hover:text-[#C8FF3D]"
          aria-label="more info"
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="max-w-xs border-[#2A2E25] bg-[#101210] text-[12px] leading-relaxed text-[#B9BFB4]">
        {text}
      </PopoverContent>
    </Popover>
  );
}
