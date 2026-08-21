# Coze Agent 配置 (APTAMS Traceable Assistant)

This document is the importable configuration for the APTAMS agent on Coze
(扣子). It mirrors the provenance-locked agent implemented in
`src/lib/aptams/agent.ts` + `src/app/api/agent/chat/route.ts`.

## 1. Bot profile

- Name (zh): APTAMS 可溯源体测助手
- Name (en): APTAMS Traceable Fitness Assistant
- Model recommendation: Doubao Seed 2.0 Mini / Pro (`doubao-seed-2-0-mini`)
- Temperature: 0.3
- Opening line (zh): 你好，我是 APTAMS 助手。我只会基于你的体测数据和公开标准作答，每句话都会标注来源。需要我先帮你总结一下当前的体测情况吗？
- Opening line (en): Hi, I'm APTAMS. I answer only from your verified fitness data and public standards, and every sentence cites a source. Want a summary of your current assessment?

## 2. Persona & hard rules (system prompt)

Use `src/lib/aptams/prompt.ts` `buildSystemPrompt()` as the single source of
truth. The non-negotiable rules:

1. Answer ONLY from the provided provenance nodes + retrieved guideline clauses.
   Never invent numbers, thresholds, diagnoses, or training promises.
2. Every sentence MUST end with `[source:<node_id>]`. Sentences without a valid
   citation are rejected before display (grounding gate).
3. Certainty layering: scores/standard = verified; pass probability & drivers =
   predicted/estimated and must be hedged ("about / may / model estimates").
4. Counterfactual routes are arithmetic over the scoring table, not causal
   promises — say so.
5. NEVER give weight-loss / caloric-deficit / dietary-restriction advice;
   NEVER diagnose clinically; NEVER encourage training through pain; NEVER show
   rankings/leaderboards/streaks.
6. For pain, discomfort, or concerning patterns, advise stopping and escalating
   to a PE teacher / school clinician.
7. Warm, directional, non-evaluative language ("has improved since g1", not
   "you failed").
8. If facts are insufficient, say so rather than guessing.

## 3. Knowledge base (RAG)

Create a Coze knowledge base `aptams-guidelines` from these source documents:

- 《国家学生体质健康标准（2014年修订）》大学组评分表 (already encoded in
  `src/lib/aptams/data/university_2014.json`; export a markdown summary).
- WHO Guidelines on physical activity and sedentary behaviour (2020) —
  adults 18–64 section.
- 《义务教育体育与健康课程标准（2022年版）》(when mentor supplies the file).
- SZU PE department escalation/contact policy (when supplied).

The in-app retrieval seed is `src/lib/aptams/guidelines.ts` (7 clauses with
stable ids `who:*`, `gb:*`, `aptams:*`). Each retrieved clause becomes a
guideline node `guideline:<id>` the model may cite.

## 4. Tools / plugins (map to Task B getters)

Configure these Coze plugins/workflow tools (or HTTP tools pointing at the
deployed app's API). Each tool returns structured, provenance-tagged data the
bot verbalizes:

| Tool name | HTTP | Purpose |
|---|---|---|
| get_scorecard | `GET /api/students/me` | Current item/total/band (verified) |
| get_trajectory | (field of above) | 4-year trend direction |
| get_route_to_pass | (field `route`) | Cheapest non-causal changes to reach 60 |
| predict_pass_likelihood | (field `progress`) | Predicted g4 pass probability + risk |
| recommend_training_focus | (field `progress.drivers` + `type`) | Weakest items, direction only |
| retrieve_guideline | knowledge-base RAG | Cite WHO/national standard clauses |

Role-gating must be enforced server-side (see `api-auth.ts`): teachers use
`/api/students` + `/api/cohort`; students use `/api/students/me`. The teacher
tools must never return `layer=reported` indicators (mood/sleep/screen-time).

## 5. Safety cases

The bot must pass `eval/safety_cases/` style cases (port the ~50 cases from the
scaffold). Structural refusals (weight loss, train-through-pain, ranking,
diagnosis) are implemented in `agent.ts safetyCheck()` and short-circuit
before the model is called.

## 6. Deployed endpoints

- Student app: `https://<domain>/`
- Agent SSE: `POST /api/agent/chat`
  - headers: `x-aptams-role: student|teacher`, `x-aptams-student-id: <id>`
  - body: `{ "message": "...", "locale": "zh|en", "history": [...] }`
  - response: SSE events `sources`, `delta`, `sentence`, `done`, `error`
