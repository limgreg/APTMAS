# APTAMS — Project Proposal (v2)

**A glass-box adolescent fitness agent: verified explanations, phone-native monitoring**

Prepared for: Dr. CHEN Jie / Dr. QIN Chunbo · School of Artificial Intelligence, Shenzhen University
Status: pre-briefing draft — assumptions in §9 to be confirmed
Changes from v1: single progressive web app replaces separate mobile and web clients; role-gated interfaces and privacy scoping added; build requirements added in §11

---

## 1. One-line summary

A mobile-first adolescent fitness assessment and monitoring system, delivered as a single installable web app with role-gated student and teacher interfaces. The annual 体测 record acts as a verified backbone, phone signals and light self-report supply the dynamic layer, and an LLM agent explains across both — with every claim traceable to a deterministic rule, a model attribution, or a cited guideline.

**The distinguishing property:** because the 《国家学生体质健康标准》 scoring rule is public and deterministic, we can measure whether our explanations are *correct*, not merely plausible. Most explainable-AI work in health cannot do this, because the true decision process is unknown. This turns "interpretable" from a claim into a reported number.

---

## 2. Why this shape

The brief asks for three things that pull against each other: interpretability, multi-dimensional data, and dynamic real-time monitoring. Static dashboards satisfy the first and fail the third. Wearable-driven apps satisfy the third but abandon the project's actual data asset and make interpretability unverifiable.

We resolve this by splitting the data layer by **epistemic status** rather than by source:

| Layer | Source | What we can claim |
|---|---|---|
| **Verified** | 体测 records scored under the national standard | Exact — the scoring function is known and executable |
| **Measured** | Phone step count, activity, PE participation | Observed, but not ground-truth-scored |
| **Reported** | Sleep, mood, screen time (brief self-report) | Subjective, and treated as such throughout |

The agent must signal which layer any statement rests on. That separation is itself a contribution, and it is what lets the system be dynamic without becoming unfalsifiable.

---

## 3. How this meets the brief

| Deck requirement | How it is met |
|---|---|
| Build APTAMS driven by explainable AI agent + LLM | The five-component system in §5 |
| **Task A** — multi-dimensional indicator system from the national standard and WHO guidelines | Indicator schema spanning the three layers above; national standard as the scored core, behavioural and psychological dimensions via phone signals and self-report |
| **Task A** — SHAP/LIME + expert experience → feature-recognition rule base | Attribution layer benchmarked against the rule engine; mentor-supplied expert rules encoded as graph constraints |
| **Task A** — dynamic feature updating | Phone signals update the feature set between annual tests; trajectory model re-weights as new data arrives |
| **Task B** — knowledge graph over feature nodes | Typed graph linking indicators → scoring thresholds → guideline clauses → intervention templates |
| **Task B** — domain-enhanced LLM via RAG | Retrieval over WHO youth activity guidelines, the national standard, and 《义务教育体育与健康课程标准（2022年版）》 |
| **Task B** — LLM agent, real-time, aligned with expert guidelines | Provenance-locked agent (§5.4); alignment enforced structurally, not by prompt instruction |
| Interpretable models, personalized reports, intervention strategies | Per-student report with counterfactual intervention paths (§5.3) |
| Deliverables: in-camp models + agent; post-camp competition and paper | §8 |

**Above the brief:** a verified-explanation metric (§6.1), an adversarial safety evaluation set (§6.2), and a teacher triage interface with an architectural privacy boundary (§5.5).

---

## 4. Delivery decision: one PWA, two roles

A single progressive web app serves both audiences, with the interface determined by role at login.

**Why this over native or separate clients**

- One codebase, one deploy, one URL — no App Store or 应用商店 review, no ICP filing delay, no TestFlight friction during a camp timeline.
- The demo works on whatever phone a reviewer is holding: open a link, or install to home screen.
- The teacher interface comes free rather than as a second project.
- Layouts are written responsive, so a laptop browser degrades gracefully instead of breaking — the desktop option stays open without being designed for.

**The accepted cost**

iOS does not expose HealthKit to web apps. Step and activity data will be available on Android and 鸿蒙 devices via Health Connect, and unavailable on iPhone. This is why phone signals are scoped as a Tier-2 enhancement rather than a Tier-0 dependency. If sensor data proves essential after briefing, the port to React Native + Expo touches the ingestion adapter only and leaves the engine untouched.

---

## 5. Architecture

Five components. The first is deterministic, the last is generative, and constraint flows in that direction — the agent may only speak about what the layers beneath it have established.

### 5.1 Rule engine (deterministic)

The national scoring standard as executable code: raw measurements → item scores → weighted total → grade band, per age group and sex, including 附加分 rules. No machine learning. This is the ground truth everything else is checked against, and it lets us generate realistic synthetic cohorts before any real data arrives.

### 5.2 Predictive and attribution layer

A gradient-boosted model over the indicator set, with SHAP attributions. Deliberately unexciting — the contribution is not the model but that its attributions are **scored against the rule engine's known ground truth**. Where attribution diverges from truth, notably among correlated anthropometric features, we report the divergence rather than hide it.

### 5.3 Counterfactual planner

The pivot from "why did I score this" to "what is the cheapest route to the next grade band." Because the scoring function is known, counterfactuals are exact search rather than approximation:

> *Sit-and-reach +4 cm → 良好. 800 m −12 s → 良好. The first is roughly two weeks of consistent stretching; the second roughly six weeks of conditioning.*

Effort estimates come from mentor-supplied expert rules and are labelled as estimates. Counterfactuals are arithmetic over a scoring table — **not causal claims** about training outcomes, and the interface says so.

### 5.4 Provenance-locked agent

The LLM never receives raw data and never originates a health claim. It receives a structured intermediate object — features, attributions, counterfactuals, trajectory flags, retrieved guideline clauses — and verbalizes only what that object contains. Every generated sentence carries a reference to its source node, tappable to reveal what produced it.

This is the direct answer to "transparency and credibility in health assessments." Guideline alignment is enforced by construction rather than requested in a prompt, which matters given the documented tendency of LLM explanations to function as plausible post-hoc rationalization rather than faithful accounts of the underlying process.

### 5.5 Role-gated interfaces

Both interfaces live in the same app; role is resolved at login and branches the routing.

**Student view** — current standing, trajectory, counterfactual explorer with live sliders, guideline-grounded suggestions with visible provenance.

**Teacher view** — designed as a triage feed rather than a spreadsheet, because that is what a phone is good at: *"3 students need attention this week"* → tap for why → tap for suggested action. Cohort trends available, but the entry point is prioritized attention.

**The privacy boundary is architectural.** Role scopes the API, not merely the UI. Teachers see scored fitness data, cohort aggregates, and flagged individuals. They do **not** see raw student self-report on mood, sleep or screen time; those inform the student's own view and can surface to a teacher only as a non-specific flag. Making the consent model an enforced property of the auth layer — rather than a policy statement — is a design commitment we will document.

### 5.6 Data adapters

Ingestion is source-agnostic behind one interface. Phone step and activity data via Health Connect requires no hardware purchase. If a wearable partner appears, it becomes an additional adapter rather than an architectural change — the dependency is isolated by design.

---

## 6. Evaluation — the part usually missing

We propose that evaluation, not the pipeline, is the publishable contribution.

### 6.1 Explanation fidelity
Attribution and agent narrative scored against rule-engine ground truth on scored items, reported as a fidelity figure plus a stability test across resampling and retraining. This addresses head-on the known instability of post-hoc attribution under correlated biomedical features.

### 6.2 Adversarial safety set
Roughly 50 constructed cases probing the failure modes that matter for minors: does the system suggest caloric restriction to a high-BMI 14-year-old; does it encourage training through reported pain; does it escalate red flags to a human. Pass rates reported openly.

### 6.3 Expert rubric evaluation
50–100 profiles rated by Dr. Qin's team against a rubric covering accuracy, appropriateness, actionability and safety. Small-sample and reported as a pilot, but it is the difference between a demo and a result.

---

## 7. What we deliberately design against

Continuous self-tracking aimed at 13–17 year olds is a known pathway into body-image harm and disordered eating. A system giving adolescents daily numerical feedback about their bodies can cause damage while functioning exactly as specified. These are design requirements, not a limitations paragraph:

- **No optimization loops.** No streaks, no daily scores, no engagement mechanics rewarding compulsive checking.
- **No peer ranking.** Cohort context exists for teachers in aggregate; students are never shown their position relative to classmates.
- **No caloric or deficit targets.** No numeric intake advice, weight-loss targets, or restriction guidance under any prompt.
- **Trajectory over judgment.** Framing is directional and non-evaluative — "this has been improving since March," not "you are below standard."
- **Growth-aware framing.** Apparent decline during a growth spurt is contextualised, not flagged as failure.
- **Escalation, not diagnosis.** Concerning patterns route to a PE teacher or school health professional. The system does not diagnose and does not present as clinical.
- **Minimal collection.** Only what assessment requires; no continuous location, no camera-based body capture, no ambient collection.
- **Self-report stays with the student.** Mood and sleep data are not exposed to teachers in raw form.

These are guardrails and risk reduction, not guarantees, and we will describe them as such.

---

## 8. Delivery plan

Tiered so each level ships independently and a data delay cannot stall the project.

| Tier | Requires | Delivers |
|---|---|---|
| **T0** | Nothing but the scoring tables | Rule engine, synthetic cohorts, counterfactual demo — a complete working demo with no real data |
| **T1** | One 体测 snapshot per student | Attribution, counterfactuals, personalized report, grounded advice |
| **T2** | Phone signals + self-report | Dynamic layer, between-test monitoring, behavioural and psychological dimensions |
| **T3** | Multi-year records | Growth-adjusted trajectories — separating genuine decline from mid-growth-spurt change, a real limitation of snapshot scoring that current systems do not address |

**Sequencing:** data scoping first; route and role-scoping spec; rule engine and counterfactual solver (mostly search over a known function, not ML); graph, retrieval and provenance-locked agent; evaluation in parallel with interface polish.

**Stack:** FastAPI backend, React + TypeScript PWA, typed JSON graph or Neo4j depending on ontology size, domestic LLM for the agent.

**Deliverables:** the five-component engine; role-gated PWA; an adolescent fitness advice benchmark with safety split; a paper whose contribution is the verification framework.

---

## 9. Assumptions to confirm at briefing

1. 体测 data is available at **individual-record** granularity, not school aggregate.
2. The population is genuinely **adolescent**. If access runs through the university testing centre, the cohort may be 18+, and framing and title need revision.
3. Records span **multiple years** with stable per-student linkage — T3 depends on this entirely.
4. The **2014 revision** is the operative standard for this cohort.
5. **Ethics approval and guardian consent** are handled institutionally. Minors' fitness data is sensitive personal information requiring separate consent and annual compliance auditing; confirm first, as it can block deployment.
6. **Mentor time** is available for rating 50–100 evaluation cases.
7. A capable **domestic LLM** is callable at acceptable latency and cost.
8. The professors want an **interpretable, deployable system** rather than a state-of-the-art prediction benchmark. If the latter, this plan targets the wrong thing.

---

## 10. Known limitations

- **Verifiability covers only the scored items.** Once metabolic, psychological or environmental dimensions enter, no ground-truth rule exists and those explanations become as unverifiable as anyone else's. We scope this honestly rather than paper over it.
- **The national standard measures a narrow slice** — anthropometry, vital capacity, and a handful of physical items. The deck's five dimensions are not in that dataset and cannot be fully collected within a camp.
- **Counterfactuals are not causal.** Exact arithmetic over a scoring table, not evidence that an intervention produces the stated gain.
- **Advice quality is bounded by the retrieval corpus.** Guideline text is population-level, not individual.
- **No HealthKit on iOS.** Phone signals will be Android and 鸿蒙 only in the PWA build.
- **No true real-time physiology.** Phone signals are behavioural proxies; "real-time" remains an aspiration at this stage.
- **Growth adjustment relies on proxies.** Without maturation staging, age- and height-based approximation is crude.
- **Small-sample expert evaluation.** Directionally useful, not statistically powered.
- **Safety measures reduce risk; they do not eliminate it.** Human escalation remains part of the design.

---

## 11. What is needed to begin building

### Blocking — nothing can start without these

**1. The scoring tables.** 《国家学生体质健康标准（2014年修订）》 evaluation tables as a file — PDF or Excel. Needed per item, per grade band, per sex, including item weightings and 附加分 rules. The entire premise rests on the rule engine being exactly right; approximated thresholds would collapse the ground-truth claim and with it the project's differentiator. This must not be guessed.

**2. Target grade band.** 小学 / 初中 / 高中 / 大学. Determines which tables apply, the indicator set, and the tone of every generated message.

### Needed early — shapes code written in week one

**3. Interface language.** Chinese, English, or bilingual. Affects UI, agent prompts, retrieval corpus, and report templates.

**4. Data schema.** Even fabricated column names in a CSV. Real field names beat invented ones, and retrofitting a schema is expensive.

**5. Stack confirmation.** FastAPI + React/TypeScript PWA as proposed, or a team preference stated now rather than after code exists.

**6. LLM provider and access.** DeepSeek, Qwen, GLM or other. The adapter gets written either way; the key stays with you and calls run on your side.

### Needed before the agent layer

**7. Guideline documents** for the RAG corpus — WHO youth physical activity guidelines, 《义务教育体育与健康课程标准（2022年版）》, and any departmental materials Dr. Qin can supply.

**8. Expert rules from the mentor.** Effort estimates for improving each test item, and any red-flag criteria that should trigger escalation. Can arrive later, but the counterfactual planner ships with placeholders until it does.

### Working method

Module by module, not one delivery. Build a component, run it, report what breaks, iterate, move on. Repository structure and rule engine first, since everything depends on it.

One note on ownership: the team will be presenting this and fielding questions. Scaffolding can be delegated, but at least one member should be able to defend every architectural decision unaided — that distinction tends to matter when reviewers start probing.
