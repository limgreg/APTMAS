# APTAMS self-report survey — psychology & environment

**Purpose.** Objective **A1** requires indicators across five dimensions. Fitness, metabolism
and behaviour are already populated from existing data; **psychology** (mood, stress,
wellbeing) and parts of **environment** (study load, commute, facility access on campus) are
not. This instrument closes that gap.

**Status: DRAFT — not yet fielded.** Fielding requires mentor approval and a consent process
(`docs/task_a_plan.md` §8, item 1). Until then the corresponding indicators in
`analysis/indicators.py` carry `PENDING COLLECTION` and the pipeline runs without them.

---

## Design rules this instrument obeys

These come from `AGENTS.md` and are not negotiable:

1. **No body-image, weight or intake items.** Nothing about weight, shape, dieting, eating, or
   appearance. Body composition is explanatory only and is already measured elsewhere.
2. **Non-clinical.** No depression/anxiety screening instrument, no diagnostic scale, no
   symptom checklist. We are not qualified to screen and the system must not present as
   clinical. Wording is everyday, not diagnostic.
3. **Minimal collection.** 12 items. Every question maps to a declared indicator; anything
   that does not earn a place in the catalogue is not asked.
4. **Self-report stays with the student.** Every response below is `teacher_visible: false`.
   Teachers receive only a non-specific flag, never an answer. Enforced server-side, not just
   in the UI.
5. **Escalation, not diagnosis.** One item (Q11) exists solely to route a student to a human.
6. **Bilingual.** Chinese is the primary language; English is provided for the record.

---

## Consent (shown before Q1)

> 这份问卷帮助我们理解影响体育锻炼的因素。**你的回答只有你自己能看到** — 老师看不到你的
> 任何具体答案。参与完全自愿，你可以随时停止，也可以跳过任何一题。这不是心理测评，也不用于
> 评分或评价。
>
> *This survey helps us understand what affects physical activity. **Only you can see your
> answers** — your teachers cannot see any individual response. Participation is voluntary,
> you may stop at any time, and you may skip any question. This is not a psychological
> assessment and is not used for grading or evaluation.*

- [ ] 我理解并同意参与 / I understand and agree to take part

**Open questions for the mentors before fielding:** who holds consent for students under 18
(if any are enrolled); which ethics process applies; where responses are stored; retention
period.

---

## Section A — Psychology (4 items)

Maps to `mood`, `perceived_stress`, `general_wellbeing`, `exercise_motivation`.

**Q1. 最近两周，你的心情大致如何？** *Over the past two weeks, how has your mood generally been?*
`1 很低落 · 2 偏低 · 3 一般 · 4 不错 · 5 很好` → `mood`

**Q2. 最近两周，你感觉压力有多大？** *Over the past two weeks, how much stress have you felt?*
`1 几乎没有 · 2 较小 · 3 中等 · 4 较大 · 5 很大` → `perceived_stress` *(lower is better)*

**Q3. 总体来说，你对目前的生活状态满意吗？** *Overall, how satisfied are you with how things
are going?*
`1 很不满意 · 2 不太满意 · 3 一般 · 4 比较满意 · 5 很满意` → `general_wellbeing`

**Q4. 你觉得自己有能力坚持规律运动吗？** *Do you feel able to keep up regular exercise?*
`1 完全没有信心 · 2 · 3 · 4 · 5 很有信心` → `exercise_self_efficacy`

> Q4 is the single strongest behavioural predictor in the activity literature and is
> body-neutral, which is why it is preferred over any physique- or weight-related motive item.

---

## Section B — Environment (5 items)

Maps to `study_load`, `active_commute`, `facility_access`, `participation_barriers`.

**Q5. 平均每周你花在学习上的时间大约是多少小时？（含上课与自习）**
*Roughly how many hours per week do you spend on study, including class and self-study?*
`____ 小时/周` → `study_load`

**Q6. 你平时步行或骑车通勤的时间大约是？** *About how long is your walking or cycling commute?*
`1 几乎没有 · 2 <10分钟/天 · 3 10–30分钟/天 · 4 >30分钟/天` → `active_commute`

**Q7. 从你的住处到最近的可用运动场所，大约需要多久？**
*How long does it take to reach the nearest sports facility you can actually use?*
`1 <5分钟 · 2 5–15分钟 · 3 15–30分钟 · 4 >30分钟 · 5 不知道/没有` → `facility_access`

**Q8. 校内运动场所在你想用的时候通常可用吗？**
*Are campus sports facilities usually available when you want to use them?*
`1 从来不 · 2 很少 · 3 有时 · 4 经常 · 5 总是` → `facility_access`

**Q9. 下列哪些因素影响你参加体育锻炼？（最多选三项）**
*Which of these affect your taking part in exercise? (choose up to three)*

Reuses the 体质测试卡片 Q7 code book so responses pool with the existing pilot data:
`1 身体很好，不用参加 · 2 身体弱，不宜参加 · 3 体力工作多 · 4 家务忙，缺少时间 ·
5 学业忙，缺少时间 · 6 缺乏场地设施 · 7 缺乏锻炼知识或指导 · 8 缺乏组织 · 9 没兴趣 ·
10 惰性 · 11 怕受伤 · 12 经济条件限制 · 13 认为没必要 · 14 其他`
→ `participation_barriers`

> Code 5 is reworded from 工作忙 to 学业忙 for a student population. Code 11 怕受伤 is treated
> as an injury-safety signal and raises `needs_human` rather than generating advice.

---

## Section C — Behaviour context & escalation (3 items)

**Q10. 平均每晚你睡多久？** *On average, how many hours do you sleep per night?*
`____ 小时` → `sleep_hours`

**Q11. 目前有没有伤病或身体状况让你在运动时需要注意？**
*Do you currently have any injury or condition you need to be careful about when exercising?*
`1 没有 · 2 有（不用写具体内容）· 3 不确定`
→ **escalation only.** A response of 2 or 3 sets `needs_human` on the hand-off object. The
system does not ask what the condition is, does not store a description, and does not
interpret it. It routes to a PE teacher or school health professional.

**Q12. 有什么会让你更容易动起来吗？（选填）**
*Is there anything that would make it easier for you to be active? (optional)*
`自由填写 / free text`
→ Not machine-processed at T1. Qualitative context for the team only, and never passed to the
agent — free text cannot carry provenance, so the agent could not ground a sentence on it.

---

## How responses enter the system

| Step | Rule |
|---|---|
| Layer | Every response enters as `REPORTED` — the weakest claim strength. Any statement combining it with fitness data inherits `reported`. |
| Teacher visibility | All items are `teacher_visible: false`. Teachers see only aggregate cohort counts (n ≥ 20 per cell) and non-specific flags. |
| Agent access | Reaches the agent only as catalogue indicators with provenance ids, never as raw text. Q12 never reaches the agent at all. |
| Escalation | Q11 ∈ {2, 3} → `needs_human`. Q9 containing 11 (怕受伤) → `needs_human`. |
| Storage | Responses are git-ignored like all real data and never committed. |

## Pilot plan

1. Mentor review of this instrument and the consent text.
2. Ethics/consent process confirmed (**blocking**).
3. Pilot with ~30 students alongside a 体测 sitting, so responses join on `student_id`.
4. Check: completion rate, item non-response, and whether Q5/Q7/Q10 discriminate at all.
5. Only then field more widely.

Until step 3 completes, `analysis/indicators.py` reports these indicators as
`pending_survey` and the five-dimension coverage table shows the gap honestly rather than
implying data we do not have.
