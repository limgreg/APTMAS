# rule_engine — component [1], deterministic ground truth

The 《国家学生体质健康标准（2014年修订）》 scoring standard as executable code. **Zero ML.**
Everything else in APTAMS is checked against this layer.

```
measurements → item scores → weighted total → grade band     (per age group and sex, incl. 附加分)
```

## Files

| File | Role |
|---|---|
| `models.py` | Typed inputs/outputs — structure only, no numbers. |
| `tables.py` | Loads & validates the mentor-supplied tables. The **only** place a scored number originates. |
| `engine.py` | Pure pipeline: orchestrates table lookups and the weighting arithmetic. |

## The one rule

Never approximate a threshold, weighting, or 附加分 rule from memory or inference
(`AGENTS.md` §The core premise). If a value is not in `data/scoring_tables/`, the code
**raises** rather than guessing:

- No tables present → `ScoringTablesUnavailable` (the expected T0 state).
- Tables present but a required value missing → the accessor raises; no fallback.

This is what makes explanations *verifiable* instead of merely plausible — the project's
entire differentiator. A single guessed number would silently collapse that claim.

## Implementing it (when the tables arrive)

1. Confirm the **target grade band** (小学/初中/高中/大学) — it selects the item set and bands.
2. Place the tables in `data/scoring_tables/` per that directory's README + schema.
3. Implement parsing/validation in `tables.py` (`ScoringTables` + `load_scoring_tables`).
4. `engine.py` should need no change — it already expresses the pipeline against the
   `ScoringTables` contract.
5. Add golden tests from worked examples in the official document before wiring anything
   downstream.
