# data/expert_rules/

Mentor-supplied **effort estimates** for improving each test item, used by the counterfactual
planner to turn an exact score gap into a plain-language effort (e.g. "≈ 2 weeks of
consistent stretching for +4 cm sit-and-reach"). Also holds any **red-flag / escalation
criteria** the mentor specifies.

## Conventions (`AGENTS.md` §Conventions)

- These are **estimates**, and the UI labels them as such. They are *not* causal guarantees —
  the counterfactual itself is exact arithmetic; the effort attached to it is expert judgment.
- Until a real mentor-supplied value exists for an item, the planner uses a value marked
  `PLACEHOLDER` in both code (`ItemChange.effort_is_placeholder = True`) and UI. Placeholders
  are visibly flagged, never presented as settled advice.

## Status

Empty at T0. The counterfactual planner ships with placeholders and swaps them for real
values as the mentor supplies them (`docs/proposal.md` §11.8) — no code change beyond the
rules file.
