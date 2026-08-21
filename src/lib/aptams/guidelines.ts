// The RAG corpus — retrievable guideline clauses with stable citable ids.
// At build/runtime this is a small in-memory knowledge base: the national
// scoring standard (already encoded by the rule engine) plus WHO physical-
// activity guidelines for adults. Each clause is a node the agent may cite,
// exactly like an internal provenance node (docs/task_b_handoff.md §5).
//
// The 2022 PE curriculum standard and any mentor-supplied departmental
// materials should be added here as additional clauses when provided.

export interface GuidelineClause {
  id: string;
  source: string;
  title_zh: string;
  title_en: string;
  text_zh: string;
  text_en: string;
  tags: string[];
}

export const GUIDELINES: GuidelineClause[] = [
  {
    id: "who:pa-adult-150",
    source: "WHO Guidelines on physical activity and sedentary behaviour (2020)",
    title_zh: "成人每周有氧活动量",
    title_en: "Adult weekly aerobic activity",
    text_zh:
      "18–64 岁成人每周应进行 150–300 分钟中等强度有氧活动，或 75–150 分钟高强度有氧活动，或等效组合。",
    text_en:
      "Adults aged 18–64 should do 150–300 minutes of moderate-intensity aerobic activity, or 75–150 minutes of vigorous-intensity activity, or an equivalent combination each week.",
    tags: ["behaviour", "aerobic", "weekly_active_min"],
  },
  {
    id: "who:strength-2x",
    source: "WHO Guidelines on physical activity and sedentary behaviour (2020)",
    title_zh: "每周肌肉强化训练",
    title_en: "Muscle-strengthening weekly",
    text_zh:
      "成人每周应进行至少 2 天涉及全身主要肌群的中等或更高强度肌肉强化活动。",
    text_en:
      "Adults should do muscle-strengthening activities at moderate or greater intensity that involve all major muscle groups on 2 or more days a week.",
    tags: ["behaviour", "strength", "strength_sessions_per_week"],
  },
  {
    id: "who:sedentary",
    source: "WHO Guidelines on physical activity and sedentary behaviour (2020)",
    title_zh: "限制久坐时间",
    title_en: "Limit sedentary time",
    text_zh:
      "应限制久坐时间；以任何强度的身体活动替代久坐都有助于健康，增加中高强度活动收益更大。",
    text_en:
      "Adults should limit sedentary time. Replacing sedentary time with physical activity of any intensity provides health benefits; more moderate-to-vigorous activity is better.",
    tags: ["behaviour", "screen_time", "environment"],
  },
  {
    id: "gb:scoring-university",
    source: "《国家学生体质健康标准（2014年修订）》",
    title_zh: "大学组评分构成",
    title_en: "University scoring composition",
    text_zh:
      "大学组指标权重为：BMI 15、肺活量 15、50 米跑 20、坐位体前屈 10、立定跳远 10、引体向上/仰卧起坐 10、1000米/800米跑 20；引体向上/仰卧起坐、耐力跑对超过100分阈值的成绩给予附加分，附加分上限10分。",
    text_en:
      "University weights: BMI 15, vital capacity 15, 50m sprint 20, sit-and-reach 10, standing long jump 10, pull-ups/sit-ups 10, 1000m/800m run 20. Bonus points (cap 10) are awarded for strength and endurance results beyond the 100-point threshold.",
    tags: ["fitness", "scoring", "weights"],
  },
  {
    id: "gb:grade-bands",
    source: "《国家学生体质健康标准（2014年修订）》",
    title_zh: "等级划分",
    title_en: "Grade bands",
    text_zh:
      "根据总分评定等级：90 分及以上为优秀，80–89 为良好，60–79 为及格，60 分以下为不及格。",
    text_en:
      "Grade bands: 90+ Excellent, 80–89 Good, 60–79 Pass, below 60 Fail.",
    tags: ["fitness", "band"],
  },
  {
    id: "aptams:non-causal",
    source: "APTAMS design principle",
    title_zh: "反事实推演的非因果性",
    title_en: "Counterfactuals are non-causal",
    text_zh:
      "系统给出的提分路径是在评分表上的精确算术推演，展示“达到目标的一种指标组合”，并非对训练效果的因果承诺。实际提升存在个体差异，如有疼痛或不感应停止训练并咨询体育教师/校医。",
    text_en:
      "Routes shown are exact arithmetic over the scoring table — a combination of changes that would reach a target, not a causal promise of training outcomes. Improvements vary individually; stop and consult a PE teacher or clinician in case of pain or discomfort.",
    tags: ["safety", "route", "escalation"],
  },
  {
    id: "aptams:escalation",
    source: "APTAMS design principle",
    title_zh: "升级而非诊断",
    title_en: "Escalation, not diagnosis",
    text_zh:
      "本系统不作临床诊断。出现持续疼痛、明显不适或令人担忧的趋势时，应转交体育教师或学校健康专业人员处理。",
    text_en:
      "This system does not diagnose. Persistent pain, discomfort, or concerning patterns are escalated to a PE teacher or school health professional.",
    tags: ["safety", "escalation"],
  },
];

/** Simple keyword retrieval over the bilingual corpus. */
export function retrieveGuidelines(query: string, topK = 3): GuidelineClause[] {
  const q = query.toLowerCase();
  const terms = q.split(/[\s,。，、？?！!]+/u).filter((t) => t.length > 0);
  const scored = GUIDELINES.map((c) => {
    const hay = (
      c.text_zh +
      " " +
      c.text_en +
      " " +
      c.tags.join(" ")
    ).toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (hay.includes(t)) score += 1;
    }
    // tag match bonus
    for (const tag of c.tags) {
      if (q.includes(tag)) score += 2;
    }
    return { c, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((s) => s.c);
}
