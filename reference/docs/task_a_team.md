# Task A — Team Working Doc

The single handout for the three of us on Task A (Feature Recognition). It defines what "done"
means, who owns what, and gives each person a prompt to paste into their AI assistant.
Deeper rationale lives in [`task_a_plan.md`](task_a_plan.md); the interface we hand Task B is in
[`task_b_handoff.md`](task_b_handoff.md). This doc is subordinate to `AGENTS.md` and
`docs/proposal.md`.

---

## 1. Mission

> **Problem statement.** Chinese university students can qualify for a scholarship by *passing* a
> physical-fitness test. Many students — especially those who aren't already athletic — don't know
> how to train effectively for it, don't get feedback on whether they're on track, and risk injury
> or inconsistent training without proper guidance.

Task A does not talk to the student — Task B's agent does. **We build the analytical substrate**
that makes the agent's guidance correct and personalized. Because the scoring rule is public and
deterministic, our answers can be *verified*, not merely plausible — that is the whole point.

---

## 2. The three objectives we MUST meet

Straight from the brief. **Task A is done only when all three are green** — not when the models
merely run.

| # | Objective | How we meet it | Owner |
|---|---|---|---|
| **A1** | Multi-dimensional indicator system: **fitness, metabolism, psychology, environment, behaviour** (national standard + WHO) | Indicator System: fitness (panel), metabolism + behaviour (SZU file), **psychology + environment via a short self-report survey we design**, + WHO reference indicators. All five dimensions, each tagged by data layer. | **A** |
| **A2** | **SHAP + LIME + expert experience** → feature-recognition rule base | Rule Base: SHAP **and LIME** from Progress Check, consolidated with mentor expert rules into one structured file. | **C** |
| **A3** | **Dynamic feature-update mechanism** (continuous learning) | A documented procedure that re-fits, refreshes importances, and updates/prunes the feature set + rule base as a new test-year arrives — demonstrated by replaying our cohorts over time. | **C** |

**Known risk:** A1's psychology + environment need *consent to field the survey* — a mentor
decision (see §6). A2 and A3 are fully within our control.

---

## 3. What we build (plain names)

| Model | In one line | Owner |
|---|---|---|
| **① Scorecard** | Raw results → official item scores, total, pass/fail — exactly per the national standard. Ground truth. | A |
| **② Route-to-Pass** ⭐ | The cheapest combination of improvements that gets a student to a pass. Exact math over the Scorecard. | A |
| **③ Progress Check** | From early-year results, predict whether a student is on track to pass; flag at-risk early; explain why (SHAP + LIME). | C |
| **④ Student Types** | Group students by strengths/weaknesses; pinpoint the non-athletic group. | B |
| *(⑤ Trust Check, optional)* | Verify our explanations recover the known scoring rule (a fidelity number, for the paper). | C |

---

## 4. Who does what

| Person | Owns | Objective |
|---|---|---|
| **A** (you) | ① Scorecard, ② Route-to-Pass, the **Indicator System (A1)** + survey design, shared data loader, integration + hand-off object | A1 |
| **B** | ④ Student Types (EDA, weakness profiles, segments) | feeds A2 |
| **C** | ③ Progress Check (SHAP **+ LIME**), the **Rule Base (A2)**, the **Dynamic Update mechanism (A3)**, optional Trust Check | A2, A3 |

Start in parallel — the CSVs already carry scores, so B and C begin immediately and switch to A's
loader once it lands. **Join key is `student_id` everywhere.** One sync after ~week 1 to lock the
hand-off object and confirm all three objectives are on track.

---

## 5. Definition of Done — tick every box and Task A is finished

**Person A**
- [ ] Scorecard reproduces the data's `total_score` within tolerance on the panel (verified).
- [ ] Route-to-Pass returns valid, safely-capped, effort-labelled routes for sample students.
- [ ] **A1:** Indicator System lists all **five** dimensions, each with ≥1 populated indicator
  (pilot data ok for psychology/environment), tagged by data layer, WHO indicators included; survey
  instrument exists with a pilot response set.
- [ ] Shared `load_panel()` + indicator dictionary published for B and C.
- [ ] Hand-off object schema finalized and produced for sample students.

**Person B**
- [ ] EDA of the 7 items delivered (figures + written takeaways).
- [ ] Per-student weakness profile, keyed by `student_id`.
- [ ] Interpretable segments with plain-language profiles; non-athletic group identified.
- [ ] Segments compared against the existing hand-cut labels, differences explained.
- [ ] Outputs importable by `student_id` into the hand-off object.

**Person C**
- [ ] Progress Check predicts a later outcome from early-year features; honest train/test metrics +
  calibration; per-student at-risk flag + probability.
- [ ] **A2:** both **SHAP and LIME** produced, consolidated with expert-rule hooks into the Rule
  Base file (segment → drivers → direction → effect size → expert note; notes may be `PLACEHOLDER`).
- [ ] **A3:** Dynamic Update mechanism documented + a working cohort-replay demo showing importances
  and the rule base updating; feature set versioned.
- [ ] (Optional) Trust Check fidelity number reported.

---

## 6. Shared rules (everyone)

- **Repo:** `github.com/SZUxSITxDAU/Fitness-Health`. Read `AGENTS.md`, `docs/proposal.md`,
  `docs/task_a_plan.md` before coding. Branch off `main` with a neutral name; PR into `main`.
- **No AI/tool attribution** in commit messages, PR descriptions, code, or filenames.
- **Data is sensitive:** it lives under `data/` (git-ignored). **Never commit real data.**
- **Guardrails (non-negotiable):** no weight-loss / caloric / body-image framing; self-report
  (mood/psychology/environment) stays with the student and never surfaces raw to a teacher;
  no student-facing ranking; directional non-evaluative framing ("improving since g2"); injury-safe
  pacing with escalation to a human, not diagnosis.

**Mentor checklist — raise in week 1 (Person A):**
1. **Can we field a short self-report survey** (mood/motivation = psychology; facilities/commute/
   screen-time/study-load = environment)? Consent/ethics process? *(blocks A1)*
2. **Exact scholarship pass rule** — what score / grade / evaluation year qualifies? *(Progress
   Check + Route-to-Pass)*
3. **Expert rules** — effort estimate per item + injury red-flags. *(Route-to-Pass + A2 rule base)*

---

## 7. Prompts to paste into your AI assistant

### 7A · Person A (you) — Scorecard + Route-to-Pass + Indicator System

> You work with the project's own assistant on these; the brief is: encode the scoring PDF as a
> deterministic Scorecard and **verify it reproduces `total_score`** on the panel; build
> Route-to-Pass as exact search over it (safely capped, effort labels `PLACEHOLDER`); design the
> five-dimension Indicator System incl. the self-report survey instrument; publish the shared
> loader and assemble the hand-off object. Full detail in `task_a_plan.md` §3 and §10.

### 7B · Teammate B — Student Types

```text
You are my Python coding assistant on a Shenzhen University summer research project called APTAMS — a university-student physical-fitness analysis system. I'm on the "Task A / Feature Recognition" sub-team. My job is called STUDENT TYPES: understand the data and group students by their pattern of strengths and weaknesses so guidance can be tailored. Help me build it.

PROBLEM CONTEXT: Chinese university students can earn a scholarship by PASSING a physical-fitness test. Students who aren't already athletic don't know how to train, get no feedback on whether they're on track, and risk injury. Our sub-team analyzes fitness data to produce an interpretable substrate that a separate LLM agent later turns into guidance. Interpretability is the whole point.

SETUP: Clone github.com/SZUxSITxDAU/Fitness-Health. Read AGENTS.md, docs/proposal.md, and docs/task_a_plan.md BEFORE coding (my part is model ④ "Student Types"). Work in Python (pandas, scikit-learn, matplotlib). New branch off main, neutral name. No AI or tool name in commits or PR descriptions.

DATA (I'll send the files separately; keep them under data/ which is git-ignored; NEVER commit real data):
- pft.csv — 36,059 rows, utf-8-sig, one row per student, fully-balanced 4-year panel. Columns:
  * student_id, gender (女/男), enrollment_year, ethnicity, college (mostly empty)
  * For each metric, FOUR columns _g1,_g2,_g3,_g4 (freshman→senior): bmi, height, weight, vital_capacity, sprint_50m, standing_long_jump, sit_and_reach, endurance_run_sec (LOWER is better), strength, total_score (0–100)
- student_business_class.csv — 35,887 rows: student_id, delta_score (g1→g4 change), improve_cat and business_cat (existing HAND-CUT labels; use only as a baseline to compare against, not ground truth).

WHAT TO BUILD (lean and genuinely useful — do NOT over-engineer):
1. Solid EDA of the 7 scored items (bmi, vital_capacity, sprint_50m, standing_long_jump, sit_and_reach, endurance_run_sec, strength): distributions by gender, correlations with total_score, how each item changes g1→g4. Clear figures + written takeaways.
2. Per-student WEAKNESS PROFILE: for each student, which items are their weak spots (relative to same-gender peers or to the pass threshold). This is the most useful output.
3. Student segments: a small number of interpretable groups (start simple; use K-means/GMM ONLY if it beats a simple rule, justify k by silhouette + interpretability). Plain-language profile per group. Explicitly identify and characterize the LOW-BASELINE / NON-ATHLETIC group — that's who the system is for.
4. Compare your segments to the existing improve_cat/business_cat and explain where a data-driven version differs.

NON-NEGOTIABLE CONSTRAINTS (from AGENTS.md):
- Interpretability first — every segment needs a plain-language profile; no unexplained cluster IDs.
- DIRECTIONAL, NON-EVALUATIVE framing; never "below standard / failing".
- Segments are for tailoring guidance / for teachers in aggregate — NEVER a student-facing ranking.
- NO weight-loss, caloric, or body-image framing.
- Report uncertainty honestly; don't oversell weak clusters.

OUTPUT: a Python module or notebook under an analysis/ folder, saved figures, a 1-page summary, and per-student fields (segment label + weakness profile) keyed by student_id so a teammate can import them into a shared hand-off object. If the pass rule or any column is unclear, ask me before assuming.
```

### 7C · Teammate C — Progress Check + Rule Base (A2) + Dynamic Update (A3)

```text
You are my Python coding assistant on a Shenzhen University summer research project called APTAMS — a university-student physical-fitness analysis system. I'm on the "Task A / Feature Recognition" sub-team, and I own THREE required deliverables: model ③ Progress Check, plus objectives A2 (the SHAP+LIME+expert rule base) and A3 (the dynamic feature-update mechanism). Help me build all three.

PROBLEM CONTEXT: Chinese university students can earn a scholarship by PASSING a physical-fitness test. Students who aren't athletic don't know how to train, get no feedback on whether they're on track, and risk injury. Our sub-team produces an interpretable substrate that a separate LLM agent later turns into guidance. The project's differentiator is that the scoring rule is public and deterministic, so our explanations can be VERIFIED.

SETUP: Clone github.com/SZUxSITxDAU/Fitness-Health. Read AGENTS.md, docs/proposal.md, and docs/task_a_plan.md BEFORE coding — my parts are model ③ and deliverables ⑥ (Rule Base, A2) and ⑦ (Dynamic Update, A3), with the Definition of Done in the team doc. Work in Python (pandas, scikit-learn, shap, lime, matplotlib). New branch off main, neutral name. No AI or tool name in commits or PR descriptions.

DATA (I'll send the files separately; keep them under data/ which is git-ignored; NEVER commit real data):
- pft.csv — 36,059 rows, utf-8-sig, balanced 4-year panel. Columns:
  * student_id, gender (女/男), enrollment_year, ethnicity, college (mostly empty)
  * For each metric, FOUR columns _g1,_g2,_g3,_g4 (freshman→senior): bmi, height, weight, vital_capacity, sprint_50m, standing_long_jump, sit_and_reach, endurance_run_sec (LOWER is better), strength, total_score (0–100)
- student_2024_scholarship_status.csv — 20,140 rows: student_id, gender, business_cat, total_score_g2/g3/g4, eval_grade (大二/大三/大四), pass_scholarship (True/False; ~74% pass). The policy outcome.
- student_business_class.csv — student_id, delta_score (g1→g4 change).

DELIVERABLE 1 — PROGRESS CHECK (model ③):
- Interpretable gradient-boosted model predicting a LATER outcome (pass_scholarship, and separately g4 decline / total_score_g4) FROM EARLY features (g1 only, and separately g1+g2) + demographics (gender, enrollment_year).
- CRITICAL: predict LATER from EARLIER. Do NOT predict total_score from the SAME year's items — total_score is a deterministic function of them, so that's circular.
- Output a per-student "at-risk" flag + probability. Proper train/test split; report accuracy AND calibration honestly. It's a RISK FLAG, not a certainty.

DELIVERABLE 2 — RULE BASE (objective A2 — SHAP + LIME + expert):
- Produce BOTH SHAP (global + dependence + per-segment: by gender, baseline band, and segment label if my teammate provides one) AND LIME (local explanations for individual students). LIME is REQUIRED.
- Consolidate into ONE structured artifact (JSON + a readable markdown table) with entries: segment → top drivers → direction → effect size → expert note. Leave an "expert note" field per rule as PLACEHOLDER — I'll fill it from mentor expert rules later. This artifact IS the "feature-recognition rule base" the brief requires.

DELIVERABLE 3 — DYNAMIC FEATURE-UPDATE MECHANISM (objective A3):
- Build a documented, coded procedure that: (1) triggers when a new test-year cohort arrives, (2) re-fits the model + recomputes SHAP/LIME importances, (3) refreshes the rule base, (4) maintains the feature set (promote newly-informative features, prune uninformative ones across refits; version the feature set).
- DEMONSTRATE it using our existing cohorts as if arriving over time: train on enrollment cohorts 2017–2021, then "receive" 2022–2023, and show how importances and the rule base change. A clear before/after is the deliverable.

OPTIONAL — TRUST CHECK: since total_score is a known function of the 7 items, train a model to reproduce it, run SHAP, and measure whether SHAP recovers the true item contributions; report a fidelity number.

NON-NEGOTIABLE CONSTRAINTS (from AGENTS.md):
- Interpretability is the deliverable, not accuracy alone.
- Do NOT invent or approximate any scoring threshold; treat total_score in the data as ground truth.
- DIRECTIONAL, NON-EVALUATIVE framing; no "failing" language; no student-facing ranking.
- NO weight-loss, caloric, or body-image framing.
- Report divergence and uncertainty openly; a 4-year-ahead prediction is fuzzy — say so.

OUTPUT: Python modules + figures under an analysis/ folder, the rule base file, the dynamic-update demo, a 1-page summary, and per-student fields (at-risk flag + probability + top-3 drivers) keyed by student_id for the shared hand-off object. If the pass rule or any column is unclear, ask me before assuming.
```
