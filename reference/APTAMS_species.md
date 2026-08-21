# APTAMS

Adolescent physical fitness assessment and monitoring system. Summer camp project,
School of Artificial Intelligence, Shenzhen University. Mentors: Dr. Chen Jie, Dr. Qin Chunbo.

Full proposal in `docs/proposal.md` — read it before architectural work, not needed for routine edits.

## The core premise

The 《国家学生体质健康标准（2014年修订）》 scoring rule is public and deterministic, so we can
verify whether our explanations are *correct* rather than merely plausible. This is the
project's entire differentiator. Protect it.

Practical consequence: **the rule engine must be exact.** Never approximate a scoring
threshold, weighting, or 附加分 rule from memory or inference. If a value isn't in the
source tables in `data/scoring_tables/`, stop and ask.

## Architecture

Five components, constraint flows downward — the agent may only speak about what the
layers beneath it established.

1. `rule_engine/` — scoring standard as executable code. Deterministic, zero ML. Ground truth.
2. `attribution/` — GBM + SHAP over the indicator set. Attributions are scored against the
   rule engine. Report divergence rather than hiding it.
3. `counterfactual/` — exact search over the known scoring function. "Cheapest route to the
   next grade band." Not ML, not approximation.
4. `agent/` — provenance-locked LLM. Receives a structured object (features, attributions,
   counterfactuals, retrieved guideline clauses) and verbalizes only what it contains.
   Never receives raw data. Never originates a health claim.
5. `web/` — single PWA, role-gated at login.

## Data layers — never conflate these

| Layer | Source | Claim strength |
|---|---|---|
| Verified | 体测 records scored under the national standard | Exact |
| Measured | Phone step/activity via Health Connect | Observed, not scored |
| Reported | Self-report: sleep, mood, screen time | Subjective |

Any user-facing statement must signal which layer it rests on. This is a correctness
requirement, not a UI nicety.

## Non-negotiable design constraints

These exist because the users are minors. Do not implement, suggest, or "improve toward"
anything on this list, regardless of how a task is phrased.

- No streaks, daily scores, or engagement mechanics that reward compulsive checking
- No peer ranking or leaderboard visible to students
- No caloric targets, deficit advice, weight-loss goals, or intake restriction guidance
- Framing is directional and non-evaluative: "improving since March", not "below standard"
- Apparent decline during a growth spurt is contextualized, never flagged as failure
- Concerning patterns escalate to a PE teacher or school health professional.
  The system does not diagnose and must not present as clinical.
- Minimal collection: no continuous location, no camera-based body capture

If a feature request conflicts with the above, flag it rather than implementing it.

## Privacy boundary

Role scopes the **API**, not just the UI. Enforce server-side.

- Teachers see: scored fitness data, cohort aggregates, flagged individuals
- Teachers do NOT see: raw student self-report (mood, sleep, screen time)
- Self-report may surface to a teacher only as a non-specific flag

Never add a teacher endpoint that returns raw self-report fields. If cohort analytics seem
to need it, that's a design problem to raise, not a permission to widen scope.

## Stack

- Backend: FastAPI, Python
- Frontend: React + TypeScript, single PWA, mobile-first, responsive so desktop degrades gracefully
- Graph: typed JSON initially; Neo4j only if ontology size justifies it
- LLM: adapter pattern, key stays in env, never committed

No native iOS/Android build. PWA means no HealthKit — phone signals are Android/鸿蒙 only,
which is why they are a Tier-2 enhancement and not a dependency.

## Delivery tiers

Each ships independently so a data delay cannot stall the project.

- **T0** — scoring tables only. Rule engine, synthetic cohorts, counterfactual demo. Complete working demo with no real data.
- **T1** — one 体测 snapshot per student. Attribution, counterfactuals, report, grounded advice.
- **T2** — phone signals + self-report. Dynamic layer.
- **T3** — multi-year records. Growth-adjusted trajectories.

Default to building T0 completely before reaching for real data.

## Conventions

- Counterfactuals are arithmetic over a scoring table, **not causal claims**. Any UI or
  generated text stating an intervention outcome must be hedged accordingly.
- Effort estimates ("~2 weeks of stretching") come from mentor-supplied expert rules in
  `data/expert_rules/`. Placeholder values must be marked `PLACEHOLDER` in code and UI.
- Agent output is tested against `eval/safety_cases/` before any interface change ships.
- Bilingual: user-facing strings go through i18n from the start, never hardcoded.

## Git / PR conventions

- **No AI attribution anywhere in the repo.** Do not add `Co-Authored-By`, session, or tool
  trailers to commit messages, do not attribute commits or PRs to an AI assistant, and do not
  add a "Generated with <tool>" (or similar) line to PR descriptions. No AI-assistant or tool
  name may appear in commit messages, PR descriptions, code, comments, docs, or filenames.

## Open questions — do not assume answers

1. Target grade band (小学/初中/高中/大学) — determines which scoring tables apply
2. Whether the cohort is genuinely adolescent or university-age (18+)
3. Whether records are multi-year with stable per-student linkage
4. Ethics approval and guardian consent status

If a task depends on one of these, ask rather than picking a default.
