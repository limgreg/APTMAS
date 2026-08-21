# Task A — Feature Recognition: analysis & modelling plan

**Status:** planning draft for team review. **Read first:** `docs/proposal.md`, `AGENTS.md` —
this document is subordinate to both.
**Scope owner:** Task A sub-team (3 people).

---

## 1. What we are actually solving

> **Problem statement.** Chinese university students can qualify for a scholarship by *passing*
> a physical-fitness test. Many students — especially those who aren't already athletic — don't
> know how to train effectively for it, don't get feedback on whether they're on track, and risk
> injury or inconsistent training without proper guidance.

Task A does not talk to the student — Task B's agent does. Task A produces the **analytical
substrate** that makes the agent's guidance correct and personalized. One discipline throughout:
**the scoring rule is public and deterministic, so our answers can be *verified*, not merely
plausible** (`AGENTS.md` §The core premise) — the project's differentiator.

---

## 2. Task A objectives — non-negotiable, and how we meet ALL THREE

These three come straight from the project brief. **Every one must be met.** This table is the
scorecard for "is Task A done"; the rest of the document is how we deliver each row.

| # | Deck objective | How we fully meet it | Owner |
|---|---|---|---|
| **A1** | Multi-dimensional indicator system covering **fitness, metabolism, psychology, environment, behaviour** (national standard + WHO) | The **Indicator System** (§3.5): fitness from the panel, metabolism + behaviour from the SZU file, **psychology + environment collected via a short self-report survey we design (the "Reported" layer)**, and WHO activity-guideline reference indicators. All five dimensions represented, each tagged by data layer. | A (+ mentors for collection) |
| **A2** | **SHAP + LIME + expert experience** → feature-recognition rule base | The **Rule Base** (§3.6): SHAP **and LIME** attributions from Progress Check, consolidated with mentor **expert rules** into one structured artifact. LIME is required, not optional. | C |
| **A3** | **Dynamic feature-update mechanism** ("continuous learning in response to new data") | The **Dynamic Update mechanism** (§3.7): a documented, coded procedure that re-fits, refreshes feature importances, and updates/prunes the feature set + rule base as a new test-year or survey wave arrives — demonstrated by replaying our cohorts over time. | C (+ A's pipeline) |

If any row is not green, Task A is not done — regardless of how polished the four student-facing
models are.

---

## 3. What we build

Two layers: the **student-facing models** (the product), and the **objective deliverables** (A1–A3
above, as first-class artifacts). They share code — the objective deliverables are mostly the
models plus the specific additions the brief names.

### Student-facing core

#### ① Scorecard — *"where do I stand, and what does passing need?"*
Raw results → official item scores, total, pass/fail, exactly per the national standard. The
scoring PDF encoded as a deterministic function; verified by reproducing the data's `total_score`.
No AI, no guessing. **Owner:** A. Ground truth for everything else.

#### ② Route-to-Pass ⭐ — *"what's the fastest way for me to pass?"*
Cheapest combination of improvements that crosses the pass line — exact search over the Scorecard's
known formula. Effort labels come from mentor expert rules, marked `PLACEHOLDER` until supplied.
The most novel, most useful result. **Owner:** A. **Guardrail:** arithmetic over a table, *not* a
causal promise; never proposes an unsafe/implausibly fast jump — those escalate to a coach.

#### ③ Progress Check — *"am I on track, and who needs help early?"*
From early-year results, predict the later outcome (`pass_scholarship` / g4 decline) with an
interpretable gradient-boosted model, and flag at-risk students. Explanations use **SHAP and LIME**
(this is the engine behind the A2 rule base). **Owner:** C. **Caveat:** a 4-year-ahead prediction
is fuzzy — a risk flag, not a crystal ball; report accuracy + uncertainty openly.

#### ④ Student Types — *"what kinds of students are there, so advice fits the person?"*
Per-student weakness profile + a small set of interpretable segments; pinpoints the
**non-athletic / low-baseline** group the system is for. EDA + light unsupervised learning.
**Owner:** B. **Guardrail:** for tailoring / teachers in aggregate — never a student-facing ranking.

### Objective deliverables (A1–A3)

#### ⑤ Indicator System (A1) — the five-dimension feature catalogue
A documented, typed catalogue of every indicator across **all five dimensions**, each tagged with
its **data layer** (Verified / Measured / Reported), unit, direction, and source:
- **Fitness** (Verified) — the 7 scored panel items + total/band.
- **Metabolism** (Measured) — SZU InBody body composition (body-fat %, skeletal muscle, BMR,
  waist-hip ratio) — explanatory only, never a weight target.
- **Behaviour** (Reported/Measured) — SZU exercise survey + **WHO activity-guideline reference
  indicators** (e.g. adult 150–300 min/week moderate activity, strength ≥2×/week).
- **Psychology** (Reported) — collected via a **short self-report survey we design**: mood/stress,
  motivation to be active, general wellbeing. Non-clinical, body-neutral.
- **Environment** (Reported) — same survey: access to facilities, active commute, study load,
  screen time, living situation.

**Deliverable:** the catalogue itself + the survey instrument + a pilot collection so every
dimension carries real (if small) data. **Owner:** A designs it; **collection needs mentor +
consent** (see §8). **Guardrail:** self-report (psychology/mood/environment) stays with the
student — teachers see only non-specific flags; minimal collection; no body-image/weight items.

#### ⑥ Feature-Recognition Rule Base (A2) — SHAP + LIME + expert
One structured artifact (JSON + readable table) that consolidates: Progress Check's **SHAP** global
+ per-segment importances, **LIME** local explanations for individual students, and mentor
**expert rules** (effort estimates + injury red-flags). Entry shape: *segment → top drivers →
direction → effect size → expert note*. This is the "feature-recognition rule base" the brief asks
for and the object Task B verbalizes. **Owner:** C, with expert-rule content from A/mentors.

#### ⑦ Dynamic Feature-Update Mechanism (A3) — continuous learning
A concrete, documented procedure (not a vague aspiration):
1. **Trigger** — a new test-year record, or a new self-report survey wave, arrives for a
   student/cohort.
2. **Update** — re-ingest, re-fit Progress Check, recompute SHAP/LIME importances, and refresh the
   rule base entries.
3. **Feature-set maintenance** — promote newly-informative indicators, prune features that stay
   uninformative across refits (stability check); version the feature set + rule base.
4. **Demonstration** — replay our own cohorts as if arriving over time (train on 2017–2021, then
   "receive" 2022–2023) and show the importances and rule base updating. This makes A3 real using
   data we already have, independent of new collection.
**Owner:** C, on top of A's pipeline.

### Optional
#### ⑧ Trust Check — explanation fidelity (research credibility)
Because the score is a known function of the items, measure whether SHAP recovers the true item
contributions → a fidelity number (proposal §6.1). Not student-facing; important for the paper.
**Owner:** C, if time allows.

---

## 4. What we keep lean (still cut)
- **Standalone trajectory-archetype clustering** → merged into Progress Check (overlapped with it
  and with existing labels).
- **Heavy phenotype clustering / factor analysis as a headline** → demoted to the weakness profile
  inside Student Types; clustering on absolute fitness mostly re-discovers high/medium/low.
- *(Note: "dynamic feature updating" is no longer cut — it is a required objective, ⑦.)*

---

## 5. The data we have (and the layer we must add)

Real data lives outside git (`.gitignore`). **The big panel and the SZU file can't be joined**
(different protocol/items/IDs/size).
- **Group 1 — PFT panel** (36,059 students): balanced 4-year panel (g1→g4), 7 fitness items +
  `total_score`, zero missingness. National reference. Workhorse.
- **Group 2 — team-derived labels** (`delta_score`, hand-cut segmentations, `pass_scholarship`,
  cohort/year aggregates).
- **Group 3 — SZU 2024 multidimensional** (297): body composition + behaviour survey. Pilot.
- **Scoring PDF** — the Scorecard's ground truth.
- **NEW — Reported layer** (to collect): the self-report survey for psychology + environment
  (+ richer behaviour). Required for A1; needs consent (§8).

**Core signal:** fitness declines g1→g4 (total 68.7 → 61.6; `delta` ≈ −7), concentrated in
endurance; ~27% miss the gate. **Injury is not in any file** → handled by guardrails, not modelled.

---

## 6. How Task A feeds Task B
One structured object per student — nothing else reaches the agent (proposal §5.4):
```
{
  indicators: five-dimension values, each tagged by data layer (⑤),
  score:      Scorecard — items, total, pass/fail (①),
  route:      Route-to-Pass — cheapest improvement(s), effort-labelled (②),
  progress:   Progress Check — on-track / at-risk flag + drivers (③, ⑥),
  type:       Student Types — segment + weakness profile (④),
  flags:      needs-human / escalation
}
```
Every field carries provenance so each generated sentence is tappable to its source.

---

## 7. Guardrails everyone holds (non-negotiable — `AGENTS.md`, proposal §7)
- **No weight-loss / caloric / body-image framing** — body composition is explanatory only.
- **Self-report stays with the student** — psychology/mood/environment answers never surface raw
  to a teacher, only as a non-specific flag; minimal collection.
- **Injury-safety is guardrail-based** — Route-to-Pass is capped to safe, plausible change;
  implausible jumps escalate to a human.
- **No student-facing peer ranking**; **directional, non-evaluative framing**; **escalation, not
  diagnosis.**

---

## 8. Open questions / dependencies (some block a whole objective)
1. **Self-report survey collection + consent/ethics** — **blocks A1's psychology + environment
   dimensions.** We design and pilot the instrument; actually fielding it to students needs mentor
   approval and consent. Raise immediately.
2. **Exact scholarship pass rule** — what score / grade / year qualifies. Progress Check and
   Route-to-Pass framing depend on it.
3. **Expert effort rules + injury red-flags** — content for Route-to-Pass and the A2 rule base.
4. **Will SZU longitudinal records arrive?** — would let the multidimensional pilot go longitudinal.
5. **How was the panel constructed** (some recent cohorts' g4 fall in future years)?

---

## 9. Team split & sequencing
| Person | Builds | Data |
|---|---|---|
| **A** (you) | ① Scorecard, ② Route-to-Pass, ⑤ Indicator System + self-report survey design, shared data loader, integration + hand-off object | scoring PDF, all CSVs, survey |
| **B** | ④ Student Types (EDA, weakness profiles, light clustering) | PFT panel, business_class |
| **C** | ③ Progress Check (SHAP **+ LIME**), ⑥ Rule Base, ⑦ Dynamic Update mechanism, ⑧ Trust Check (optional) | PFT panel, scholarship, business_class |

**Objective ownership:** A1 → A · A2 → C · A3 → C. No objective is unowned.

**Sequencing** — start in parallel (CSVs already carry scores). Foundation first (Scorecard +
loader + indicator schema). Survey design starts week 1 so consent/collection can run in parallel.
Join key is `student_id`. **One sync after ~week 1** to lock the hand-off object and confirm all
three objectives are on track — not at the end.

---

## 10. Definition of Done — Task A is finished only when every box is checked

Each person owns a block. When all three blocks are ticked, all of A1/A2/A3 and all four models
are delivered.

**Person A — Scorecard, Route-to-Pass, Indicator System (A1), integration**
- [ ] Scorecard reproduces the data's `total_score` within tolerance on the panel (verified).
- [ ] Route-to-Pass returns valid, safely-capped, effort-labelled routes for sample students.
- [ ] **A1:** Indicator System catalogue lists all **five** dimensions, each with ≥1 populated
  indicator (pilot data acceptable for psychology/environment), tagged by data layer, WHO reference
  indicators included; the self-report survey instrument exists and has a pilot response set.
- [ ] Shared `load_panel()` + indicator dictionary published for B and C to import.
- [ ] Hand-off object schema finalized and produced for sample students.

**Person B — Student Types (④)**
- [ ] EDA of the 7 items delivered (figures + written takeaways).
- [ ] Per-student weakness profile, keyed by `student_id`.
- [ ] Interpretable segments with plain-language profiles; the non-athletic/low-baseline group
  identified and characterized.
- [ ] Segments compared against the existing hand-cut labels, differences explained.
- [ ] Outputs importable by `student_id` into the hand-off object.

**Person C — Progress Check (③), Rule Base (A2), Dynamic Update (A3)**
- [ ] Progress Check model predicts a later outcome from early-year features; honest train/test
  metrics + calibration; per-student at-risk flag + probability.
- [ ] **A2:** both **SHAP and LIME** produced, consolidated with expert-rule hooks into the Rule
  Base file (segment → drivers → direction → effect size → expert note; expert notes may be
  `PLACEHOLDER` until mentors supply them).
- [ ] **A3:** Dynamic Update mechanism documented and working — a demo replaying cohorts over time
  shows importances and the rule base updating; feature set is versioned.
- [ ] (Optional) Trust Check fidelity number reported.

**Objective coverage check (must all be green):** A1 ✔ via Person A · A2 ✔ via Person C ·
A3 ✔ via Person C · models ①②④ + ③ owned. **Known risk:** A1's psychology/environment boxes
depend on consent to field the survey — Person A resolves this with the mentors in week 1.
