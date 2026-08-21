# Prompt to paste into Coze alongside this codebase

Copy everything below the line.

---

You are picking up an existing, working codebase — **APTAMS**, a university physical-fitness assessment system built for a Shenzhen University summer camp project. It is not a greenfield build. Read `AGENTS.md` first; it is the standing contract for this repo and it overrides any default habit you have.

## What this is

Two halves:

- **Task A** (the models) lives in `reference-taskA/` — a Python pipeline: a deterministic rule engine over the national scoring standard 《大学生国家体质健康测试评分标准》, an exact counterfactual route planner, a gradient-boosted risk model with treeSHAP attribution, and student segmentation. **This directory is vendored and read-only. Do not modify anything inside it.** If something there looks wrong, say so; do not fix it.
- **Task B** (the product) is everything else — a Next.js 16 app with a student interface, a teacher interface, and a provenance-locked chat agent.

The project's whole differentiator is that its explanations are *verifiable* rather than merely plausible. Every number on screen traces back to a published standard or a measured model. That property is easy to destroy by accident, which is what most of the rules below protect.

## Run it

```bash
pnpm install
node scripts/check-data.mjs    # data guard — must pass
pnpm dev                       # http://localhost:5000
```

Demo logins: student `90001` … `90240` password `aptams2026`; teacher `teacher` password `aptams-teacher`.

Verify before and after any change you make:

```bash
pnpm ts-check
pnpm lint --quiet
node scripts/check-data.mjs
node scripts/test-auth.mjs http://localhost:5000     # 29 assertions, all must pass
node scripts/test-intake.mjs http://localhost:5000   # 25 assertions, all must pass
```

## Hard constraints — do not violate these, even if asked

These are not style preferences. Each one was a real defect that was found and fixed; reintroducing any of them is a regression, not a refactor.

1. **Never run `scripts/precompute/build_reference_cohort.py`.** It writes 240 real students — real ids, measurements, predictions — into a file that gets committed and deployed. Use `build_synthetic_cohort.py`. `src/lib/aptams/data/cohort.json` must stay synthetic, ids in the 90000–99999 band. `check-data.mjs` enforces this; do not weaken or bypass that guard.

2. **Role comes from the signed session cookie and nothing else.** Never reintroduce `x-aptams-role`, `x-aptams-student-id`, or any client-supplied role or subject. The client must not be able to choose its own permissions. There is no default role: an unverifiable request is anonymous, not a student. `/api/students/me` takes the id from the session, so it can never be asked for somebody else.

3. **Teachers never see `teacher_visible: false` indicators** — mood, sleep, stress, screen time, motivation. Filtered server-side in `store.ts`, not in the UI. Never add an endpoint or a field that returns raw self-report to a teacher.

4. **Never hand-edit `university_2014.json`.** It is the scoring extractor's output and the single auditable origin of every score. Its sha256 is recorded in `university_2014.PROVENANCE.json` and asserted on every build. If a threshold looks wrong, report it — do not change it.

5. **Keep the injury safety cap.** `SAFETY_CAP_SD = 1.0` bounds every proposed change in `planner.ts`, and `bmi` is never actionable (a BMI route is weight-loss advice under another name). When no combination reaches the target within the cap, the plan sets `needs_human` and the UI escalates to a PE teacher. Never show a partial route as if it were achievable.

6. **Safety guardrails are structural.** `safetyCheck()` in `agent.ts` refuses weight-loss/caloric advice, clinical diagnosis, training through pain, rankings/leaderboards/streaks, and test cheating — *before* the LLM is called. Do not move these into the prompt; a prompt instruction is a request, and a code path is a guarantee.

7. **Every agent sentence must cite a source node that exists in the context.** `parseSentences()` drops ungrounded sentences before display. Do not relax this to make answers longer or friendlier.

8. **Routes are arithmetic, never causal.** They show one combination that reaches a target on the scoring table. They are not a promise that training produces the gain, and the wording must keep saying so.

9. **Non-evaluative framing throughout.** "Has improved since first year", never "you failed". No red failure styling, no streaks, no peer comparison.

10. **Teacher intake stays in memory.** `/api/students/intake` lets a teacher type a student's results or upload a class CSV, scored by the same engine as the cohort. Those records are held in memory and never written to disk — deliberately, because a teacher may enter a *real* student's real measurements and persisting them would put real records into the repo or the deployed bundle. Do not add file persistence. If it needs to survive a restart, that is a database with the same role-scoped access the API already enforces, and a decision for the team, not a quick fix.

11. **Never invent a prediction.** Intake students get a scorecard and a route, because both are exact arithmetic over the standard. They get no risk probability, no SHAP drivers and no segment, because those come from a model fitted on four-year trajectories and one sitting cannot support them. The record says `progress.available: false` and the UI shows that. Do not fill these in to make the page look complete.

12. **Groups are clustered on item SCORES, not raw values.** Task A model 4 runs KMeans over per-item scores because the standard has already normalised for sex and year group — 30 sit-ups and 10 pull-ups are not comparable, but the points each earns are. Clustering raw values would mostly rediscover who is male. Do not "improve" this by switching to raw measurements or by standardising the scores, which would distort distances the standard already made comparable.

13. **Manually entered students are `unsegmented`.** Assigning them to a cluster would require running KMeans server-side against a centroid set they were not fitted with. They are shown as their own group rather than guessed into one.

14. **Two groupings, and both are needed.** `segments` groups students by what they are weak at (KMeans, model 4). `trajectories` groups them by which direction they are moving (OLS slope over four sittings, `reference-taskA/analysis/trajectories.py`). Do not collapse them into one: a student comfortably above the gate but losing 3 points a year is invisible to the first and urgent in the second.

15. **The "is this a real trend" threshold is measured, not chosen.** A slope counts as rising or falling only past 0.5x the cohort's median residual scatter (1.75 points/year on the real panel). Do not replace it with a round number — without it the app would tell students they are declining on the strength of measurement noise. Students who cross the gate more than once carry `volatile: true` and the UI must keep hedging for them.

## Known open items you may work on

- **`training.ts` is labelled 可溯源 / "traceable" but carries no source ids.** It never enters the agent's provenance context, so nothing in it can be cited. It also fills a slot that is meant to hold mentor-supplied expert rules, with content that has not been reviewed by a PE professional. Either give its entries real provenance ids or show a "pending PE department review" banner. Do not simply delete the label and leave it.
- **`APTAMS_SESSION_SECRET` falls back to a fixed demo value** so the app runs unconfigured. Fine while all accounts are fake; must be set before real data.
- The teacher view does not surface `withheld_self_report` — the count of indicators withheld. The boundary holds, but the teacher is not told that something was withheld, which was part of the design.

## How to work

Small, verifiable changes. Run the checks above after each one. If a change would touch anything in the Hard Constraints list, stop and explain the tradeoff instead of proceeding — those rules exist because the system handles real students' health data and gets used to decide scholarship eligibility.

If you find something genuinely wrong, say so plainly rather than working around it. Report what you actually ran and what it actually returned; do not describe a test as passing unless you ran it.
