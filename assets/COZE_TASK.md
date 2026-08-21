# Task: implement the APTAMS redesign

Paste this into the Coze CLI from the repo root, with `design_handoff_aptams_redesign/`
copied into the project.

---

Read `design_handoff_aptams_redesign/README.md` in full before writing any code, then
open `design_handoff_aptams_redesign/APTAMS Redesign.dc.html` in a browser and click
through all four views so you can see the intended motion. Ignore `DESIGN.md` at the
repo root — it describes the old warm-paper direction and is superseded.

## What to build

A presentation-layer redesign of the student and teacher app. Near-black
performance-tech, single lime accent, coach-first: the AI coach is the home screen and
assessment data is reached from a floating pill nav (desktop) or bottom dock (mobile).

Do **not** touch: `src/app/api/**`, `src/lib/aptams/**` (engine, planner, stages,
scoring), `src/lib/api.ts`, auth/session/cookie handling, or the intake pipeline. The
scoring engine and the provenance model are the product; this task changes only how
they are shown.

## Steps

1. **Tokens.** Replace the `:root` and `.dark` blocks in `src/app/globals.css` with
   `design_handoff_aptams_redesign/theme.css`, and append the keyframes and
   `body::before` from `globals-additions.txt`. Keep the existing
   `prefers-reduced-motion` block. Keep `Noto Sans SC` in the `--font-sans` stack after
   `Barlow` so zh/ko still render — see the note in `globals-additions.txt`.
   Load Archivo / Barlow / Barlow Condensed / JetBrains Mono via `next/font` in
   `src/app/layout.tsx`.

2. **Shell.** Rewrite `src/components/aptams-shell.tsx` as a thin layout: top bar
   (logo, risk pill, identity pill), the animated ambient background, the view
   container, and the nav. Split the nav into `AppNav` (floating pill, `md` and up) and
   `AppDock` (bottom dock, below `md`) using the existing `src/hooks/use-mobile.ts`.
   Role still comes from the signed session cookie — never from client state.

3. **Views.** One component per surface, in `src/components/`:
   - `coach-home.tsx` — refactor of `coach-chat.tsx`. Keep `streamChat`, the citation
     parsing in `markdown-text.tsx`, and the Web Speech API code
     (`getSpeechRecognition`, `zh-CN`/`en-US`/`ko-KR`) exactly as they are; restyle the
     bubbles, add the seven suggested-prompt chips, the three-card glance strip, and
     the assistant **data card** (see README §2 for its exact anatomy). Typing effect:
     the real answer already streams from the API, so use the live stream rather than a
     fake typewriter — the blinking lime caret shows while `streaming` is true.
   - `assessment-view.tsx` — score ring with count-up + pass-line notch, seven-item
     table with staggered bars, 7-axis radar, four-year trend. Geometry, viewBoxes,
     dash lengths, easings and stagger delays are all specified in README §3. Read
     `student.score.items`, `.total`, `.pass_threshold` and `student.history`.
   - `plan-view.tsx` — the staged ladder and three stage cards, driven by
     `buildStagedPlan` (`src/lib/aptams/stages.ts`) and `planRoutes`
     (`src/lib/aptams/planner.ts`). Keep the self-assessment flow and its
     localStorage persistence.
   - `cohort-view.tsx` — teacher surface: band distribution, SHAP drivers, cluster
     cards, from `CohortResponse.aggregates`, `.segments` and
     `.progress_model.global_importance`. Keep the roster search/filter behaviour but
     move it behind a slide-over rather than a permanent column.

4. **Provenance.** Replace every paragraph-length disclaimer with the inline chip
   system: `✓` verified, `~` measured/predicted, `◐` reported/template. Long caveats
   (`nonCausal`, `trainingNonCausal`, `escalation`, `noWeight` in `src/lib/i18n.ts`)
   move into a shadcn `Popover` on the relevant card header, or one mono footnote line.
   Do not delete any of them — they are compliance copy. All three locales must keep
   working; add any new UI strings to all of `zh`, `en`, `ko` in `i18n.ts`.

5. **shadcn.** Compose from `src/components/ui/*` — `Card`, `Badge`, `Button`,
   `Popover`, `Tabs`, `Sheet`, `Select`, `Progress`, `Input` — plus `cn()`. Do not
   hand-roll primitives that already exist. Use Tailwind utilities against the new
   tokens rather than inline styles; the prototype uses inline styles only because it
   is a single-file design reference.

6. **Verify.** Run `coze-dev dev`, sign in as `90001 / aptams2026`, and compare each
   view against the prototype at the same width. The prototype's numbers are student
   90001 and cohort 2021 — if your rendering shows different numbers, the binding is
   wrong, not the design. Then check `teacher / aptams-teacher` for the cohort view,
   switch to 中文 and 한국어 to confirm nothing overflows, and test at 390px wide.

## Constraints

- `pnpm` only.
- TypeScript throughout, `@/` path alias.
- Server components by default; `"use client"` only where state or the Web Speech API
  requires it.
- Respect `prefers-reduced-motion`: every animation in this design is decorative and
  must be safely removable.
- Minimum hit target 44px on mobile.
- The seven items are sex-aware: the strength slot is pull-ups for men and 1-minute
  sit-ups for women. Keep `itemLabel()`'s behaviour.
