"use client";

import { useEffect, useMemo, useState } from "react";
import { Info, Lock, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { Dict } from "@/lib/i18n";
import type { FitnessItemId, Grade, Student } from "@/lib/types";
import {
  buildStagedPlan,
  assessStage,
  scoreSelfAssessment,
  type FinalTarget,
  type StagedPlan,
} from "@/lib/aptams/stages";
import { planRoutesForTotal, type MultiRoutePlan } from "@/lib/aptams/planner";
import { cn } from "@/lib/utils";

/**
 * Plan view — performance-tech redesign.
 * A staged ladder (now -> stages -> target) with one active stage card and the
 * rest locked, plus the self-assessment flow and localStorage persistence.
 * Driven entirely by buildStagedPlan() / planRoutes() — scoring-table
 * arithmetic, never a training promise.
 */

const STORAGE_PREFIX = "aptams.staged.v1.";
function loadProgress(id: string): { completed: number; final: FinalTarget } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + id);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { completed: number; final: FinalTarget };
    if (parsed && typeof parsed.completed === "number") return parsed;
  } catch {
    /* ignore */
  }
  return null;
}
function saveProgress(id: string, completed: number, final: FinalTarget) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify({ completed, final }));
  } catch {
    /* ignore */
  }
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

function nodeColor(total: number): string {
  if (total >= 80) return "#C8FF3D";
  if (total >= 60) return "#E8C55A";
  return "#FF7A45";
}

export function PlanView({
  student,
  tr,
  locale,
  onAsk,
}: {
  student: Student;
  tr: Dict;
  locale: "zh" | "en" | "ko";
  onAsk?: (prompt: string) => void;
}) {
  const targets: FinalTarget[] = [60, 70, 80, 90];
  const stored = loadProgress(student.student_id);
  const [final, setFinal] = useState<FinalTarget>(
    stored?.final ??
      (student.score.total < 60
        ? 60
        : student.score.total < 70
          ? 70
          : student.score.total < 80
            ? 80
            : 90),
  );
  const [completed, setCompleted] = useState<number>(stored?.completed ?? 0);

  const [assessing, setAssessing] = useState(false);
  const [result, setResult] = useState<null | {
    outcome: "met" | "short" | "already";
    total: number;
    gap: number;
  }>(null);
  const [inputs, setInputs] = useState<Partial<Record<string, string>>>({});

  useEffect(() => {
    const s = loadProgress(student.student_id);
    if (s) {
      setCompleted(s.completed);
      setFinal(s.final);
    }
  }, [student.student_id]);

  const baseline = useMemo(
    () => ({
      sex: student.meta.sex,
      grade: student.meta.grade as Grade,
      total: student.score.total,
      items: student.score.items.map((it) => ({
        indicator_id: it.indicator_id as FitnessItemId,
        raw: it.raw,
        unit: it.unit,
        points: it.points,
        bonus: it.bonus,
      })),
    }),
    [student],
  );

  const plan: StagedPlan = useMemo(
    () => buildStagedPlan(baseline, final, completed),
    [baseline, final, completed],
  );

  // Routes for the active stage, used to summarise the moves on its card.
  const activeStage = plan.stages[plan.current_index];
  const activeRoutes: MultiRoutePlan | null = useMemo(() => {
    if (!activeStage) return null;
    return planRoutesForTotal(
      student.meta.sex,
      student.meta.grade as Grade,
      activeStage.from_total,
      student.score.items.map((it) => ({
        indicator_id: it.indicator_id as FitnessItemId,
        raw: it.raw,
        unit: it.unit,
        points: it.points,
        bonus: it.bonus,
      })),
      activeStage.to_total,
    );
  }, [activeStage, student]);

  const chooseFinal = (t: FinalTarget) => {
    setFinal(t);
    setCompleted(0);
    setResult(null);
    setAssessing(false);
    saveProgress(student.student_id, 0, t);
  };

  const runAssessment = () => {
    if (!activeStage) return;
    const updated: Partial<Record<FitnessItemId, number>> = {};
    for (const it of student.score.items) {
      const v = inputs[it.indicator_id];
      const n = v === undefined || v === "" ? NaN : Number(v);
      if (Number.isFinite(n)) updated[it.indicator_id as FitnessItemId] = n;
    }
    const scored = scoreSelfAssessment(
      { sex: student.meta.sex, grade: student.meta.grade as Grade },
      student.score.items.map((it) => ({
        indicator_id: it.indicator_id as FitnessItemId,
        raw: it.raw,
        unit: it.unit,
      })),
      updated,
    );
    const verdict = assessStage(plan, scored.total);
    setResult({ outcome: verdict.outcome, total: scored.total, gap: verdict.gap });
    if (verdict.outcome === "met" || verdict.outcome === "already") {
      const nextCompleted =
        verdict.outcome === "already" ? plan.stages.length : verdict.next_index;
      setCompleted(nextCompleted);
      saveProgress(student.student_id, nextCompleted, final);
    }
  };

  const moves =
    activeRoutes?.routes
      .find((r) => r.style === "balanced")
      ?.changes.map((c) => ({
        label: shortLabel(tr, c.indicator_id),
        delta: c.to_points - c.from_points,
      })) ??
    activeRoutes?.routes[0]?.changes.map((c) => ({
      label: shortLabel(tr, c.indicator_id),
      delta: c.to_points - c.from_points,
    })) ??
    [];

  const allDone = plan.already_met;

  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 pb-32 pt-8 sm:px-8">
      {/* Header */}
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4" style={{ animation: "rise .6s ease-out both" }}>
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#C8FF3D]">
            {tr.stagedTitle}
          </p>
          <h1 className="mt-2 font-display text-[34px] font-bold leading-tight tracking-[-0.02em] sm:text-[40px]">
            {Math.round(student.score.total)} → {plan.final_target}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex gap-1 rounded-full border border-[#2A2E25] bg-[#101210] p-1">
            {targets.map((t) => (
              <button
                key={t}
                onClick={() => chooseFinal(t)}
                className={cn(
                  "h-8 min-w-[44px] rounded-full px-3 font-mono text-[12px] tabular-nums transition-colors",
                  final === t
                    ? "bg-[#C8FF3D] text-[#0A0B0A]"
                    : "text-[#8C918A] hover:text-[#C8FF3D]",
                )}
              >
                {t}
              </button>
            ))}
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <button className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[#2A2E25] text-[#6F756C] hover:text-[#C8FF3D]" aria-label="info">
                <Info className="h-3.5 w-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="max-w-xs border-[#2A2E25] bg-[#101210] text-[12px] leading-relaxed text-[#B9BFB4]">
              {tr.nonCausal}
            </PopoverContent>
          </Popover>
        </div>
      </header>

      {/* Ladder */}
      <div className="mb-10 flex items-center justify-center gap-0 overflow-x-auto pb-2" style={{ animation: "rise .6s .08s ease-out both" }}>
        {plan.ladder.map((total, i) => {
          const isLast = i === plan.ladder.length - 1;
          const tag = i === 0 ? tr.startScore : isLast ? tr.targetTotal : `${tr.stage} ${i}`;
          const active = i === plan.current_index + 1 || (i === 0 && plan.current_index === 0);
          const reached = completed > 0 && i <= completed;
          return (
            <div key={i} className="flex items-center">
              <div className="flex flex-col items-center" style={{ width: 88 }}>
                <div
                  className={cn(
                    "flex h-12 w-12 items-center justify-center rounded-full border-2 font-display text-[20px] font-bold",
                  )}
                  style={{
                    borderColor: nodeColor(total),
                    color: nodeColor(total),
                    background: reached ? "rgba(200,255,61,.10)" : "transparent",
                  }}
                >
                  {reached ? <Check className="h-4 w-4" /> : Math.round(total)}
                </div>
                <span className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[#6F756C]">
                  {tag}
                </span>
              </div>
              {!isLast && (
                <div className="relative h-[2px] w-16 shrink-0 overflow-hidden rounded-full bg-[#2A2E25] sm:w-24">
                  <div
                    className="absolute inset-y-0 left-0 w-2/5 rounded-full bg-[#C8FF3D]"
                    style={{ animation: `sweep 2.6s linear ${i * 0.8}s infinite` }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {allDone ? (
        <div className="rounded-2xl border border-[rgba(200,255,61,.35)] bg-[rgba(200,255,61,.05)] p-8 text-center">
          <p className="font-display text-[22px] font-bold text-[#C8FF3D]">{tr.allDone}</p>
        </div>
      ) : (
        <>
          {/* Stage cards */}
          <div className="grid grid-cols-1 gap-[18px] md:grid-cols-3">
            {plan.stages.slice(0, 3).map((stage, i) => {
              const isActive = i === plan.current_index;
              const isLocked = i > plan.current_index;
              const isAchieved = stage.status === "achieved";
              return (
                <div
                  key={stage.index}
                  className={cn(
                    "rounded-[18px] p-[22px] transition-all duration-200",
                    isActive
                      ? "border border-[rgba(200,255,61,.35)]"
                      : "border border-[#1E211B] hover:-translate-y-1 hover:border-[#C8FF3D]",
                  )}
                  style={{
                    background: isActive
                      ? "linear-gradient(180deg,rgba(200,255,61,.07),#0C0E0C)"
                      : "#0C0E0C",
                    animation: "rise .6s ease-out both",
                    animationDelay: `${0.16 + i * 0.08}s`,
                  }}
                >
                  <div className="mb-3 flex items-center justify-between">
                    <span className="font-condensed text-[16px] font-bold uppercase tracking-[0.12em] text-foreground">
                      {tr.stage} {stage.index + 1}
                    </span>
                    <span
                      className="font-mono text-[10px] uppercase tracking-[0.1em]"
                      style={{ color: isActive ? "#C8FF3D" : isAchieved ? "#C8FF3D" : "#6F756C" }}
                    >
                      {isLocked ? (
                        <span className="inline-flex items-center gap-1"><Lock className="h-3 w-3" />{tr.locked}</span>
                      ) : isAchieved ? (
                        <span className="inline-flex items-center gap-1"><Check className="h-3 w-3" />{tr.achieved}</span>
                      ) : (
                        tr.training
                      )}
                    </span>
                  </div>

                  <h3 className="font-display text-[26px] font-bold tracking-[-0.02em] text-foreground">
                    {Math.round(stage.from_total)} → {Math.round(stage.to_total)}
                  </h3>
                  <p className="mt-2 text-[14px] leading-relaxed text-[#8C918A]">
                    {isActive
                      ? locale === "zh"
                        ? "一个区块、一次提升。先把最划算的项目推进一个评分档，覆盖本阶段目标。"
                        : locale === "ko"
                          ? "한 구간, 한 번의 향상. 가장 효율적인 항목을 한 등급 올려 단계 목표를 넘깁니다."
                          : "One block, one lift. Move the most efficient item a single band to clear this stage."
                      : locale === "zh"
                        ? "完成上一阶段后解锁。"
                        : locale === "ko"
                          ? "이전 단계를 완료하면 잠금 해제됩니다."
                          : "Unlocks after the previous stage is reached."}
                  </p>

                  {isActive && moves.length > 0 && (
                    <div className="mt-4 space-y-1.5">
                      {moves.slice(0, 4).map((m, j) => (
                        <div
                          key={j}
                          className="flex items-center justify-between rounded-[10px] bg-[rgba(255,255,255,.03)] px-3 py-2 text-[13px]"
                        >
                          <span className="text-[#D6DBD1]">{m.label}</span>
                          <span className="font-mono text-[#C8FF3D]">+{m.delta} {tr.pointsUnit}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Self assessment footer */}
          <div
            className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-2xl px-5 py-4"
            style={{ border: "1px dashed #2A2E25", background: "#0B0D0B" }}
          >
            <p className="font-display text-[15px] text-[#E6EAE1]">
              {locale === "zh"
                ? "完成本阶段训练？重新录入成绩，引擎会按评分表重新计算。"
                : locale === "ko"
                  ? "구간을 훈련했나요? 기록을 다시 입력하면 엔진이 채점표로 다시 계산합니다."
                  : "Trained the block? Re-enter your numbers and the engine re-scores you."}
            </p>
            <div className="flex items-center gap-2">
              {!assessing ? (
                <Button
                  className="h-11 rounded-full bg-[#C8FF3D] px-6 font-condensed text-[14px] font-semibold uppercase tracking-[0.08em] text-[#0A0B0A] hover:bg-[#dcff7d]"
                  onClick={() => { setAssessing(true); setResult(null); }}
                >
                  {tr.selfAssess}
                </Button>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  {student.score.items.map((it) => (
                    <Input
                      key={it.indicator_id}
                      type="number"
                      inputMode="decimal"
                      placeholder={`${shortLabel(tr, it.indicator_id)} (${it.unit})`}
                      value={inputs[it.indicator_id] ?? ""}
                      onChange={(e) => setInputs((p) => ({ ...p, [it.indicator_id]: e.target.value }))}
                      className="h-10 w-32 rounded-lg border-[#2A2E25] bg-[#101210] text-[13px]"
                    />
                  ))}
                  <Button
                    className="h-10 rounded-full bg-[#C8FF3D] px-5 font-condensed text-[13px] font-semibold uppercase tracking-[0.08em] text-[#0A0B0A] hover:bg-[#dcff7d]"
                    onClick={runAssessment}
                  >
                    {tr.beginAssess}
                  </Button>
                  <Button
                    variant="outline"
                    className="h-10 rounded-full border-[#2A2E25] text-[13px] text-[#B9BFB4] hover:text-[#C8FF3D]"
                    onClick={() => { setAssessing(false); setResult(null); }}
                  >
                    {tr.close}
                  </Button>
                </div>
              )}
            </div>
          </div>

          {result && (
            <div
              className="mt-4 rounded-2xl border p-4 text-[14px]"
              style={{
                borderColor: result.outcome === "short" ? "rgba(255,122,69,.4)" : "rgba(200,255,61,.35)",
                background: result.outcome === "short" ? "rgba(255,122,69,.06)" : "rgba(200,255,61,.05)",
                color: result.outcome === "short" ? "#FF9E75" : "#C8FF3D",
              }}
            >
              {result.outcome === "short"
                ? `${tr.stageShort} (${tr.latestScore}: ${result.total.toFixed(1)}, ${tr.gapToStage} ${result.gap.toFixed(1)})`
                : `${tr.stageMet} (${tr.latestScore}: ${result.total.toFixed(1)})`}
            </div>
          )}
        </>
      )}

      {onAsk && (
        <div className="mt-10 text-center">
          <button
            onClick={() => onAsk(locale === "zh" ? "帮我制定一个四周训练计划" : "Build me a 4-week plan")}
            className="rounded-full border border-[#2A2E25] px-5 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-[#B9BFB4] transition-colors hover:border-[#C8FF3D] hover:text-[#C8FF3D]"
          >
            {tr.askAssistant}
          </button>
        </div>
      )}
    </div>
  );
}
