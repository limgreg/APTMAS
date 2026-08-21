# Task A → Task B Handoff

**For the Task B team (LLM agent, knowledge graph, RAG, PWA).** This is the interface between the
two halves of APTAMS: what Task A produces, and the **frozen shape** of the object your agent
consumes. Build against the schema and the synthetic fixtures **now** — you do not need to wait for
Task A's real models. When the real models land, they emit the same shape, so nothing you build
needs rewiring.

> **Status: DRAFT contract, v0.1.** Ratify at the first cross-team sync, then freeze. `schema_version`
> is carried in every object so changes are explicit. This doc is subordinate to `AGENTS.md` and
> `docs/proposal.md` (§5 for the agent/provenance rules).

---

## 1. What Task A gives you

Task A turns a student's fitness records into a single structured object. Four models produce it:

| Model | Produces | Field it fills |
|---|---|---|
| **Scorecard** | Official item scores, total, grade band, pass/fail (deterministic — the national standard) | `score` |
| **Route-to-Pass** | Cheapest improvement(s) that would reach a pass — exact arithmetic, **not** a causal training claim | `route` |
| **Progress Check** | On-track / at-risk flag + probability, with the drivers behind it (SHAP + LIME) | `progress` |
| **Student Types** | The student's segment + weakness profile | `type` |
| **Indicator System** | Values across all five dimensions (fitness, metabolism, psychology, environment, behaviour), each tagged by data layer | `indicators` |

**Your agent never sees raw records** — only this object (proposal §5.4). Every sentence it
generates must cite a provenance id that exists in the object (§4).

---

## 2. The frozen hand-off object (the contract)

One object per student per evaluation point. Annotated example (an at-risk freshman):

```json
{
  "schema_version": "0.1",
  "student_id": "00001",
  "meta": {
    "sex": "female",              // "female" | "male"
    "grade": "g1",                // "g1" | "g2" | "g3" | "g4" (freshman→senior)
    "cohort_year": 2020,
    "as_of": "2020-11-01"
  },

  "score": {                       // from Scorecard — data layer: VERIFIED (exact)
    "items": [
      { "indicator_id": "endurance_run", "raw": 254.0, "unit": "s",
        "points": 62, "band": "及格", "provenance": "score:endurance_run" },
      { "indicator_id": "sit_and_reach", "raw": 12.1, "unit": "cm",
        "points": 66, "band": "及格", "provenance": "score:sit_and_reach" }
      // ... one entry per scored item
    ],
    "total": 58.2,
    "band": "不及格",              // "优秀" | "良好" | "及格" | "不及格"
    "pass": false,                 // against the scholarship threshold (rule TBC from mentors)
    "provenance": "score:total"
  },

  "route": {                       // from Route-to-Pass — VERIFIED arithmetic, NON-causal
    "target": "pass",              // "pass" | "next_band"
    "options": [
      { "id": "r1",
        "changes": [ { "indicator_id": "sit_and_reach", "delta": 3.0, "unit": "cm" } ],
        "effort_estimate": "~2 weeks of consistent stretching",
        "effort_is_placeholder": true,
        "provenance": "route:r1" },
      { "id": "r2",
        "changes": [ { "indicator_id": "endurance_run", "delta": -12.0, "unit": "s" } ],
        "effort_estimate": "~6 weeks of conditioning",
        "effort_is_placeholder": true,
        "provenance": "route:r2" }
    ],
    "needs_human": false,          // true when the only routes require unsafe/implausible change
    "causal": false                // ALWAYS false — routes are table arithmetic, not promises
  },

  "progress": {                    // from Progress Check — layer: MEASURED/PREDICTED (a risk flag)
    "on_track": false,
    "risk": "at_risk",             // "on_track" | "watch" | "at_risk"
    "pass_probability": 0.41,
    "uncertainty": "wide — 4-year projection from g1 only",
    "drivers": [
      { "indicator_id": "endurance_run", "direction": "worse", "strength": 0.31,
        "method": "shap", "provenance": "driver:endurance_run" },
      { "indicator_id": "strength", "direction": "worse", "strength": 0.18,
        "method": "shap", "provenance": "driver:strength" }
    ],
    "provenance": "progress:flag"
  },

  "type": {                        // from Student Types
    "segment_id": "low_endurance",
    "segment_label_zh": "耐力薄弱型",
    "segment_label_en": "Low-endurance",
    "weaknesses": ["endurance_run", "sit_and_reach"],
    "provenance": "type:segment"
  },

  "indicators": [                  // from the Indicator System — every dimension, layer-tagged
    { "indicator_id": "bmi",        "dimension": "fitness",     "layer": "verified",
      "value": 22.4, "unit": "kg/m2", "teacher_visible": true,  "provenance": "ind:bmi" },
    { "indicator_id": "body_fat_pct","dimension": "metabolism", "layer": "measured",
      "value": 26.0, "unit": "%",     "teacher_visible": true,  "provenance": "ind:body_fat_pct" },
    { "indicator_id": "weekly_active_min","dimension": "behaviour","layer": "reported",
      "value": 90,   "unit": "min/wk","teacher_visible": true,  "provenance": "ind:weekly_active_min",
      "reference": { "who_min": 150, "who_max": 300 } },
    { "indicator_id": "mood",        "dimension": "psychology",  "layer": "reported",
      "value": "low", "unit": null,   "teacher_visible": false, "provenance": "ind:mood" },
    { "indicator_id": "facility_access","dimension": "environment","layer": "reported",
      "value": "limited", "unit": null,"teacher_visible": false,"provenance": "ind:facility_access" }
  ],

  "flags": ["at_risk"]             // e.g. "at_risk" | "needs_human" | "growth_context"
}
```

### Field rules Task B can rely on
- **Every value-bearing node has a `provenance` id.** The agent may only assert things tied to one
  of these ids (§4). Ids are stable strings, unique within the object.
- **`score` is exact; `route` is exact-but-non-causal; `progress` is a fuzzy risk flag.** Your
  wording must match that certainty — "you have passed X" vs "one route to a pass is…" vs "you may
  be at risk". Never state a route as a promise (`causal` is always `false`).
- **`layer`** is one of `verified | measured | reported`, in descending claim strength. A sentence
  combining fields inherits the weakest layer involved.
- **`teacher_visible`** — `reported` psychology/environment indicators are `false`. **Never render
  these in a teacher-facing view**; teachers get only a non-specific flag. This is enforced
  server-side too, but your UI must honor it.
- **Bilingual** — segment labels ship `_zh` and `_en`; all agent output is i18n'd.

---

## 3. Enumerations (freeze these)

- `sex`: `female | male`
- `grade`: `g1 | g2 | g3 | g4`
- `band`: `优秀 | 良好 | 及格 | 不及格`
- `risk`: `on_track | watch | at_risk`
- `layer`: `verified | measured | reported`
- `dimension`: `fitness | metabolism | behaviour | psychology | environment`
- `flags` (open set, additive): `at_risk | needs_human | growth_context`
- scored `indicator_id`s (fitness): `bmi, vital_capacity, sprint_50m, standing_long_jump,
  sit_and_reach, endurance_run, strength`. The full indicator dictionary (all dimensions, with
  units/direction) is published by Task A Person A; treat ids as the controlled vocabulary for your
  knowledge-graph nodes.

---

## 4. How the agent must stay grounded (provenance lock)

The scaffold already encodes this in `aptams/agent/provenance.py`:
- The agent receives a `StructuredContext` built from the object above — a closed set of
  provenance-bearing nodes and retrieved guideline clauses. **It gets nothing else.**
- Each output sentence is a `ProvenancedSentence { text, source_node_ids }`.
- `validate_grounding()` rejects any sentence that cites nothing, or cites an id not in the object.
  A sentence that fails is not shown.

So your generation step must attach, to every sentence, the `provenance` id(s) it rests on. Build
your prompt/templating around that from the start — alignment is enforced structurally, not by
asking the model nicely (proposal §5.4).

---

## 5. RAG corpus (what to ingest now)

The agent retrieves guideline text and cites clause ids. Start ingesting:
- **The national scoring standard** — 大学生国家体质健康测试评分标准 (Task A holds the PDF; ask for it).
- **WHO physical-activity guidelines** for adults (18+): 150–300 min/week moderate activity,
  muscle-strengthening ≥2×/week. (Referenced by `indicators[].reference`.)
- **《义务教育体育与健康课程标准（2022年版）》** and any departmental materials from Dr. Qin.

Give each retrievable clause a stable id (e.g. `who:pa-adult-150`, `gb:endurance-female-g1`) so
agent sentences can cite it exactly like an internal node.

---

## 6. Guardrails your agent must honor (non-negotiable — `AGENTS.md`, proposal §7)

- **No weight-loss / caloric / body-image advice**, under any prompt — even though body-composition
  indicators exist, they are explanatory only.
- **Escalation, not diagnosis** — concerning patterns route to a PE teacher / health professional;
  set/read the `needs_human` flag; never present as clinical.
- **No student-facing peer ranking or leaderboards.**
- **Directional, non-evaluative framing** ("improving since g2"), never "you failed".
- **Self-report privacy** — never surface `teacher_visible: false` indicators to a teacher.

These are tested by `eval/safety_cases/` (schema in the repo) **before any interface change ships** —
your agent is expected to pass that set.

---

## 7. If you use a tool-calling agent design (recommended mapping)

Your current `TOOLS` list (`predict_pass_likelihood`, `predict_trajectory`,
`recommend_training_focus`, each taking `student_id`) is a good fit — treat each tool as a
**getter over the hand-off object in §2** (read the pre-computed object, or call the model live;
either works). Two rules keep it aligned with the project's differentiator:

- **Tools return the structured, provenance-bearing payload — never a bare scalar.** If a tool
  returns just `0.41`, the agent has to invent the "why" and we lose the glass-box guarantee.
  Return the slice of the hand-off object *with its `provenance` ids*, so every agent sentence can
  cite one (§4).
- **Respect role + layer.** Tools carry the caller's role; a teacher never receives
  `teacher_visible: false` indicators. Deterministic vs predicted must stay distinct in the return
  (see `causal`, `uncertainty`).

**Mapping and recommended return shapes:**

| Your tool | Backed by | Returns (slice of §2) |
|---|---|---|
| `predict_pass_likelihood` | Progress Check (fuzzy) | `{ pass_probability, risk, uncertainty, drivers[], provenance:"progress:flag" }` |
| `predict_trajectory` | Progress Check + Student Types | `{ direction: improving\|stable\|declining, since_grade, drivers[], provenance }` |
| `recommend_training_focus` | **Route-to-Pass (exact) + Student Types** | the `route` object: `{ target, options[ {changes[], effort_estimate, effort_is_placeholder, provenance} ], needs_human, causal:false }` |

`recommend_training_focus` is **deterministic arithmetic over the scoring bands, not an ML guess** —
back it with Route-to-Pass, and carry the `causal:false` + `effort_is_placeholder` + safety-cap
caveats so it never drifts into unsafe "just do X every day" advice.

**Two tools to add** for full coverage of the differentiator and the guardrails:

- `get_scorecard(student_id)` → the `score` object (current standing, band, pass/fail) — so the
  agent can state where a student *is*, exactly, before advising. Also exposes `flags`
  (`needs_human`, `at_risk`) so the agent can **escalate** instead of advising.
- `retrieve_guideline(query)` → guideline clauses with stable citable ids (§5) — the "cited
  guideline" half of the differentiator.

**Guardrails apply to the tool layer too:** no tool returns weight-loss/caloric targets; any tool
may set `needs_human` to force escalation; student vs teacher scoping is enforced server-side and
must be honored in the tools. All of this is exercised by `eval/safety_cases/`.

You can wire and test all five tools against the **synthetic fixtures** today — no dependency on
Task A's real models.

---

## 8. How to work in parallel (no blocking)

1. **Now:** build KG + RAG + agent + PWA against the schema in §2 and the synthetic fixtures Task A
   will provide (mock students conforming to this contract).
2. **At the sync:** ratify/adjust the contract together, then freeze `schema_version`.
3. **At integration:** Task A's real models emit the same shape → you swap fixtures for real objects,
   nothing else changes.

**Open items that fill in later** (they change *values*, not the *shape*): the exact scholarship pass
rule (`score.pass`), real effort estimates (`route[].effort_estimate`, `effort_is_placeholder`
flips to false), and the psychology/environment indicators once the survey is fielded.
