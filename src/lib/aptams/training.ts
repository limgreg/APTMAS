// Deterministic training-plan library. Returns three short-term (~4 week)
// focused plans plus one long-term periodized plan (default 12 weeks, scaled
// to the student's test date).
//
// PROVENANCE / REVIEW STATUS (AGENTS.md open item): this is a TEMPLATE LAYER,
// not an LLM, and its exercise content is GENERIC, CURATED BOILERPLATE that has
// NOT yet been reviewed/supplied by a PE mentor. Unlike scores and routes it
// carries no auditable source node and never enters the agent's provenance
// context, so nothing here can be cited as `verified`. Every plan therefore
// carries `review.status = "pending"` and the UI must show the pending-PE-review
// banner. When the PE department supplies vetted expert rules (see
// data/expert_rules/), flip this to `reviewed` and attach the source id(s); do
// not claim "traceable" before that exists.
//
// It never invents exercises, never gives weight-loss/caloric advice, and
// always carries the non-causal + stop-on-pain disclaimers. The agent may
// polish wording, but the structure and content originate here so they stay
// auditable.

import type { FitnessItemId, Sex } from "../types";

export type Locale = "zh" | "en" | "ko";

export type TrainingDimension = "cardio" | "power" | "strength";

/**
 * Review state of the exercise content.
 * - pending: generic curated templates, NOT PE-vetted, no citable source.
 * - reviewed: PE-department-supplied expert rules; `source_ids` lists the nodes.
 */
export type TrainingReviewStatus = "pending" | "reviewed";

export interface TrainingReview {
  status: TrainingReviewStatus;
  /** Provenance node ids when `status === "reviewed"`; empty while pending. */
  source_ids: string[];
  /** Banner copy shown in the UI explaining the review state (all locales). */
  notice: { zh: string; en: string; ko: string };
}

export interface Exercise {
  name: { zh: string; en: string; ko: string };
  detail: { zh: string; en: string; ko: string };
}

export interface DrillDown {
  /** A single training day, e.g. "Monday". */
  day: { zh: string; en: string; ko: string };
  /** Ordered blocks: warm-up / main / cool-down with sets-reps-rest. */
  blocks: Array<{
    label: { zh: string; en: string; ko: string };
    detail: { zh: string; en: string; ko: string };
  }>;
}

export type PressureTier = "low" | "balanced" | "focused";

export interface ShortPlan {
  /** Stable id, used for React keys. */
  id: "cardio" | "power" | "strength";
  dimension: TrainingDimension;
  /** Pressure ordering from the product spec: low-pressure first, breakthrough last. */
  tier: PressureTier;
  title: { zh: string; en: string; ko: string };
  /** One-line summary shown before the detail drill-down. */
  summary: { zh: string; en: string; ko: string };
  core: { zh: string; en: string; ko: string };
  secondary: { zh: string; en: string; ko: string };
  targets: FitnessItemId[];
  exercises: Exercise[];
  frequency: { zh: string; en: string; ko: string };
  notes: { zh: string; en: string; ko: string };
  /** Day-by-day detail revealed on demand ("方案一详情"). */
  drilldown: DrillDown[];
  /** True when this plan directly targets one of the student's weak items. */
  relevant: boolean;
}

export interface Phase {
  name: { zh: string; en: string; ko: string };
  weeks: string;
  goal: { zh: string; en: string; ko: string };
  focus: { zh: string; en: string; ko: string };
  typical: { zh: string; en: string; ko: string };
  load: { zh: string; en: string; ko: string };
  checkpoint: { zh: string; en: string; ko: string };
}

export interface LongPlan {
  total_weeks: number;
  phases: Phase[];
  nutrition: { zh: string; en: string; ko: string };
  recovery: { zh: string; en: string; ko: string };
  injury: { zh: string; en: string; ko: string };
  relation: { zh: string; en: string; ko: string };
}

export interface TrainingPlans {
  weak_items: FitnessItemId[];
  short: ShortPlan[];
  long: LongPlan;
  default_period: boolean;
  disclaimers: { zh: string; en: string; ko: string };
  /** Review/provenance state of the exercise content. See TrainingReview. */
  review: TrainingReview;
}

interface StudentLike {
  score: { items: Array<{ indicator_id: string; points: number }> };
  meta: { sex: Sex };
}

// Map scored items to training dimensions. BMI has no exercise plan (it is a
// categorical body-composition measure; the system does not give weight-loss
// advice), so it is excluded.
const ITEM_DIMENSION: Partial<Record<FitnessItemId, TrainingDimension>> = {
  endurance_run: "cardio",
  vital_capacity: "cardio",
  sprint_50m: "power",
  standing_long_jump: "power",
  strength: "strength",
  sit_and_reach: "strength",
};

const EXERCISES: Record<TrainingDimension, Exercise[]> = {
  cardio: [
    {
      name: {
        zh: "定距变速跑",
        en: "Variable-pace interval runs",
        ko: "거리 기반 변속 페이스 러닝",
      },
      detail: {
        zh: "直道稍快、弯道慢跑交替，刺激心肺又控制总负荷，提升有氧耐力。",
        en: "Alternate faster straights with slower bends to stress the cardio system while controlling total load.",
        ko: "직선은 빠르게, 곡선은 느리게 달려 심폐계를 자극하면서 총부하를 조절합니다.",
      },
    },
    {
      name: { zh: "间歇跑", en: "Interval training", ko: "인터벌 러닝" },
      detail: {
        zh: "如 400m×6 组、组间慢走恢复，提高乳酸阈值和耐力跑配速。",
        en: "e.g. 6×400m with walk recovery to lift lactate threshold and run pace.",
        ko: "예: 400m×6세트, 세트 사이 걷기 회전으로 젖산 역치와 지구력 페이스를 높입니다.",
      },
    },
    {
      name: { zh: "有氧慢跑", en: "Easy aerobic runs", ko: "가벼운 유산소 조깅" },
      detail: {
        zh: "持续 20–40 分钟可说话强度的慢跑，建立有氧基础、促进恢复。",
        en: "Steady 20–40 min conversational-pace runs to build the aerobic base and aid recovery.",
        ko: "20–40분 대화 가능 강도의 꾸준한 조깅으로 유산소 기반을 다지고 회복을 돕습니다.",
      },
    },
    {
      name: { zh: "法特莱克跑", en: "Fartlek runs", ko: "파틀렉 러닝" },
      detail: {
        zh: "在连续跑中自由变换快慢，兼顾心肺刺激与趣味性。",
        en: "Free-form speed changes within a continuous run for cardio stimulus with variety.",
        ko: "연속 달리기에서 빠르기 변화를 자유롭게 주어 심폐 자극과 다양성을 더합니다.",
      },
    },
  ],
  power: [
    {
      name: { zh: "跳箱/跳深", en: "Box jumps / depth jumps", ko: "박스 점프 / 뎁스 점프" },
      detail: {
        zh: "强调快速发力与落地缓冲，提升下肢爆发力，注意膝对齐。",
        en: "Emphasize fast force production and soft landings to build lower-body power; keep knees aligned.",
        ko: "빠른 힘 생성과 충격 흡수에 집중해 하체 파워를 기르며 무릎 정렬에 유의합니다.",
      },
    },
    {
      name: { zh: "短距离冲刺", en: "Short sprints", ko: "단거리 스프린트" },
      detail: {
        zh: "30–60m 全力加速、充分恢复，发展位移速度与加速能力。",
        en: "30–60m all-out accelerations with full recovery to develop displacement speed.",
        ko: "30–60m 전력 가속과 충분한 회복으로 이동 속도와 가속 능력을 기릅니다.",
      },
    },
    {
      name: {
        zh: "立定跳远专项",
        en: "Standing long-jump drills",
        ko: "제자리멀리뛰기 전공 훈련",
      },
      detail: {
        zh: "摆臂、蹬伸与收腹举腿分解练习，改善发力顺序与远度。",
        en: "Break down arm swing, triple extension and leg tuck to improve force sequence and distance.",
        ko: "팔 흔들기, 삼중 신전, 무릎 당기기를 분해 연습해 힘 전달 순서와 거리를 개선합니다.",
      },
    },
    {
      name: { zh: "绳梯/栏架", en: "Ladder & hurdle drills", ko: "사다리 / 허들 드릴" },
      detail: {
        zh: "提升步频、灵敏与踝关节刚性，是速度与爆发的基础。",
        en: "Improve step frequency, agility and ankle stiffness — a base for speed and power.",
        ko: "발걸음 빈도, 민첩성, 발목 강성을 높여 속도와 파워의 기반을 다집니다.",
      },
    },
  ],
  strength: [
    {
      name: {
        zh: "引体/仰卧起坐专项",
        en: "Pull-up / sit-up specific work",
        ko: "턱걸이 / 윗몸일으키기 전공",
      },
      detail: {
        zh: "按性别做引体向上或 1 分钟仰卧起坐的分次练习，逐步增加次数。",
        en: "Sex-specific sets of pull-ups or 1-minute sit-ups, gradually adding reps.",
        ko: "성별에 맞는 턱걸이 또는 1분 윗몸일으키기 세트로 반복 수를 점진적으로 늘입니다.",
      },
    },
    {
      name: { zh: "核心力量", en: "Core strength", ko: "코어 근력" },
      detail: {
        zh: "平板支撑、死虫、臀桥等，增强躯干稳定与力量传递。",
        en: "Planks, dead bugs, glute bridges for trunk stability and force transfer.",
        ko: "플랭크, 데드버그, 힙 브릿지로 몸통 안정성과 힘 전달을 강화합니다.",
      },
    },
    {
      name: { zh: "动态拉伸", en: "Dynamic stretching", ko: "동적 스트레칭" },
      detail: {
        zh: "前后摆腿、行进弓步等，扩大关节活动幅度并作为热身。",
        en: "Leg swings, walking lunges to increase range of motion and serve as warm-up.",
        ko: "레그 스윙, 워킹 런지 등으로 가동 범위를 넓히고 워밍업으로 활용합니다.",
      },
    },
    {
      name: { zh: "静态拉伸", en: "Static stretching", ko: "정적 스트레칭" },
      detail: {
        zh: "训练后保持 20–30 秒的腘绳肌/下背拉伸，改善坐位体前屈。",
        en: "Post-session 20–30s hamstring/lower-back holds to improve sit-and-reach.",
        ko: "운동 후 20–30초 햄스트링/허리 스트레칭으로 윗몸 앞으로 굽히기를 개선합니다.",
      },
    },
  ],
};

function pick(dim: TrainingDimension, sex: Sex, weak: FitnessItemId[]): ShortPlan {
  const targetItems = (Object.keys(ITEM_DIMENSION) as FitnessItemId[]).filter(
    (id) => ITEM_DIMENSION[id] === dim,
  );
  const relevant = weak.some((id) => targetItems.includes(id));

  if (dim === "cardio") {
    return {
      id: "cardio",
      dimension: "cardio",
      tier: "balanced",
      title: {
        zh: "均衡全面型（心肺耐力）",
        en: "Balanced plan (cardio endurance)",
        ko: "균형형 (심폐 지구력)",
      },
      summary: {
        zh: "以间歇跑与轻松跑结合，兼顾有氧基础与速度耐力，适合多数同学，每周 3–4 次。",
        en: "Intervals plus easy runs build aerobic base and speed endurance; suits most students, 3–4 sessions/week.",
        ko: "인터벌과 가벼운 달리기로 유산소 기초와 스피드 지구력을 함께 기릅니다. 주 3–4회, 대부분에게 적합합니다.",
      },
      core: {
        zh: "心肺耐力",
        en: "Cardio endurance",
        ko: "심폐 지구력",
      },
      secondary: { zh: "肌肉耐力", en: "Muscular endurance", ko: "근지구력" },
      targets: targetItems,
      exercises: EXERCISES.cardio,
      frequency: {
        zh: "每周 3–4 次，其中 1–2 次间歇、2 次轻松跑",
        en: "3–4 sessions/week: 1–2 intervals + 2 easy runs",
        ko: "주 3–4회: 인터벌 1–2회 + 가벼운 달리기 2회",
      },
      notes: {
        zh: "耐力跑为 1000m（男）/800m（女）。循序渐进增加跑量，出现胸闷或疼痛应停止。",
        en:
          sex === "male"
            ? "Endurance item is 1000m. Build volume gradually; stop if you feel chest tightness or pain."
            : "Endurance item is 800m. Build volume gradually; stop if you feel chest tightness or pain.",
        ko:
          sex === "male"
            ? "지구력 종목은 1000m입니다. 볼륨을 점진적으로 늘리고, 흉부 압박이나 통증이 있으면 멈추세요."
            : "지구력 종목은 800m입니다. 볼륨을 점진적으로 늘리고, 흉부 압박이나 통증이 있으면 멈추세요.",
      },
      drilldown: [
        {
          day: { zh: "周一", en: "Mon", ko: "월요일" },
          blocks: [
            {
              label: { zh: "热身", en: "Warm-up", ko: "준비운동" },
              detail: {
                zh: "慢跑 8–10 分钟 + 动态拉伸。",
                en: "Easy jog 8–10 min + dynamic stretches.",
                ko: "가벼운 조깅 8–10분 + 동적 스트레칭.",
              },
            },
            {
              label: { zh: "主项", en: "Main", ko: "본운동" },
              detail: {
                zh: "间歇跑 400m × 4–6 组，组间慢走 2 分钟。",
                en: "400m intervals × 4–6, 2 min walk recovery.",
                ko: "400m 인터벌 × 4–6세트, 세트 간 2분 걷기 회복.",
              },
            },
            {
              label: { zh: "放松", en: "Cool-down", ko: "정리운동" },
              detail: { zh: "慢走 5 分钟 + 小腿拉伸。", en: "Walk 5 min + calf stretch.", ko: "5분 걷기 + 종아리 스트레칭." },
            },
          ],
        },
        {
          day: { zh: "周三", en: "Wed", ko: "수요일" },
          blocks: [
            {
              label: { zh: "主项", en: "Main", ko: "본운동" },
              detail: {
                zh: "轻松有氧跑 25–30 分钟（可完整对话的强度）。",
                en: "Easy aerobic run 25–30 min (conversational pace).",
                ko: "가벼운 유산소 달리기 25–30분(대화 가능 강도).",
              },
            },
          ],
        },
        {
          day: { zh: "周五", en: "Fri", ko: "금요일" },
          blocks: [
            {
              label: { zh: "主项", en: "Main", ko: "본운동" },
              detail: {
                zh: "变速跑 15–20 分钟（直道稍快/弯道慢），或节奏跑 2 × 8 分钟。",
                en: "Fartlek 15–20 min (fast straights / slow bends), or 2 × 8 min tempo.",
                ko: "파틀렉 15–20분(직선 빠르게/곡선 느리게) 또는 템포런 2×8분.",
              },
            },
            {
              label: { zh: "辅项", en: "Auxiliary", ko: "보조운동" },
              detail: { zh: "核心循环 2 组（平板支撑 30s、臀桥 15 次）。", en: "Core circuit × 2 (plank 30s, glute bridge 15).", ko: "코어 서킷 2세트(플랭크 30초, 힙브릿지 15회)." },
            },
          ],
        },
      ],
      relevant,
    };
  }

  if (dim === "power") {
    return {
      id: "power",
      dimension: "power",
      tier: "focused",
      title: {
        zh: "重点突破型（爆发力与速度）",
        en: "Focused breakthrough (power & speed)",
        ko: "집중 돌파형 (파워와 스피드)",
      },
      summary: {
        zh: "高强度针对 50 米、立定跳远等弱项，跳跃与冲刺在充分恢复后进行，每周 2–3 次。",
        en: "High-intensity focus on weak speed/power events (50m, long jump); jumps and sprints done fresh, 2–3 sessions/week.",
        ko: "50m, 멀리뛰기 등 약점 종목에 고강도 집중. 충분히 회복된 상태에서 점프/스프린트 실시, 주 2–3회.",
      },
      core: {
        zh: "爆发力与速度",
        en: "Power & speed",
        ko: "파워와 스피드",
      },
      secondary: { zh: "灵敏、协调", en: "Agility, coordination", ko: "민첩성, 협응력" },
      targets: targetItems,
      exercises: EXERCISES.power,
      frequency: {
        zh: "每周 2–3 次，速度/爆发训练需充分休息、安排在体力好时",
        en: "2–3 sessions/week; do speed/power work fresh with full recovery",
        ko: "주 2–3회; 스피드/파워 훈련은 충분히 회복된 상태에서 실시",
      },
      notes: {
        zh: "充分热身后再做跳跃与冲刺；落地屈膝缓冲，膝盖不内扣。",
        en: "Warm up fully before jumps/sprints; land softly and avoid knee valgus.",
        ko: "점프/스프린트 전 충분히 워밍업하고, 부드럽게 착지하며 무릎이 안으로 모이지 않게 하세요.",
      },
      drilldown: [
        {
          day: { zh: "周二", en: "Tue", ko: "화요일" },
          blocks: [
            {
              label: { zh: "热身", en: "Warm-up", ko: "준비운동" },
              detail: { zh: "慢跑 8 分钟 + 高抬腿/后踢腿各 2 × 20m。", en: "Jog 8 min + high-knees/butt-kicks 2×20m each.", ko: "조깅 8분 + 높은무릎/힐킥 각 2×20m." },
            },
            {
              label: { zh: "主项", en: "Main", ko: "본운동" },
              detail: { zh: "30m 冲刺 × 6，组间走回休息 2 分钟。", en: "30m sprints × 6, walk-back recovery ~2 min.", ko: "30m 스프린트 × 6, 세트 간 2분 걷기 회복." },
            },
            {
              label: { zh: "跳跃", en: "Plyo", ko: "플라이오" },
              detail: { zh: "立定跳远 × 5 次或蹲跳 3 × 8，组间休息 90 秒。", en: "Standing long jumps × 5 or squat jumps 3×8, 90s rest.", ko: "제자리멀리뛰기 × 5 또는 스쿼트점프 3×8, 90초 휴식." },
            },
          ],
        },
        {
          day: { zh: "周四", en: "Thu", ko: "목요일" },
          blocks: [
            {
              label: { zh: "主项", en: "Main", ko: "본운동" },
              detail: { zh: "起跑练习 4 × 20m + 加速跑 4 × 40m，全部充分恢复。", en: "Starts 4×20m + acceleration runs 4×40m, full recovery.", ko: "스타트 4×20m + 가속주 4×40m, 충분히 회복." },
            },
            {
              label: { zh: "辅项", en: "Auxiliary", ko: "보조운동" },
              detail: { zh: "弓步走 3 × 10 + 提踵 3 × 15。", en: "Walking lunges 3×10 + calf raises 3×15.", ko: "워킹 런지 3×10 + 카프레이즈 3×15." },
            },
          ],
        },
      ],
      relevant,
    };
  }

  return {
    id: "strength",
    dimension: "strength",
    tier: "low",
    title: {
      zh: "低压力分散型（力量与柔韧）",
      en: "Low-pressure plan (strength & flexibility)",
      ko: "저부하 분산형 (근력과 유연성)",
    },
    summary: {
      zh: "低强度基础力量与柔韧为主，碎片化即可完成，适合训练时间少、压力敏感的同学，每周 3 次。",
      en: "Low-intensity foundational strength and flexibility; fits fragmented schedules and pressure-sensitive students, 3 sessions/week.",
      ko: "저강도 기초 근력과 유연성 중심. 시간이 부족하거나 부하에 민감한 경우에 적합, 주 3회.",
    },
    core: {
      zh: "肌肉力量与柔韧",
      en: "Strength & flexibility",
      ko: "근력과 유연성",
    },
    secondary: { zh: "核心稳定、身体控制", en: "Core stability, body control", ko: "코어 안정성, 신체 통제" },
    targets: targetItems,
    exercises: EXERCISES.strength,
    frequency: {
      zh: "每周 3 次力量 + 每次训练前后拉伸",
      en: "3 strength sessions/week + stretching before/after each session",
      ko: "주 3회 근력 + 매 훈련 전후 스트레칭",
    },
    notes: {
      zh:
        sex === "male"
          ? "力量项为引体向上，从可完成的次数起步，逐步增加。"
          : "力量项为 1 分钟仰卧起坐，注意动作质量而非只追求数量。",
      en:
        sex === "male"
          ? "The strength item is pull-ups; start from a rep count you can complete and progress gradually."
          : "The strength item is 1-minute sit-ups; prioritize form over raw count.",
      ko:
        sex === "male"
          ? "근력 종목은 턱걸이입니다. 완료 가능한 반복 수에서 시작해 점진적으로 늘리세요."
          : "근력 종목은 1분 윗몸일으키기입니다. 횟수보다 자세 품질을 우선하세요.",
    },
    drilldown: [
      {
        day: { zh: "周一", en: "Mon", ko: "월요일" },
        blocks: [
          { label: { zh: "热身", en: "Warm-up", ko: "준비운동" }, detail: { zh: "5 分钟关节活动 + 动态拉伸。", en: "5 min mobility + dynamic stretching.", ko: "5분 관절 가동 + 동적 스트레칭." } },
          {
            label: { zh: "主项", en: "Main", ko: "본운동" },
            detail: sex === "male"
              ? { zh: "引体向上 3 组至接近力竭（可弹力带辅助）；组间休息 90 秒。", en: "Pull-ups 3 sets near failure (band-assisted if needed); 90s rest.", ko: "턱걸이 3세트 (필요시 밴드 보조), 실패 직전까지; 세트 간 90초 휴식." }
              : { zh: "1 分钟仰卧起坐 3 组，组间休息 60–90 秒。", en: "1-minute sit-ups × 3, 60–90s rest.", ko: "1분 윗몸일으키기 × 3, 60–90초 휴식." },
          },
          { label: { zh: "辅项", en: "Auxiliary", ko: "보조운동" }, detail: { zh: "平板支撑 3 × 30s + 臀桥 3 × 12。", en: "Plank 3×30s + glute bridge 3×12.", ko: "플랭크 3×30초 + 힙브릿지 3×12." } },
        ],
      },
      {
        day: { zh: "周三", en: "Wed", ko: "수요일" },
        blocks: [
          { label: { zh: "柔韧", en: "Flexibility", ko: "유연성" }, detail: { zh: "热身后坐位体前屈静态保持 3 × 20–30 秒；腘绳肌、下背拉伸各 2 组。", en: "After warming up, static sit-and-reach holds 3×20–30s; hamstring and lower-back stretches 2 sets each.", ko: "워밍업 후 좌식앞으로굽히기 정적 유지 3×20–30초; 햄스트링·허리 스트레칭 각 2세트." } },
          { label: { zh: "核心", en: "Core", ko: "코어" }, detail: { zh: "死虫 3 × 10 + 侧桥左右各 2 × 20s。", en: "Dead bug 3×10 + side plank 2×20s each side.", ko: "데드버그 3×10 + 사이드플랭크 좌우 각 2×20초." } },
        ],
      },
      {
        day: { zh: "周五", en: "Fri", ko: "금요일" },
        blocks: [
          { label: { zh: "主项", en: "Main", ko: "본운동" }, detail: sex === "male"
            ? { zh: "澳式引体/弹力带下拉 3 × 10，巩固背部发力；再做 2 组引体向上。", en: "Inverted rows / band pull-downs 3×10 to groove back engagement, then 2 pull-up sets.", ko: "로우/밴드 풀다운 3×10로 등 자극을 잡은 뒤 턱걸이 2세트." }
            : { zh: "卷身 3 × 15 + 仰卧举腿 3 × 10，注重动作质量。", en: "Curl-ups 3×15 + lying leg raises 3×10, focus on form.", ko: "컬업 3×15 + 누워서 다리들기 3×10, 자세 품질 우선." } },
        ],
      },
    ],
    relevant,
  };
}

const DEFAULT_WEEKS = 12;

/**
 * Current review state of the exercise library. Generic templates ship as
 * `pending` (no citable source). When the PE department supplies vetted rules in
 * data/expert_rules/ with stable provenance node ids, set status to "reviewed"
 * and list those ids here — the UI banner will then disappear.
 */
const TRAINING_REVIEW: TrainingReview = {
  status: "pending",
  source_ids: [],
  notice: {
    zh: "以下训练动作与周期安排为通用模板，尚未经体育部门专家审核，也不进入助手的可溯源引用范围。请在体育老师/校医指导下，结合自身情况选用；如有疼痛或既往疾病请先评估。",
    en: "The exercises and periodization below are generic templates that have NOT yet been reviewed by the PE department and are not part of the assistant's citable, provenance-locked context. Use them under a PE teacher/clinician's guidance and adapt to yourself; stop and get assessed if you have pain or a pre-existing condition.",
    ko: "아래 동작과 주기 편성은 아직 체육 부서 전문가 검토를 거치지 않은 일반 템플릿이며, 어시스턴트의 출처 고정형 인용 범위에 포함되지 않습니다. 체육 교사/보건 교사 지도 하에 본인 상황에 맞춰 사용하고, 통증이나 기저 질환이 있으면 먼저 평가를 받으세요.",
  },
};

function buildLongPlan(totalWeeks: number, locale: Locale): LongPlan {
  // Split into three phases by thirds (4/4/4 at 12 weeks).
  const w = Math.max(3, Math.round(totalWeeks / 3));
  const p1 = [1, w];
  const p2 = [w + 1, 2 * w];
  const p3 = [2 * w + 1, totalWeeks];

  const t = (texts: { zh: string; en: string; ko: string }) => texts[locale];

  const phases: Phase[] = [
    {
      name: {
        zh: "基础适应期",
        en: "Base adaptation",
        ko: "기초 적응기",
      },
      weeks: `${p1[0]}–${p1[1]}`,
      goal: {
        zh: "建立运动习惯，预防损伤",
        en: "Build the exercise habit, prevent injury",
        ko: "운동 습관 형성, 부상 예방",
      },
      focus: {
        zh: "低强度有氧 + 基础力量 + 柔韧",
        en: "Low-intensity aerobic + base strength + flexibility",
        ko: "저강도 유산소 + 기초 근력 + 유연성",
      },
      typical: {
        zh: "轻松跑、核心激活、动态拉伸，熟悉测试项目动作",
        en: "Easy runs, core activation, dynamic stretching; learn test movement patterns",
        ko: "가벼운 달리기, 코어 활성화, 동적 스트레칭; 측정 동작 익히기",
      },
      load: {
        zh: "低负荷、高频率",
        en: "Low load, high frequency",
        ko: "저부하, 고빈도",
      },
      checkpoint: {
        zh: "第 4 周末做一次模拟测试，记录基线",
        en: "End of week 4: do a mock test and record a baseline",
        ko: "4주차 말 모의 테스트로 기준선 기록",
      },
    },
    {
      name: {
        zh: "能力提升期",
        en: "Capacity building",
        ko: "능력 향상기",
      },
      weeks: `${p2[0]}–${p2[1]}`,
      goal: {
        zh: "针对弱项强化，提升专项素质",
        en: "Target weak items, build sport-specific capacity",
        ko: "약점 집중 강화, 종목별 체력 향상",
      },
      focus: {
        zh: "中高强度间歇 + 专项力量 + 速度/爆发",
        en: "Mid/high-intensity intervals + specific strength + speed/power",
        ko: "중·고강도 인터벌 + 전공 근력 + 스피드/파워",
      },
      typical: {
        zh: "把三个短期方案中与弱项相关的模块加入本周训练",
        en: "Plug in the short-plan module(s) matching your weak items this block",
        ko: "이번 블록에 약점과 관련된 단기 프로그램 모듈을 추가",
      },
      load: {
        zh: "中高负荷、中等频率",
        en: "Mid/high load, medium frequency",
        ko: "중·고부하, 중간 빈도",
      },
      checkpoint: {
        zh: "第 8 周末复测弱项，根据进步调整后段重点",
        en: "End of week 8: retest weak items and adjust the final block",
        ko: "8주차 말 약점 재측정, 마지막 블록 조정",
      },
    },
    {
      name: {
        zh: "冲刺模拟期",
        en: "Taper & simulation",
        ko: "스프린트 모의기",
      },
      weeks: `${p3[0]}–${p3[1]}`,
      goal: {
        zh: "全真模拟测试，调整状态",
        en: "Full mock tests, peak condition",
        ko: "실전 모의 테스트, 컨디션 조절",
      },
      focus: {
        zh: "模拟测试 + 减量训练 + 心理调节",
        en: "Mock tests + taper + mental preparation",
        ko: "모의 테스트 + 테이퍼 + 심리 조절",
      },
      typical: {
        zh: "按测试时间做 1–2 次全真模拟，其余为低强度技术与恢复",
        en: "1–2 full mocks at test time; other sessions low-intensity technique & recovery",
        ko: "측정 시간에 맞춰 1–2회 실전 모의, 나머지는 저강도 기술과 회복",
      },
      load: {
        zh: "高强度、低频率（减量）",
        en: "High intensity, low volume (taper)",
        ko: "고강도, 저빈도 (테이퍼)",
      },
      checkpoint: {
        zh: "测试前 3–5 天减量，保证睡眠与状态",
        en: "Taper 3–5 days before the test; prioritize sleep and readiness",
        ko: "테스트 3–5일 전부터 테이퍼, 수면과 컨디션 우선",
      },
    },
  ];

  return {
    total_weeks: totalWeeks,
    phases,
    nutrition: {
      zh: "保证规律三餐与足量蛋白质，训练前后适量碳水；运动中补水，不要空腹高强度训练。本系统不提供减重或热量目标建议。",
      en: "Eat regular meals with adequate protein and carbs around training; hydrate and avoid high-intensity sessions on an empty stomach. This system does not give weight-loss or caloric targets.",
      ko: "규칙적인 식사와 충분한 단백질, 훈련 전후 탄수화물을 챙기고 수분을 보충하세요. 공복 고강도 훈련은 피하고, 체중 감량/칼로리 목표 조언은 하지 않습니다.",
    },
    recovery: {
      zh: "每晚 7–9 小时睡眠；训练后做主动拉伸与放松；高强度日间安排轻松日或休息。",
      en: "Sleep 7–9 hours nightly; do active stretching/recovery after sessions; pair hard days with easy days or rest.",
      ko: "매일 밤 7–9시간 수면, 훈련 후 능동 스트레칭과 회복, 힘든 날 뒤에는 가벼운 날이나 휴식을 배치하세요.",
    },
    injury: {
      zh: "疼痛（尤其关节、胸痛）不是训练信号，应停止并咨询体育老师/校医；既往疾病或不适请先评估再训练。",
      en: "Pain — especially joint or chest pain — is a signal to stop and consult a PE teacher/clinician; get pre-existing conditions assessed before training.",
      ko: "특히 관절이나 흉부 통증은 훈련 중단 신호이므로 체육 교사/보건 교사와 상담하세요. 기저 질환은 먼저 평가를 받으세요.",
    },
    relation: {
      zh: "三个短期方案是长期计划中“能力提升期”的可插拔模块：哪个项目弱，就把对应模块加到该阶段。",
      en: "The three short plans are plug-in modules for the plan's Capacity phase — add whichever matches your weak items.",
      ko: "세 가지 단기 프로그램은 장기 계획의 '능력 향상기'에 끼워 쓰는 모듈입니다. 약한 종목에 해당하는 모듈을 추가하세요.",
    },
  };
}

/** Weak items = trainable items scoring below 60 (failing), lowest first. */
function findWeakItems(student: StudentLike): FitnessItemId[] {
  const weak = student.score.items
    .filter((it) => {
      const id = it.indicator_id as FitnessItemId;
      return ITEM_DIMENSION[id] !== undefined && it.points < 60;
    })
    .sort((a, b) => a.points - b.points)
    .map((it) => it.indicator_id as FitnessItemId);
  // If nothing is failing, surface the two lowest-scoring trainable items so
  // plans are still meaningful for already-passing students.
  if (weak.length === 0) {
    return [...student.score.items]
      .filter((it) => ITEM_DIMENSION[it.indicator_id as FitnessItemId] !== undefined)
      .sort((a, b) => a.points - b.points)
      .slice(0, 2)
      .map((it) => it.indicator_id as FitnessItemId);
  }
  return weak;
}

export function buildTrainingPlans(
  student: StudentLike,
  locale: Locale,
  testDate?: Date | null,
): TrainingPlans {
  const weak = findWeakItems(student);
  const dimensions: TrainingDimension[] = ["cardio", "power", "strength"];
  const short = dimensions.map((d) => pick(d, student.meta.sex, weak));

  // Order by pressure (product spec): low-pressure first, balanced middle,
  // focused-breakthrough last. A plan that targets a weak item is lifted to
  // the top only when it is also the lowest-pressure match; we keep all three.
  const tierRank: Record<string, number> = { low: 0, balanced: 1, focused: 2 };
  short.sort((a, b) => {
    if (a.relevant !== b.relevant) return Number(b.relevant) - Number(a.relevant);
    return tierRank[a.tier] - tierRank[b.tier];
  });

  let weeks = DEFAULT_WEEKS;
  let defaultPeriod = true;
  if (testDate) {
    const days = Math.round(
      (testDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
    );
    if (days > 0) {
      weeks = Math.max(4, Math.min(20, Math.round(days / 7)));
      defaultPeriod = false;
    }
  }

  return {
    weak_items: weak,
    short,
    long: buildLongPlan(weeks, locale),
    default_period: defaultPeriod,
    review: TRAINING_REVIEW,
    disclaimers: {
      zh: "以上方案为基于测试项目的训练参考，不代表训练效果承诺；运动中如出现疼痛或不适应停止并咨询体育老师/校医。",
      en: "Plans are training references based on the test items, not a promise of results. Stop and consult a PE teacher/clinician if you feel pain or discomfort.",
      ko: "위 프로그램은 측정 종목 기반의 훈련 참고자료이며 효과를 보장하지 않습니다. 통증이나 불편함이 있으면 멈추고 체육 교사/보건 교사와 상담하세요.",
    },
  };
}
