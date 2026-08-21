# data/scoring_tables/ — BLOCKING INPUT

This directory holds the 《国家学生体质健康标准（2014年修订）》 evaluation tables. **It is
intentionally empty of table data.** The rule engine reads from here and *refuses to run*
until real tables are present (`ScoringTablesUnavailable`). Nothing in this project guesses a
scoring value — that is the one rule the whole differentiator rests on (`AGENTS.md` §The core
premise).

## What is needed

The official evaluation tables, as a file (PDF or Excel is fine as a source; convert to the
JSON/CSV schema below for the engine), covering:

- **Per item** — every scored test item for the target band (e.g. 肺活量, 50m 跑, 坐位体前屈,
  立定跳远, 引体向上 / 仰卧起坐, 800m/1000m 跑, 身高/体重→BMI, …).
- **Per grade band** — 小学 / 初中 / 高中 / 大学. *Which band is a blocking decision* — it
  selects the item set and the cutoffs.
- **Per sex** — the standard scores males and females on different tables.
- **Per age / grade-year** where the standard distinguishes them.
- **Item weightings** — how item scores combine into the weighted total.
- **附加分 (bonus) rules** — the extra-credit items and their caps.
- **Grade-band cutoffs** — total-score ranges for 优秀 / 良好 / 及格 / 不及格.

## Format

Convert the source into the shape sketched in `schema.example.json` (that file is an
*illustrative skeleton with no real numbers* — do not treat its placeholder values as data).
Table files you add here are git-ignored; only this README and the example schema are
tracked, so real thresholds never enter version control by accident.

## After you add the tables

Implement parsing/validation in `aptams/rule_engine/tables.py`, then add golden tests from
worked examples in the official document. See `aptams/rule_engine/README.md`.
