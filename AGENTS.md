# AGENTS.md — APTAMS

Adolescent/University Physical-fitness Assessment and Tracking & Monitoring
System. A Next.js 16 web app with a deterministic rule engine, an attributed
prediction layer, and a provenance-locked LLM agent.

## Tech stack

- Framework: Next.js 16 (App Router) + React 19 + TypeScript 5 (strict)
- UI: shadcn/ui (Radix) + Tailwind CSS 4
- LLM: `coze-coding-dev-sdk` (Doubao), streaming SSE
- Data precompute: Python 3 (numpy/pandas/scikit-learn/shap/lime) — build-time only

## Commands

```bash
pnpm install          # install
pnpm dev              # dev server (port from $DEPLOY_RUN_PORT, default 5000)
pnpm build            # production build
pnpm start            # production start
pnpm ts-check         # typecheck
pnpm lint --quiet     # lint

node scripts/check-data.mjs   # guard: cohort is synthetic, scoring tables match provenance
node scripts/test-auth.mjs    # 29 auth + privacy-boundary assertions (needs a running server)
node scripts/test-intake.mjs  # 25 teacher data-intake assertions (needs a running server)

# Rebuild the analytical cohort (build-time only; needs the real panel + Python deps):
python3 -m pip install -r requirements-analysis.txt
python3 scripts/precompute/build_synthetic_cohort.py   # writes src/lib/aptams/data/cohort.json
```

**Never run `scripts/precompute/build_reference_cohort.py`.** It emits 240 REAL
students — real ids, measurements and predictions — into a file that is committed
and shipped. It is kept only as the historical record of how the bridge was built.
Use `build_synthetic_cohort.py`, which draws individuals from per-(sex, grade)
aggregates of the real panel and is the only supported generator.

## Architecture

```
src/lib/aptams/
  types.ts          Shared domain types (layers, bands, risk, Student...)
  tables.ts         National-standard scoring-table loader (university_2014.json)
  engine.ts         Deterministic scorer: raw -> item scores -> weighted total -> band + bonus
  counterfactual.ts Exact non-causal "cheapest change to reach a target" search
  store.ts          Server store over precomputed cohort; ROLE PRIVACY BOUNDARY
  guidelines.ts     Small RAG corpus (WHO + national standard + safety clauses)
  training-kb.ts    Evidence-based per-item drill tips (zh/en/ko); injected as
                    citable `training:<item>` nodes by buildContext(). Deliberately
                    has NO weight-loss/calorie content; BMI is non-actionable.
  agent.ts          StructuredContext assembly, safety classifier, grounding
  prompt.ts         System prompt + sentence parsing / citation extraction
  language-context.tsx (in components/) Shared `lang` state + `lang` cookie,
                    synced across tabs; single source of truth for UI/agent locale
  session.ts        Signed HttpOnly session cookie (HMAC-SHA256) — the ONLY source of role
  credentials.ts    Hardcoded demo accounts; swap authenticate() for a real IdP later
  api-auth.ts       getSession()/requireRole() — role comes from the cookie, never a header
  planner.ts        UI route search; SAFETY_CAP_SD bounds every change, needs_human escalates
  intake.ts         Teacher data entry: CSV/manual parsing, validation, scoring via engine.ts

reference-taskA/analysis/trajectories.py  Trajectory classes over the four sittings
  data/
    university_2014.json  Extracted scoring tables (single source of truth)
    university_2014.PROVENANCE.json  sha256 + source, asserted by check-data.mjs
    cohort.json           240 SYNTHETIC students, ids 90001-90240
    cohort_sd.json        Per-(sex, grade) item SDs — aggregates only, the safety-cap unit

reference-taskA/          Vendored reference Task A pipeline (analysis/, aptams/, tests/)
scripts/precompute/build_synthetic_cohort.py  Generates the synthetic cohort (USE THIS)
scripts/precompute/build_reference_cohort.py  SUPERSEDED — emits real students, do not run
scripts/check-data.mjs    Build guard: synthetic cohort + scoring-table provenance
scripts/test-auth.mjs     Auth + privacy-boundary attack suite (29 assertions)

src/app/api/
  auth/login        POST credentials -> signed session cookie (role decided server-side)
  auth/logout       POST clear session
  auth/session      GET who am I (drives which interface renders)
  students/intake   POST manual rows or a CSV (teacher-only); GET the CSV template;
                    DELETE clears them. Intake lives IN MEMORY and is never written to
                    disk, so a teacher may enter real measurements without them being
                    retained. Do not add persistence without a real database + access
                    control; writing them to a file would put real records in the repo.
  students/me       GET the SIGNED-IN student's own record; id comes from the session
  students          GET teacher roster (teacher-only, triage metadata)
  students/[id]     GET teacher student view (self-report STRIPPED)
  cohort            GET teacher cohort aggregates, SEGMENT PROFILES + model fidelity
                    (teacher-only). Segment counts are recomputed live so intake
                    students appear; the profiles come from the build.
  guidelines        GET the RAG clause corpus
  agent/chat        POST SSE streaming agent (provenance-locked, safety-gated)
  agent/asr         POST base64 audio -> text (signed session required); the
                    in-browser chat also uses the Web Speech API for live
                    transcription, this route is the server-side fallback

src/components/
  aptams-shell.tsx   Thin shell: auth/data loading, top bar, ambient bg, AppNav,
                     view routing (coach/assessment/plan/cohort), login + intake sheet
  app-nav.tsx        Floating pill nav (desktop) / bottom dock (mobile)
  coach-chat.tsx     Coach home: streaming agent, voice + meal photo, glance strip,
                     prompt chips, provenance chips; exposes CoachHandle.ask()
  assessment-view.tsx Score ring (count-up), seven-item table, radar, four-year trend
  plan-view.tsx      Staged ladder + stage cards (buildStagedPlan/planRoutesForTotal)
  cohort-view.tsx    Teacher cohort: band distribution, SHAP drivers, segments, roster
  teacher-view.tsx   Cohort view + the selected student's assessment
  intake-card.tsx    Teacher manual/CSV data entry (in-memory only)
  markdown-text.tsx  MarkdownText + CitedAnswer (in-line citation chips)
  language-context.tsx Shared `lang` state + `lang` cookie, synced across tabs
scripts/verify-engine.ts            TS engine vs Python extractor cross-check
```

## Core design rules (do not violate)

1. **Determinism first.** `engine.ts` is the ground truth. The prediction model
   is *benchmarked against* it and must report its own uncertainty/fidelity.
   Never let the LLM recompute or second-guess a score.
2. **Epistemic layers.** Every fact is `verified | measured | reported`:
   - verified: test data + the national scoring standard
   - measured: model predictions/attributions (hedged as estimates)
   - reported: student self-report (subjective)
3. **Privacy boundary (per-indicator).** Teachers never receive indicators
   with `teacher_visible=false` (mood/sleep/screen-time/motivation/facility).
   Behaviour/fitness indicators (weekly active minutes, strength sessions) are
   visible to teachers; only the subjective psychology/environment self-report
   is withheld. Enforced in `store.ts getStudentForTeacher()` and the
   `/api/students/[id]` route, mirrored by `withheld_self_report` metadata.
4. **Provenance lock.** The agent gets a closed `StructuredContext`, never raw
   data. Every output sentence must cite a node that exists in the context;
   `validateGrounding`/`parseSentences` drops ungrounded sentences before they
   reach the UI.
5. **Counterfactuals are non-causal.** Routes are arithmetic over the scoring
   table, never promises that training will produce the gain. State this.
6. **Safety guardrails (structural, not just requested):**
   - No weight-loss / caloric-deficit / dietary-restriction advice.
   - No clinical diagnosis; escalate to PE teacher / clinician.
   - Never encourage training through pain.
   - No rankings, leaderboards, or streaks.
   - These are enforced in `agent.ts safetyCheck()` before the model is called.
7. **Non-evaluative framing.** "Has improved/declined since g1", not "you failed".
8. **Role is server-side, always.** `getSession()` reads a signed cookie. Never
   reintroduce `x-aptams-role` or any client-supplied role/subject header: the
   client would then choose its own permissions. There is no default role — an
   unverifiable request is anonymous, not a student.
9. **Never ship real student data.** `cohort.json` must stay synthetic (ids
   90001-99999). `check-data.mjs` fails the build otherwise, and that guard must
   not be weakened or bypassed.
10. **Injury safety cap.** Every proposed change is bounded by `SAFETY_CAP_SD`
    (1.0 cohort SD) and `bmi` is never actionable. When nothing reaches the
    target within the cap the plan sets `needs_human` and the UI escalates to a
    PE teacher — it must never show a partial route as if it were achievable.
11. **Scoring tables are never hand-edited.** They are the extractor's output.
    A changed threshold fails `check-data.mjs` against the recorded sha256.

## Verification

- The reference Task A pipeline (`reference-taskA/`) cross-checks the scoring
  table against the official PDF extractor: 83.8% of rows exact, 88.4% clean,
  93.2% within 1 point across 144,236 student-years. The scholarship pass rule
  resolves to total >= 60 (100% agreement).
- The Progress-Check model is a per-horizon scikit-learn
  `GradientBoostingClassifier` (tuned depth 2–4, early-stopped on staged log
  loss) with **isotonic probability calibration**, trained on the real PFT
  panel. The shipped model is the **g1 → g4** (3-year-ahead) horizon; g1 → g2,
  g1 → g3 and g1g2 → g4 are also fit and reported so the headline number is
  read on its own terms. Evaluation is honest about the cohort structure of the
  2024 scholarship panel: g1 → g4 spans two enrollments (2020, 2021) and is
  scored **leave-one-cohort-out** (held-out 2021), while g1 → g2 / g1 → g3 are a
  single intake each and use a stratified split with a percentile bootstrap CI.
  Shipped **g1 → g4 AUC 0.793 / Brier 0.178 / log-loss 0.539** on 5,157
  held-out students (the older 0.866 was an optimistic within-cohort split that
  blended easier horizons); out-of-fold CV gives AUC 0.804 ± 0.001. The support
  threshold is chosen for ≥80% recall of future failures (threshold ≈ 0.158,
  recall 0.98 / precision 0.70). Pre-winsorised sentinels (185 s endurance,
  1238 ml vital capacity, 6.5 s sprint) are masked as missing before training;
  BMI is dropped after a sensitivity check (|ΔAUC| = 0.001); a one-point
  monotonicity guard confirms no higher item score systematically lowers the
  pass probability (all horizons pass). TreeSHAP provides global + local
  attribution; the LIME path and the Trust Check (SHAP recovers the known
  linear total weights to R²=0.997 / MAE=0.006) remain. Every model carries a
  `model_version` hash (e.g. `pc-g1-g4-afce7b6a263c`). Run
  `python3 -m analysis.progress_check` to refit all four horizons and re-export
  the reports; run `python3 scripts/precompute/build_synthetic_cohort.py` to
  regenerate `cohort.json` from the shipped g1 → g4 model.

## Environment variables

- `COZE_API_KEY`, `COZE_BASE_URL`, `COZE_MODEL_BASE_URL`: LLM client config
  (provided by the sandbox; do not hardcode).
- `APTAMS_LLM_MODEL` (optional): override model id, default
  `doubao-seed-2-0-mini-260215`.
- `DEPLOY_RUN_PORT`: server port (read at runtime; never hardcode 5000).
- `APTAMS_SESSION_SECRET` (optional): HMAC key for session cookies. Falls back to
  a fixed demo value so the app runs unconfigured — safe only because every
  account is fake. Set it before this ever holds a real student record.

See `docs/coze-agent.md` for importing the assistant as a Coze bot.
