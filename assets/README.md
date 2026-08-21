# Handoff: APTAMS redesign — coach-first, performance-tech

## Overview

A full UI/UX redesign of the APTAMS student fitness-assessment app. It replaces the
warm-paper / pine-green stacked-card dashboard with a **near-black, high-contrast
performance-tech interface** where the **AI coach is the home screen** and assessment
data is reached on demand (or arrives inside the chat as data cards).

Four surfaces, one shell:

| View | Route idea | Purpose |
|---|---|---|
| **Coach** (home) | `/` | Empty chat + suggested prompts. Answers stream in with provenance chips and an animated data card. |
| **Assessment** | `/assessment` | Score ring (hero metric), seven items, radar profile, four-year trend. |
| **Plan** | `/plan` | Staged improvement ladder 52 → 62 → 71 → 80 with one active and two locked stages. |
| **Cohort** | `/cohort` | Teacher view: band distribution, SHAP drivers, KMeans clusters. |

## About the design files

`APTAMS Redesign.dc.html` and `APTAMS Current UI.dc.html` in this bundle are **design
references written in HTML** — working prototypes of the intended look and behaviour.
They are **not production code to copy**. The task is to recreate them in the existing
codebase: **Next.js 16 App Router + React + Tailwind CSS v4 + shadcn/ui**, using
`src/components/ui/*` primitives and the `cn()` helper, exactly as `README.md` in the
repo prescribes. Keep `pnpm`. Keep the server/auth/scoring layer untouched — this is a
presentation-layer change only.

`APTAMS Current UI.dc.html` is a recreation of what ships today (student 90001, English
locale), included so you can diff old vs new rather than guess.

## Fidelity

**High-fidelity.** Colours, typography, spacing, radii, animation durations and easings
below are final. Recreate pixel-perfectly with Tailwind utilities + shadcn components;
do not substitute your own palette.

---

## Design tokens

### Colour

| Token | Value | Use |
|---|---|---|
| `--background` | `#080908` | Page behind the app |
| `--surface-0` | `#0B0C0B` | App frame |
| `--surface-1` | `#101210` | Panels, composer, chips |
| `--surface-2` | `#0E100E` | Inset cards |
| `--surface-3` | `#15180F` | Bar tracks |
| `--panel-grad` | `linear-gradient(180deg,#101210,#0B0D0B)` | Data cards |
| `--border` | `#1E211B` | Card borders |
| `--border-strong` | `#2A2E25` | Interactive borders (nav, composer, chips) |
| `--hairline` | `#171A15` | Table row separators |
| `--foreground` | `#F2F4EF` | Primary text |
| `--foreground-2` | `#E6EAE1` | Body copy in bubbles / rows |
| `--muted` | `#8C918A` | Secondary text |
| `--muted-2` | `#6F756C` | Labels, monospace meta |
| `--muted-3` | `#5C6158` | Placeholder, inactive icons |
| `--muted-4` | `#4E5449` | Row numbers |
| `--accent` (lime) | `#C8FF3D` | Score, CTA, active nav, "good" data |
| `--accent-hover` | `#dcff7d` | Button hover |
| `--accent-wash` | `rgba(200,255,61,.14)` | Active nav pill fill |
| `--warn` | `#FF7A45` | Below-pass, failing items, risk |
| `--warn-soft` | `#FF9E75` | "Below pass" badge text |
| `--warn-wash` | `rgba(255,122,69,.14)` | "Below pass" badge fill |
| `--mid` | `#E8C55A` | Mid-band items (60–79 pts) |
| `--on-accent` | `#0A0B0A` | Text on lime |

**Item-score colour rule:** `points >= 80 → lime`, `>= 60 → mid`, else `warn`.
Applies to the item bars, the item point numbers, the radar vertices and the cohort bars.

### Typography

Google Fonts: `Archivo` (400–800), `Barlow` (400–700), `Barlow Condensed` (500–700),
`JetBrains Mono` (400–500).

| Role | Family | Spec |
|---|---|---|
| Hero headline | Archivo 700 | 52px / 1.02 / `-0.02em`, max 20ch |
| Big numbers (score) | Archivo 800 | 88px / 1 / `-0.05em` |
| Card metric | Archivo 700 | 44px / `-0.03em` |
| Section H2 | Archivo 700 | 40px / `-0.02em` |
| Card title | Archivo 700 | 26px / `-0.02em` |
| Item points | Archivo 700 | 19px |
| Section label | Barlow Condensed 600 | 22px, `0.1em`, uppercase |
| Card eyebrow | Barlow Condensed 600 | 17px, `0.1em`, uppercase |
| Nav / button | Barlow Condensed 600 | 15px, `0.1em`, uppercase |
| Body | Barlow 400 | 16px / 1.65 |
| Secondary body | Barlow 400 | 14px / 1.6 |
| Row label | Barlow 400/500 | 13–15px |
| Meta / provenance / axis | JetBrains Mono 400 | 10–12px, `0.1–0.2em`, uppercase |

### Spacing, radius, shadow

- Spacing scale in use: 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 28, 30, 34, 40 px.
- Radii: `999px` pills · `18px` composer, stage cards · `16px` data & panel cards ·
  `14px` glance cards, mobile prompts · `12px` inset rows, small buttons ·
  `10px` inner rows · `9–10px` logo tile.
- Frame shadow: `0 40px 120px -40px rgba(0,0,0,.9)`.
- Nav shadow: `0 18px 50px -18px rgba(0,0,0,.9)`.
- Nav / composer: `backdrop-filter: blur(14px)` / `blur(8px)`.

---

## Screens

### 1. Shell (all views)

- Frame: `1240 × 840` desktop reference; full-viewport in production.
  Mobile reference frame `390 × 840`.
- **Top bar** — 20px/28px padding, bottom `1px solid #1B1E18`.
  - Left: 34px lime rounded-10px tile with `A` (Archivo 800, 17px, `#0A0B0A`);
    then `APTAMS` (Archivo 700, 16px, `0.12em`) over
    `VERIFIED FITNESS INTELLIGENCE` (mono 10px, `0.1em`, uppercase, `--muted-2`).
  - Right: risk pill (`needs support`, 6px `--warn` dot pulsing) and identity pill
    (24px gradient avatar `linear-gradient(140deg,#C8FF3D,#6E8F1F)` + `90001 · Y4`).
    Both: `1px solid #262A22`, `background #101210`, `999px`, mono 11px.
- **Nav — floating pill, desktop.** Absolutely positioned, `bottom:24px`, centred,
  `z-index:20`. Container: 6px padding, `999px`, `1px solid #2A2E25`,
  `rgba(12,14,12,.86)` + blur. Items: `Coach · Assessment · Plan · Cohort`,
  10px/20px padding, 6px leading dot. Active: `rgba(200,255,61,.14)` fill, lime text
  and dot. Inactive: transparent, `--muted` text, `#2E332A` dot. Hover → lime text.
  Transition `all .25s cubic-bezier(.2,.8,.2,1)`.
- **Nav — bottom dock, mobile.** Four items (`Coach ◆ / Score ◎ / Plan ▲ / More ≡`),
  66px wide each, icon 17px over Barlow Condensed 11px `0.1em` uppercase label,
  active lime / inactive `#5C6158`. Above it, a tap-to-open composer row
  (`Ask your coach…`, 32px lime send tile). Whole dock sits on
  `linear-gradient(180deg,transparent,#0B0C0B 32%)`.
- **Ambient background** (decorative, `aria-hidden`, `pointer-events:none`):
  two blurred radial glows — lime `rgba(200,255,61,.10)` top-left 62%×78%,
  blue `rgba(120,180,255,.07)` bottom-right — animated with `drift`
  (22s and 28s, `ease-in-out infinite`, second reversed), `filter: blur(30px)`.

### 2. Coach (home)

Content column `820px`, centred.

**Empty state**
- Eyebrow `COACH` — mono 11px, `0.18em`, uppercase, lime.
- Headline “**Ask about your body, not your grade.**” — Archivo 700, 52px, max 20ch.
- Sub “Every answer is built from your four sittings and cites the record it came from.
  Nothing without a source gets shown.” — 16px/1.6, `--muted`, max 56ch.
- **Prompt chips** — wrapping row, 10px gap, max-width 760px. Each: 11px/16px padding,
  `999px`, `1px solid #2A2E25`, `#101210`, `#D6DBD1`, Barlow 14px, `white-space:nowrap`.
  Hover: lime background, `#0A0B0A` text, lime border, `translateY(-2px)`, `.22s ease`.
  Copy (exact, in order):
  1. `Why did my score drop this year?`
  2. `What's my fastest path to 80?`
  3. `Show me my weakest item`
  4. `Build me a 4-week plan`
  5. `Am I on track to pass?`
  6. `How do I improve my endurance run?`
  7. `Explain my radar profile`
- **Glance strip** — three equal cards, 14px gap, 16px/18px padding, `14px` radius,
  `1px solid #1E211B`, `--panel-grad`. Each: mono 10px `0.14em` uppercase label,
  Archivo 700 30px value, 13px `--muted` note.
  `Year 4 total / 52.0 / 8 points below the pass line` (warn) ·
  `Chance of passing / 17% / risk flag, not a forecast` (warn) ·
  `Cheapest points / +40 / endurance run, one band` (lime).

**Conversation state** — scrollable column, max-height 560px, 20px gap.
- User bubble: right-aligned, lime fill, `#0A0B0A`, `18px 18px 4px 18px`,
  12px/18px padding, 15px/500.
- Assistant turn: 28px square avatar (`◆`, lime on `#1A1D18`, `1px solid #2A2E25`,
  `9px` radius) + column, 14px gap:
  - answer text 16px/1.65 `#E6EAE1`, typed at ~3 chars per 18ms with a lime `▍`
    caret blinking at 1s step-end while streaming;
  - **provenance chips** (after streaming): mono 10px, 3px/8px, `6px` radius,
    `1px solid #2A2E25`, `#0E100E`, `--muted` — e.g. `✓ score:strength`,
    `~ route:balanced`, `◐ training:template`;
  - **data card** — 560px, `16px` radius, `1px solid #23261F`, `--panel-grad`,
    `popIn .5s .1s`. Header row (16px/20px, bottom `1px solid #1B1E18`): lime mono
    10px `0.16em` uppercase label, right-side mono 10px provenance note. Body (20px):
    Archivo 700 44px metric + Barlow Condensed 16px `0.08em` uppercase unit,
    14px `--muted` note, then 3–4 rows of `150px label / 6px bar / 74px mono value`,
    bars staggered `barFill .9s cubic-bezier(.2,.8,.2,1)` at 0.15 + i·0.10s.
- **Composer** — 820px, 18px radius, `1px solid #2A2E25`, `rgba(16,18,16,.9)` + blur,
  12px/14px/12px/20px padding: transparent 16px input (`Ask your coach…`),
  38px mic toggle (`12px` radius, lime fill when armed), lime **SEND** button
  (Barlow Condensed 15px `0.08em` uppercase, hover `#dcff7d` + `translateY(-1px)`).

### 3. Assessment

Two columns, 34px gap; 30px/40px padding with 110px bottom clearance for the nav.

- **Left, 300px** — score ring, `300×300` SVG viewBox `0 0 300 300`:
  track `circle r=120 stroke #191C16 strokeWidth 14`; value arc same geometry,
  `--warn`, `strokeLinecap round`, `dasharray 754`, `dashoffset 754*(1-0.52)`,
  `rotate(-90 150 150)`, animated `ringDraw 1.5s cubic-bezier(.2,.8,.2,1)`
  (`from { stroke-dashoffset: 754 }`); pass-line notch = 5px circle at 60% of the
  sweep, `#0B0C0B` fill with 2.5px lime stroke.
  Centre stack: Archivo 800 88px `52` (count-up 0→52 over 1400ms, cubic ease-out),
  mono 11px `0.2em` `/ 100 · Y4`, then `BELOW PASS` badge (Barlow Condensed 15px 700
  `0.14em` uppercase, `--warn-wash` fill, `--warn-soft` text, `999px`, 4px/12px).
  Below: three gate rows (`to pass · 60 → +8.0` warn, `to good · 80 → +28.0` mid,
  `since year 1 → +2.2` lime) — 11px/15px padding, `12px` radius,
  `1px solid #1E211B`, `#0E100E`.
- **Right** — “SEVEN ITEMS” label with mono note `✓ verified · GB/T 2014 standard`.
  Rows separated by `1px solid #171A15`, 13px vertical padding, hover
  `rgba(200,255,61,.03)`. Columns: 26px mono index (`01`…`07`), 170px label,
  96px mono raw value, flexible 8px bar on `#15180F`, 64px right-aligned Archivo 700
  19px points. Bars animate `barFill 1s cubic-bezier(.2,.8,.2,1)` staggered
  0.2 + i·0.07s; widths `max(2%, points%)`.
  Then two side-by-side panels (20px padding, `16px` radius, `1px solid #1E211B`,
  `--panel-grad`):
  - **PROFILE** — 7-axis radar, viewBox `0 0 280 240`, centre (140,118), R 84.
    Rings at 25/50/75/100% (`#1D2018`, the 75% ring `rgba(200,255,61,.22)`), spokes
    `#1D2018`. Data polygon: lime 2px stroke drawn with `pathDraw 1.8s
    cubic-bezier(.3,.7,.3,1)` (`dasharray 900`, `from { dashoffset: 900 }`), fill
    `rgba(200,255,61,.13)` faded in `fade 1.2s .5s`. Vertices 3.2px, colour by band,
    `popIn .4s` at 0.9 + i·0.07s. Axis labels mono 9.5px `0.1em`:
    `BMI LUNG 50M JUMP REACH RUN STR`.
  - **FOUR YEARS** — line chart, viewBox `0 0 300 168`, values `49.8, 68.9, 59.8, 52.0`,
    y-range 44–74. Dashed lime pass line at 60 (`4 5`, `rgba(200,255,61,.35)`) labelled
    `PASS 60`. Polyline lime 2px, `pathDraw 1.6s .2s`. Points 3.6px (last one 5px),
    lime above the gate / warn below, `#0B0D0B` 2px halo, `popIn .4s` at
    0.5 + i·0.22s; Archivo 700 11px value labels; mono 9.5px `Y1…Y4` axis, active year
    `#E6EAE1`. Header right: mono 11px `−0.25 pts/yr` in warn. Footnote 12px
    `--muted-2`: “Crossed the pass line twice — the direction is less settled than the
    label suggests.”

### 4. Plan

- Header: lime mono eyebrow `STAGED PLAN`, Archivo 700 40px
  “52 → 80, in three stages”, right-aligned mono disclaimer “Scoring-table arithmetic.
  Not a training promise.”
- **Ladder** — four nodes 104px wide (Archivo 700 28px score over mono 10px `0.12em`
  uppercase tag): `52 now` (warn) → `62 stage 1` (mid) → `71 stage 2` (mid) →
  `80 target` (lime). Connectors: 88×2px `linear-gradient(90deg, nodeColour, #2A2E25)`
  with a 40%-wide lime highlight animating `sweep 2.6s linear infinite`, delays 0s /
  0.8s / 1.6s.
- **Three stage cards** — equal grid, 18px gap, 22px padding, `18px` radius.
  Active: `1px solid rgba(200,255,61,.35)`,
  `linear-gradient(180deg,rgba(200,255,61,.07),#0C0E0C)`, lime tag, state `in progress`.
  Locked: `1px solid #1E211B`, `#0C0E0C`, `--muted` tag, state `locked`.
  Contents: Barlow Condensed 16px 700 `0.12em` uppercase tag + mono 10px state;
  Archivo 700 26px title; 14px/1.6 `--muted` body; then move rows
  (10px/12px, `10px` radius, `rgba(255,255,255,.03)`, 13px label + lime mono delta).
  Hover: `translateY(-4px)` + lime border, `.25s ease`. Entrance `rise .6s` at
  0.16 / 0.24 / 0.32s.
  Copy: **Aerobic base** — “One item, one block. Endurance from 293 s to 266 s is a
  single scoring band and covers the pass line on its own.” (`Endurance run +20 pts`,
  `Vital capacity +6 pts`) · **Speed & spring** — “Sprint and jump share the load once
  the aerobic base holds. Neither move exceeds one cohort standard deviation.”
  (`50 m sprint +10 pts`, `Standing long jump +8 pts`) · **Strength floor** —
  “Sit-ups have scored zero twice. Sixteen reps is the first band, and it is the last
  eight points to 80.” (`Strength · sit-ups +10 pts`, `Endurance run +10 pts`).
- Footer strip: 20px/24px, `16px` radius, `1px dashed #2A2E25`, Archivo 600 15px
  “Trained the block? Re-enter your numbers and the engine re-scores you.” +
  lime **SELF-ASSESS** button.

### 5. Cohort (teacher)

- Header: lime mono `TEACHER · COHORT 2021`, Archivo 700 40px
  “240 students, 41% needing support”, right-aligned mono
  `GBM + isotonic calibration / acc 73.3 · auc 79.3 · brier .178`.
- **Band distribution** (1.15fr) — 190px-tall column chart, 14px gap. Bars bottom-aligned
  with `8px 8px 0 0` radius; Archivo 700 20px count above, Barlow Condensed 13px
  `0.1em` uppercase label below. `Excellent 0` (`#2E332A`, 3%) · `Good 10` (mid, 12%) ·
  `Pass 119` (lime, 100%) · `Fail 111` (warn, 93%). Entrance `rise .8s`, staggered
  0.1 → 0.34s.
- **SHAP drivers** (1fr) — rows of `132px label / 7px bar on #15180F / 44px mono value`:
  Standing long jump 27% (lime, 100%) · Endurance run 24% (lime, 90%) ·
  Sit and reach 12% (mid, 45%) · Strength 11% (mid, 42%) · 50 m sprint 8% (`#5C6158`,
  31%) · Vital capacity 6% (`#5C6158`, 23%). `barFill 1s` staggered 0.1 → 0.5s.
- **Cluster cards** — four-column grid, 16px gap, 20px padding, `16px` radius,
  `1px solid #1E211B`, `#0E100E`. Archivo 700 30px lime count; Barlow Condensed 15px
  600 `0.06em` uppercase name; 13px/1.5 `--muted` note; 5px lime progress bar pinned to
  the bottom. Hover lime border + `translateY(-3px)`.
  `90 Endurance headroom — 44% below the gate. Mean 60.0.` (100%) ·
  `52 Broad headroom — 69% below the gate. Mean 54.1.` (58%) ·
  `51 Lung capacity headroom — 10% below the gate. Mean 71.1.` (57%) ·
  `47 Explosive power headroom — 64% below the gate. Mean 56.0.` (52%).

---

## Interactions & behaviour

- **Nav** switches view. Entering **Assessment** resets the score to 0 and replays the
  count-up and every entrance animation (remount the subtree, or key it on the view).
- **Prompt chip / Enter / Send** appends a user bubble and an assistant turn, then types
  the answer character-wise (3 chars / 18ms). Provenance chips and the data card mount
  only *after* typing completes.
- **Mic button** is a visual toggle in the prototype; wire it to the existing Web Speech
  API code in `coach-chat.tsx` (`getSpeechRecognition`, `zh-CN`/`en-US`/`ko-KR`).
- **Hover states**: prompt chips invert to lime; stage and cluster cards lift 3–4px and
  take a lime border; item rows get a 3%-lime wash; nav items go lime.
- **Responsive**: below ~1100px collapse Assessment to one column (ring above items),
  Plan and Cluster grids to one column, SHAP/band panels stack; swap the floating pill
  nav for the bottom dock at the `md` breakpoint (`use-mobile.ts` already exists).
- **Reduced motion**: `@media (prefers-reduced-motion: reduce)` forces
  `animation-duration: .001ms` and `animation-iteration-count: 1` — the repo's
  `globals.css` already does this; keep it.

### Keyframes (copy verbatim)

```css
@keyframes rise     { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:none; } }
@keyframes fade     { from { opacity:0; } to { opacity:1; } }
@keyframes ringDraw { from { stroke-dashoffset:754; } }
@keyframes pathDraw { from { stroke-dashoffset:900; } }
@keyframes barFill  { from { width:0; } }
@keyframes popIn    { from { opacity:0; transform:scale(.9); } to { opacity:1; transform:none; } }
@keyframes drift    { 0%{transform:translate3d(0,0,0) scale(1);} 50%{transform:translate3d(3%,-4%,0) scale(1.12);} 100%{transform:translate3d(0,0,0) scale(1);} }
@keyframes blink    { 0%,49%{opacity:1;} 50%,100%{opacity:0;} }
@keyframes pulseDot { 0%,100%{opacity:.35; transform:scale(1);} 50%{opacity:1; transform:scale(1.35);} }
@keyframes sweep    { from { transform:translateX(-100%); } to { transform:translateX(220%); } }
```

Entrance rule of thumb: `rise .6–.8s ease-out both`, delay `0.06s × index`.

---

## State management

Everything the prototype needs, per view:

```ts
view: "coach" | "assess" | "plan" | "cohort"   // or App Router segments
messages: Array<{ role: "user" | "assistant"; text: string; typing?: boolean;
                  sources?: { mark: "✓"|"~"|"◐"; id: string }[];
                  card?: { label: string; prov: string; metric: string; unit: string;
                           note: string; rows: { label: string; value: string;
                           pct: string; color: string }[] } }>
draft: string
mic: boolean
scoreShown: number    // count-up target
streaming: boolean
```

Data comes from the existing API surface, unchanged:
`fetchSession`, `fetchMe`, `fetchStudent`, `fetchCohort`, `fetchRoster`, `streamChat`.
The score ring, item rows, radar and trend all read `student.score.items`,
`student.score.total`, `student.score.pass_threshold` and `student.history`. The plan
ladder is `buildStagedPlan` from `src/lib/aptams/stages.ts`; the moves are
`planRoutes` from `planner.ts`. Cohort figures are `CohortResponse.aggregates`,
`.segments` and `.progress_model.global_importance`. **Do not hardcode the numbers in
this document** — they are student 90001 and cohort 2021, used so you can verify your
rendering matches the reference.

### Provenance mapping

Replaces the paragraph-length disclaimers in the current UI:

| Layer | Chip | Colour |
|---|---|---|
| `verified` | `✓` | `--muted` on `#0E100E` |
| `measured` / predicted | `~` | `--muted` on `#0E100E` |
| `reported` / template | `◐` | `--muted` on `#0E100E` |

Long caveats (`nonCausal`, `trainingNonCausal`, `escalation`, `noWeight`) move into an
info popover on the relevant card header, or a single mono footnote line — never a
paragraph in the content flow.

## Assets

None. No images, no icon font. The four glyphs used are text characters
(`◆ ◎ ▲ ≡ →`) and one inline mic SVG (Lucide `mic`, already a dependency:
`lucide-react`). Fonts load from Google Fonts — swap to `next/font` for production.

## Files

- `APTAMS Redesign.dc.html` — the new design, all four views, all animations, clickable.
- `APTAMS Current UI.dc.html` — recreation of the shipping UI, for diffing.
- `COZE_TASK.md` — a paste-ready task prompt for the Coze CLI.
- `theme.css` — the token block to replace `:root` / `.dark` in `src/app/globals.css`.
