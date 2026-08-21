// Provenance-locked agent core (port of aptams/agent/provenance.py).
//
// The agent receives a StructuredContext: a closed set of provenance-bearing
// nodes built from the deterministic layers + retrieved guideline clauses.
// It gets NO raw records. Every output sentence must cite a source node that
// exists in the context; validateGrounding() rejects anything that does not.
// Safety guardrails (weight-loss refusal, escalation, no ranking) are enforced
// structurally in buildSystemPrompt() and the safety classifier, not merely
// requested of the model.

import type { Student, Indicator } from "./store";
import { retrieveGuidelines, GUIDELINES, type GuidelineClause } from "./guidelines";
import { getTrainingItem } from "./training-kb";

export type Locale = "zh" | "en" | "ko";

// Chinese/English keywords used to detect which test item a free-text question
// is about, so the matching training-KB node can be included for grounding.
const TRAINING_ITEM_KEYS: Array<{ id: string; zh: string; en: string }> = [
  { id: "sprint_50m", zh: "50米", en: "sprint" },
  { id: "endurance_run", zh: "耐力跑", en: "endurance" },
  { id: "endurance_run", zh: "1000米", en: "1000m" },
  { id: "endurance_run", zh: "800米", en: "800m" },
  { id: "standing_long_jump", zh: "跳远", en: "jump" },
  { id: "sit_and_reach", zh: "体前屈", en: "reach" },
  { id: "sit_and_reach", zh: "柔韧", en: "flexib" },
  { id: "strength", zh: "引体", en: "pull" },
  { id: "strength", zh: "仰卧起坐", en: "sit-up" },
  { id: "strength", zh: "力量", en: "strength" },
  { id: "vital_capacity", zh: "肺活量", en: "vital" },
];

export interface ContextNode {
  node_id: string;
  kind:
    | "score"
    | "counterfactual"
    | "progress"
    | "type"
    | "indicator"
    | "guideline"
    | "flag";
  summary_zh: string;
  summary_en: string;
  summary_ko?: string;
  layer: "verified" | "measured" | "reported";
}

export interface StructuredContext {
  student_id: string;
  role: "student" | "teacher";
  nodes: ContextNode[];
  guideline_clauses: ContextNode[];
  safety: {
    needs_human: boolean;
    at_risk: boolean;
    reported_concern: boolean;
  };
}

export interface ProvenancedSentence {
  text: string;
  source_node_ids: string[];
  kind?: "fact" | "guideline" | "escalation" | "refusal";
}

// ---------- safety: detect unsafe user intents ----------------------------

const UNSAFE_PATTERNS: Array<{ id: string; re: RegExp }> = [
  {
    id: "weight_loss",
    re: /(lose\s*weight|weight\s*loss|calori|节食|减肥|瘦|减脂|热量|卡路里|催吐|禁食|断食)/i,
  },
  {
    id: "train_through_pain",
    re: /(knee\s*pain|hurt|injur|疼|痛|受伤|拉伤|扭伤|带伤|坚持跑)/i,
  },
  {
    id: "ranking",
    re: /(rank|leaderboard|compare.*class|排名|排行榜|比别人|第几名|同学比)/i,
  },
  {
    id: "diagnosis",
    re: /(diagnos|disease|anorexia|bulimia|诊断|疾病|厌食症|抑郁症)/i,
  },
  {
    id: "cheating",
    re: /(代跑|替考|代测|作弊|fake\s*test|cheat\s*(on|the)\s*(test|exam)|have\s*someone\s*else|substitute\s*runner|找人替)/i,
  },
];

export interface SafetyCheck {
  unsafe: boolean;
  category: string | null;
  refusal: ProvenancedSentence | null;
}

export function safetyCheck(userText: string, locale: Locale): SafetyCheck {
  for (const p of UNSAFE_PATTERNS) {
    if (p.re.test(userText)) {
      const text = refusalText(p.id, locale);
      return {
        unsafe: true,
        category: p.id,
        refusal: {
          text,
          source_node_ids: ["guideline:aptams:escalation"],
          kind:
            p.id === "ranking" || p.id === "cheating" ? "refusal" : "escalation",
        },
      };
    }
  }
  return { unsafe: false, category: null, refusal: null };
}

function refusalText(id: string, locale: Locale): string {
  if (locale === "zh") {
    switch (id) {
      case "weight_loss":
        return "我不提供减重、热量缺口或饮食限制方面的建议——本系统关注的是体能与健康，而非体重目标。体成分数据仅作解释性参考。如果你对身体状况有顾虑，建议咨询校医或专业健康人员。";
      case "train_through_pain":
        return "如果你在运动中感到疼痛，不应继续训练。请停止相关练习，并向体育老师或校医说明情况。";
      case "ranking":
        return "我不会显示同学排名或排行榜。这里只关注你自身的进展和方向。";
      case "cheating":
        return "我不能协助代跑、替考或任何形式的体测作弊，这既违反考试规定也有安全风险。如果担心某项成绩，我可以帮你分析提分路径或建议找体育老师指导。";
      default:
        return "这个问题超出了体能评估的范围，我不作临床诊断；如有需要请咨询校医或健康专业人员。";
    }
  }
  if (locale === "ko") {
    switch (id) {
      case "weight_loss":
        return "체중 감량, 칼로리 적자, 식이 제한에 관한 조언은 하지 않습니다. 이 시스템은 체중 목표가 아니라 체력과 건강에 초점을 맞춥니다. 신체 구성 데이터는 설명용으로만 참고하세요. 몸 상태에 대한 우려가 있다면 보건 교사나 전문가와 상담하시기 바랍니다.";
      case "train_through_pain":
        return "운동 중 통증을 느끼면 계속 훈련해서는 안 됩니다. 해당 동작을 멈추고 체육 교사나 보건 교사에게 알리세요.";
      case "ranking":
        return "학생 간 순위나 리더보드를 보여주지 않습니다. 여기서는 오직 본인의 진행과 방향만 다룹니다.";
      case "cheating":
        return "대리 달리기, 대리 시험 등 어떤 형태의 체력 측정 부정 행위도 도울 수 없습니다. 이는 규정 위반이자 안전 위험입니다. 특정 종목이 걱정된다면 점수 향상 경로를 분석하거나 체육 교사의 지도를 권유해 드릴 수 있습니다.";
      default:
        return "이 질문은 체력 평가 범위를 벗어나며 임상 진단을 하지 않습니다. 필요하면 보건 교사나 건강 전문가와 상담하세요.";
    }
  }
  switch (id) {
    case "weight_loss":
      return "I don't give weight-loss, caloric-deficit, or restriction advice — this system focuses on fitness and health, not weight targets. Body-composition data is explanatory only. For concerns about your body, please speak to a health professional.";
    case "train_through_pain":
      return "If you feel pain during exercise, don't train through it. Stop the activity and speak to a PE teacher or clinician.";
    case "ranking":
      return "I don't show class rankings or leaderboards. The focus here is only on your own progress.";
    case "cheating":
      return "I can't help with substitute running, proxy testing, or any form of cheating on the fitness test — it violates the rules and is a safety risk. If you're worried about an item, I can help analyze a score-improvement path or suggest talking to your PE teacher.";
    default:
      return "That's outside a fitness assessment and I don't diagnose clinically — please consult a health professional if needed.";
  }
}

// ---------- context assembly ----------------------------------------------

// Human-readable labels for the seven national-test items used in node text.
// The agent replies in the requested locale; when only zh/en node bodies
// exist (e.g. the score nodes), the model is asked to translate while citing.
const ITEM_LABELS: Record<string, { zh: string; en: string; ko: string }> = {
  bmi: { zh: "BMI", en: "BMI", ko: "BMI" },
  vital_capacity: { zh: "肺活量", en: "vital capacity", ko: "폐활량" },
  sit_and_reach: {
    zh: "坐位体前屈",
    en: "sit-and-reach",
    ko: "윗몸 앞으로 굽히기",
  },
  standing_long_jump: {
    zh: "立定跳远",
    en: "standing long jump",
    ko: "제자리멀리뛰기",
  },
  sprint_50m: { zh: "50米跑", en: "50m sprint", ko: "50m 달리기" },
  pull_up_crunch: {
    zh: "引体/仰卧",
    en: "pull-ups/crunches",
    ko: "턱걸이/윗몸일으키기",
  },
  endurance_run: {
    zh: "耐力跑",
    en: "endurance run",
    ko: "지구력 달리기",
  },
};

function indicatorNode(ind: Indicator): ContextNode {
  const layer = ind.layer;
  const displayValue =
    typeof ind.value === "number"
      ? ind.unit === "kg/m2" || ind.unit === "%"
        ? ind.value.toFixed(2)
        : ind.unit === "s"
          ? ind.value.toFixed(1)
          : Number.isInteger(ind.value)
            ? String(ind.value)
            : ind.value.toFixed(1)
      : String(ind.value);
  const ref =
    ind.reference && (ind.reference.who_min || ind.reference.who_max)
      ? ` (WHO ref: ${[ind.reference.who_min, ind.reference.who_max]
          .filter(Boolean)
          .join("–")})`
      : "";
  return {
    node_id: ind.provenance,
    kind: "indicator",
    summary_zh: `${ind.indicator_id}: ${displayValue}${ind.unit ?? ""}${ref}`,
    summary_en: `${ind.indicator_id}: ${displayValue}${ind.unit ?? ""}${ref}`,
    summary_ko: `${ind.indicator_id}: ${displayValue}${ind.unit ?? ""}${ref}`,
    layer,
  };
}

function itemRaw(student: Student, id: string): number | null {
  return student.score.items.find((x) => x.indicator_id === id)?.raw ?? null;
}

export function buildContext(
  student: Student,
  role: "student" | "teacher",
  query?: string,
  locale: Locale = "zh",
): StructuredContext {
  // Privacy boundary: teachers only receive teacher_visible indicators.
  const indicators =
    role === "teacher"
      ? student.indicators.filter((i) => i.teacher_visible)
      : student.indicators;

  const nodes: ContextNode[] = [];

  const itemLabel = (id: string): string =>
    ITEM_LABELS[id]?.[locale] ?? ITEM_LABELS[id]?.en ?? id;

  // Score (verified)
  nodes.push({
    node_id: "score:total",
    kind: "score",
    summary_zh: `当前体测总分 ${student.score.total}，等级 ${student.score.band}${student.score.pass ? "（已达到通过线 60）" : "（未达到通过线 60）"}`,
    summary_en: `Current total score ${student.score.total}, band ${student.score.band_en}${student.score.pass ? " (passes the 60 gate)" : " (below the 60 pass gate)"}.`,
    summary_ko: `현재 체력 총점 ${student.score.total}, 등급 ${student.score.band_en}${student.score.pass ? " (통과선 60 도달)" : " (통과선 60 미달)"}.`,
    layer: "verified",
  });
  for (const it of student.score.items) {
    // Round raw measurements for LLM-facing prose (BMI etc. carry many
    // decimals from the panel); item points stay exact for verification.
    const rawDisplay =
      it.unit === "kg/m2" || it.unit === "%"
        ? it.raw.toFixed(2)
        : it.unit === "s"
          ? it.raw.toFixed(1)
          : Number.isInteger(it.raw)
            ? String(it.raw)
            : it.raw.toFixed(1);
    nodes.push({
      node_id: it.provenance,
      kind: "score",
      summary_zh: `${it.indicator_id}: 原始 ${rawDisplay}${it.unit}，单项得分 ${it.points}${it.bonus ? `，附加 ${it.bonus}` : ""}`,
      summary_en: `${it.indicator_id}: raw ${rawDisplay} ${it.unit}, item score ${it.points}${it.bonus ? `, bonus ${it.bonus}` : ""}.`,
      summary_ko: `${it.indicator_id}: 원시값 ${rawDisplay}${it.unit}, 항목 점수 ${it.points}${it.bonus ? `, 가산 ${it.bonus}` : ""}.`,
      layer: "verified",
    });
  }

  // Yearly history (verified). The dashboard shows g1-g4 sittings; expose the
  // same numbers to the agent so it can answer "how did I do last year /
  // since grade 1" rather than claiming it has no access. Each year is its own
  // provenance node (history:<grade>). Teachers never see withheld self-report
  // fields, but yearly totals and item points are verified test results.
  if (student.history && student.history.length > 0) {
    const gradeZh: Record<string, string> = {
      g1: "大一",
      g2: "大二",
      g3: "大三",
      g4: "大四",
    };
    const gradeEn: Record<string, string> = {
      g1: "grade 1",
      g2: "grade 2",
      g3: "grade 3",
      g4: "grade 4",
    };
    for (const h of student.history) {
      const itemBits = Object.entries(h.items)
        .map(([k, v]) => `${k} ${v}`)
        .join("，");
      nodes.push({
        node_id: `history:${h.grade}`,
        kind: "score",
        summary_zh: `${gradeZh[h.grade] ?? h.grade}体测：总分 ${h.total}，等级 ${h.band}${h.pass ? "（通过）" : "（未通过）"}。各项得分：${itemBits}。`,
        summary_en: `${gradeEn[h.grade] ?? h.grade} fitness test: total ${h.total}, band ${h.band}${h.pass ? " (pass)" : " (fail)"}. Item scores: ${Object.entries(h.items).map(([k, v]) => `${k} ${v}`).join("; ")}.`,
        summary_ko: `${gradeEn[h.grade] ?? h.grade}: 총점 ${h.total}, 등급 ${h.band}${h.pass ? " (통과)" : " (미통과)"}.`,
        layer: "verified",
      });
    }
    // Multi-year trend (arithmetic over the verified sittings, non-causal).
    const first = student.history[0];
    const last = student.history[student.history.length - 1];
    if (first && last && first.grade !== last.grade) {
      const delta = Math.round((last.total - first.total) * 10) / 10;
      const dirZh = delta >= 0 ? `提高了 ${delta} 分` : `回落了 ${Math.abs(delta)} 分`;
      const dirEn = delta >= 0 ? `up ${delta} points` : `down ${Math.abs(delta)} points`;
      nodes.push({
        node_id: "history:trend",
        kind: "score",
        summary_zh: `从${gradeZh[first.grade] ?? first.grade}到${gradeZh[last.grade] ?? last.grade}，总分${dirZh}（历年实测，非预测）。`,
        summary_en: `From ${gradeEn[first.grade] ?? first.grade} to ${gradeEn[last.grade] ?? last.grade}, the total moved ${dirEn} (measured history, not a prediction).`,
        summary_ko: `${gradeEn[first.grade] ?? first.grade}→${gradeEn[last.grade] ?? last.grade} 총점 ${dirEn.replace("up", "+").replace("down", "-")} (실측 기록).`,
        layer: "verified",
      });
    }
  }

  // Progress Check (measured/predicted)
  if (student.progress.available) {
    const pct = Math.round(student.progress.pass_probability * 100);
    nodes.push({
      node_id: student.progress.provenance,
      kind: "progress",
      summary_zh:
        student.progress.risk === "at_risk"
          ? `按大一数据预测，达到奖学金/毕业通过标准的概率约为 ${pct}%，属于需关注（风险标记，非定论）。`
          : `预测通过概率约为 ${pct}%（${student.progress.risk}）。`,
      summary_en: `Predicted pass probability ~${pct}% (${student.progress.risk}); a risk flag projected from g1 features, not a forecast. Uncertainty: ${student.progress.uncertainty}`,
      summary_ko: `예측 통과 확률 ~${pct}% (${student.progress.risk}). 1학년 특성에서 투사된 위험 표시이며 예측이 아닙니다. 불확실성: ${student.progress.uncertainty}`,
      layer: "measured",
    });
    for (const d of student.progress.drivers) {
      const strengthPct = Math.round(d.strength * 100);
      const dirZh = d.direction === "lowers" ? "拖低" : "利好";
      const dirEn = d.direction === "lowers" ? "lowers" : "supports";
      const dirKo = d.direction === "lowers" ? "낮춤" : "도움";
      // Canonical driver node (id matches the hand-off driver_provenance).
      nodes.push({
        node_id: d.driver_provenance,
        kind: "progress",
        summary_zh: `${itemLabel(d.indicator_id)} 是影响通过预测的因素之一（${dirZh}，${d.method}，强度约 ${strengthPct}%）。`,
        summary_en: `${itemLabel(d.indicator_id)} is a driver of the pass prediction (${dirEn}, ${d.method}, magnitude ~${strengthPct}%). ${d.explanation}`,
        summary_ko: `${itemLabel(d.indicator_id)}은(는) 통과 예측의 영향 요인입니다 (${dirKo}, ${d.method}, 크기 ~${strengthPct}%). ${d.explanation}`,
        layer: "measured",
      });
      // Distinct measured-contribution node for the local attribution value.
      nodes.push({
        node_id: d.provenance,
        kind: "progress",
        summary_zh: `${itemLabel(d.indicator_id)} 对该生通过概率的局部 SHAP 贡献约为 ${d.shap >= 0 ? "+" : ""}${d.shap.toFixed(3)}。`,
        summary_en: `Local ${d.method} contribution of ${itemLabel(d.indicator_id)} to this student's pass probability is ${d.shap >= 0 ? "+" : ""}${d.shap.toFixed(3)} log-odds.`,
        summary_ko: `${itemLabel(d.indicator_id)}이(가) 이 학생의 통과 확률에 미치는 지역 ${d.method} 기여는 ${d.shap >= 0 ? "+" : ""}${d.shap.toFixed(3)} log-odds.`,
        layer: "measured",
      });
    }
  }

  // Type
  const weaknessZh = student.type.weaknesses.join("、") || "无明显单项短板";
  const weaknessEn = student.type.weaknesses.join(", ") || "none marked";
  nodes.push({
    node_id: student.type.provenance,
    kind: "type",
    summary_zh: `学生类型：${student.type.segment_label_zh}（薄弱项：${weaknessZh}）`,
    summary_en: `Student type: ${student.type.segment_label_en} (weaknesses: ${weaknessEn})`,
    summary_ko: `학생 유형: ${student.type.segment_label_en} (약점: ${weaknessEn})`,
    layer: "measured",
  });

  // Counterfactual (verified arithmetic, non-causal)
  if (student.route.options.length > 0) {
    for (const opt of student.route.options.slice(0, 3)) {
      const desc = opt.changes
        .map((c) => {
          const isBody = c.unit === "kg/m2" || c.unit === "%";
          const dp = isBody ? 2 : 1;
          const fromRawNum =
            c.from_raw !== undefined
              ? c.from_raw
              : itemRaw(student, c.indicator_id) ?? 0;
          const toRawNum =
            c.to_raw !== undefined ? c.to_raw : fromRawNum;
          const fromRaw = fromRawNum.toFixed(dp);
          const toRaw = toRawNum.toFixed(dp);
          return `${c.indicator_id} ${fromRaw}→${toRaw}${c.unit} (score ${c.from_points}→${c.to_points})`;
        })
        .join("; ");
      const effortZh = opt.effort_is_placeholder ? "努力度为占位" : "努力度估算";
      nodes.push({
        node_id: opt.provenance,
        kind: "counterfactual",
        summary_zh: `一条达到目标的路径：${desc}，推演总分约 ${opt.projected_total}（非因果承诺，${effortZh}）。`,
        summary_en: `One route to target: ${desc}; projected total ${opt.projected_total}. Non-causal — routes are table arithmetic, not a promise that training produces the gain.`,
        summary_ko: `목표 도달 경로: ${desc}; 예상 총점 ${opt.projected_total}. 비인과적 — 경로는 채점표 산술이며 훈련 효과를 보장하지 않습니다.`,
        layer: "verified",
      });
    }
  } else if (student.route.already_met) {
    nodes.push({
      node_id: "route:primary",
      kind: "counterfactual",
      summary_zh: "当前成绩已达到该目标，无需额外推演路径。",
      summary_en: "Current score already meets the target; no route needed.",
      summary_ko: "현재 성적이 이미 목표에 도달해 추가 경로가 필요 없습니다.",
      layer: "verified",
    });
  }
  if (student.route.needs_human) {
    nodes.push({
      node_id: "route:needs_human",
      kind: "counterfactual",
      summary_zh:
        student.route.unreachable_reason ??
        "在安全上限内没有可自动给出的路径，建议由体育老师人工评估。",
      summary_en:
        student.route.unreachable_reason ??
        "No safe automatic route exists; escalate to a PE teacher.",
      summary_ko:
        "안전 한계 내에서 자동으로 제시할 경로가 없습니다. 체육 교사의 대면 평가를 권장합니다.",
      layer: "verified",
    });
  }

  // Indicators (privacy-filtered)
  for (const ind of indicators) {
    nodes.push(indicatorNode(ind));
  }

  // Training knowledge base (verified, evidence-cited drill advice). We
  // surface the two lowest-scoring items and any item named in the query, so
  // coaching answers ground their advice in a real node. BMI is included only
  // as a non-actionable safety note; it never recommends weight loss.
  const scoredItems = student.score.items
    .filter((it) => it.indicator_id !== "bmi" || it.points < 80)
    .map((it) => ({
      id: it.indicator_id,
      points: it.points,
    }))
    .sort((a, b) => a.points - b.points);
  const focusIds = new Set<string>();
  for (const it of scoredItems.slice(0, 2)) focusIds.add(it.id);
  if (query) {
    for (const item of TRAINING_ITEM_KEYS) {
      if (query.includes(item.zh) || query.toLowerCase().includes(item.en)) {
        focusIds.add(item.id);
      }
    }
  }
  for (const id of focusIds) {
    const kb = getTrainingItem(id);
    if (!kb) continue;
    const tips = kb.tips.map((t) => t[locale]).join(" ");
    const mistakes = kb.commonMistakes.map((m) => m[locale]).join("；");
    nodes.push({
      node_id: `training:${id}`,
      kind: "guideline",
      summary_zh: `${kb.name.zh}训练建议：${tips}常见错误：${mistakes}。`,
      summary_en: `${kb.name.en} training: ${tips} Common mistakes: ${mistakes}.`,
      summary_ko: `${kb.name.ko} 훈련: ${kb.tips.map((t) => t.ko).join(" ")} 흔한 실수: ${kb.commonMistakes.map((m) => m.ko).join("; ")}.`,
      layer: "verified",
    });
  }

  // Safety flags
  const needs_human = student.route.needs_human || student.flags.includes("needs_human");
  if (needs_human) {
    nodes.push({
      node_id: "flag:needs_human",
      kind: "flag",
      summary_zh: "该生情况建议由体育教师/校医人工跟进。",
      summary_en: "This case should be escalated to a PE teacher / clinician.",
      summary_ko: "이 사례는 체육 교사/보건 교사의 후속 조치가 필요합니다.",
      layer: "reported",
    });
  }

  // RAG retrieval. Always include the two safety/non-causal clauses so the
  // agent (and safety refusals) can ground escalation and non-causal language.
  const alwaysIds = ["aptams:escalation", "aptams:non-causal"];
  const retrieved = query ? retrieveGuidelines(query, 3) : [];
  const byId = new Map<string, GuidelineClause>();
  for (const c of GUIDELINES) {
    if (alwaysIds.includes(c.id)) byId.set(c.id, c);
  }
  for (const c of retrieved) byId.set(c.id, c);
  const guidelineNodes: ContextNode[] = Array.from(byId.values()).map(
    (c) => ({
      node_id: `guideline:${c.id}`,
      kind: "guideline",
      summary_zh: c.text_zh,
      summary_en: c.text_en,
      summary_ko: c.text_en,
      layer: "verified",
    }),
  );

  return {
    student_id: student.student_id,
    role,
    nodes,
    guideline_clauses: guidelineNodes,
    safety: {
      needs_human,
      at_risk: student.progress.risk === "at_risk",
      reported_concern: false,
    },
  };
}

// ---------- grounding validation ------------------------------------------

export function validateGrounding(
  sentences: ProvenancedSentence[],
  context: StructuredContext,
): void {
  const known = new Set<string>([
    ...context.nodes.map((n) => n.node_id),
    ...context.guideline_clauses.map((n) => n.node_id),
  ]);
  for (const s of sentences) {
    if (!s.source_node_ids || s.source_node_ids.length === 0) {
      throw new Error(`Ungrounded sentence (cites no source): ${s.text}`);
    }
    for (const id of s.source_node_ids) {
      if (!known.has(id)) {
        throw new Error(`Sentence cites unknown node ${id}: ${s.text}`);
      }
    }
  }
}

export function allNodes(context: StructuredContext): ContextNode[] {
  return [...context.nodes, ...context.guideline_clauses];
}
