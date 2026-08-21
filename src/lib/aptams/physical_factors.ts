// Physical-factor analysis for the student's weakest test event (Pointer 4).
//
// This is a GENERAL exercise-science explainer — which physical qualities each
// event draws on and how they affect performance — shown alongside the score
// diagnosis. It is intentionally a static, citable-at-rest library and is NOT
// part of the provenance-locked agent context: the assistant does not invent
// physiology, it narrates the deterministic score, and this module supplies the
// educational framing in the UI.
//
// Like the training templates in training.ts, these descriptions are generic
// and carry a "pending PE review" banner until a PE department supplies
// departmental wording; they do not diagnose and do not override the safety
// rules (no weight-loss advice, stop on pain, escalate when needed).

import type { FitnessItemId } from "../types";

export interface PhysicalFactor {
  /** Short quality name. */
  name: { zh: string; en: string };
  /** One or two sentences on how the quality affects the event. */
  detail: { zh: string; en: string };
}

export interface EventAnalysis {
  event: FitnessItemId;
  /** What the event primarily demands, in one line. */
  summary: { zh: string; en: string };
  factors: PhysicalFactor[];
}

export const EVENT_FACTORS: Record<FitnessItemId, EventAnalysis> = {
  endurance_run: {
    event: "endurance_run",
    summary: {
      zh: "耐力跑是全身持续供能项目，成绩主要受心肺耐力与下肢肌肉耐力共同制约。",
      en: "The endurance run is a whole-body, sustained-effort event; performance is governed mainly by cardiorespiratory endurance and lower-limb muscular endurance.",
    },
    factors: [
      {
        name: { zh: "心肺耐力", en: "Cardiorespiratory endurance" },
        detail: {
          zh: "心脏泵血与肺部换气的效率决定了持续供氧能力。心肺耐力不足时，后程会因供氧跟不上而明显掉速。",
          en: "The heart's pumping and the lungs' gas exchange set how long oxygen supply can keep up. When it is insufficient, pace drops sharply in the latter half of the run.",
        },
      },
      {
        name: { zh: "下肢肌肉耐力", en: "Lower-limb muscular endurance" },
        detail: {
          zh: "股四头肌、小腿三头肌等在反复蹬地中抗疲劳的能力，直接影响步频与步幅的保持。",
          en: "The fatigue resistance of the quadriceps and calf muscles across repeated push-offs directly determines whether cadence and stride length are maintained.",
        },
      },
      {
        name: { zh: "配速与节奏", en: "Pacing and rhythm" },
        detail: {
          zh: "起跑过快导致乳酸过早堆积，是耐力跑后程崩盘的常见原因；稳定、可维持的配速比冲刺起跑更有效。",
          en: "Starting too fast builds lactate early and is a common cause of a late-race collapse; a steady, sustainable pace beats a fast opening.",
        },
      },
    ],
  },
  sprint_50m: {
    event: "sprint_50m",
    summary: {
      zh: "50 米跑是无氧短时爆发项目，成绩由反应速度、加速能力和最快步频决定。",
      en: "The 50m sprint is a short anaerobic effort; performance is set by reaction, acceleration, and peak stride frequency.",
    },
    factors: [
      {
        name: { zh: "下肢爆发力", en: "Lower-limb power" },
        detail: {
          zh: "起跑与加速阶段依赖臀大肌、股四头肌和小腿的快速发力能力，蹬地力量越大，加速度越高。",
          en: "The start and acceleration depend on rapid force from the glutes, quads and calves; greater push-off force means higher acceleration.",
        },
      },
      {
        name: { zh: "反应与动作速度", en: "Reaction and movement speed" },
        detail: {
          zh: "听到信号后的起动速度，以及摆臂、摆腿的交替频率，决定了极短距离内的时间差。",
          en: "Time to move after the signal, and the turnover of arms and legs, decide the margin over such a short distance.",
        },
      },
      {
        name: { zh: "协调性与跑姿", en: "Coordination and form" },
        detail: {
          zh: "身体前倾、前脚掌着地与摆臂配合越协调，能量损耗越小，速度越容易发挥。",
          en: "Better alignment, forefoot contact and arm-sync waste less energy and let speed come through.",
        },
      },
    ],
  },
  standing_long_jump: {
    event: "standing_long_jump",
    summary: {
      zh: "立定跳远是水平方向的下肢爆发项目，同时考验协调性与核心稳定。",
      en: "The standing long jump is a horizontal lower-limb power event that also tests coordination and core stability.",
    },
    factors: [
      {
        name: { zh: "下肢爆发力", en: "Lower-limb power" },
        detail: {
          zh: "蹬地瞬间髋、膝、踝三关节同时快速伸展产生的水平推力，是远度的主要来源。",
          en: "The simultaneous, rapid extension of hip, knee and ankle at take-off produces the horizontal drive that mostly determines distance.",
        },
      },
      {
        name: { zh: "摆臂与全身协调", en: "Arm-swing and whole-body coordination" },
        detail: {
          zh: "预摆与蹬地的时机配合能把上肢动量传递到身体，明显增加腾空远度。",
          en: "Timing the arm swing with take-off transfers upper-body momentum and meaningfully adds flight distance.",
        },
      },
      {
        name: { zh: "核心与落地控制", en: "Core and landing control" },
        detail: {
          zh: "腾空时核心维持身体姿态，落地前主动举腿前伸，可避免后坐损失距离。",
          en: "A stable core holds posture in flight, and actively reaching the legs forward before landing prevents losing distance by sitting back.",
        },
      },
    ],
  },
  strength: {
    event: "strength",
    summary: {
      zh: "力量类项目（男生引体向上 / 女生仰卧起坐）主要考验上肢拉拽力量或核心屈伸力量及耐力。",
      en: "The strength events (pull-ups for men / sit-ups for women) mainly demand upper-body pulling strength or core flexion strength and endurance.",
    },
    factors: [
      {
        name: { zh: "目标肌群力量", en: "Prime-mover strength" },
        detail: {
          zh: "引体向上主要依赖背阔肌、肱二头肌和握力；仰卧起坐依赖腹直肌与髂腰肌的反复收缩能力。",
          en: "Pull-ups rely mainly on the lats, biceps and grip; sit-ups rely on repeated contraction of the rectus abdominis and hip flexors.",
        },
      },
      {
        name: { zh: "肌肉耐力", en: "Muscular endurance" },
        detail: {
          zh: "一分钟或多次重复的项目，抗乳酸、维持动作质量的耐力与最大力量同样重要。",
          en: "For one-minute or high-repetition efforts, the endurance to maintain form against fatigue matters as much as maximal strength.",
        },
      },
      {
        name: { zh: "核心与肩胛稳定", en: "Core and scapular stability" },
        detail: {
          zh: "稳定的躯干与肩胛能让力量有效传递，减少代偿和晃动，提高动作效率。",
          en: "A stable trunk and shoulder girdle transfer force efficiently, reduce compensation and sway, and improve movement economy.",
        },
      },
    ],
  },
  sit_and_reach: {
    event: "sit_and_reach",
    summary: {
      zh: "坐位体前屈是柔韧性项目，主要反映后侧链（腘绳肌、下背）的伸展能力与关节灵活度。",
      en: "The sit-and-reach is a flexibility event, mainly reflecting posterior-chain (hamstrings, lower back) extensibility and joint mobility.",
    },
    factors: [
      {
        name: { zh: "后侧链柔韧", en: "Posterior-chain flexibility" },
        detail: {
          zh: "腘绳肌与下背肌肉的伸展性决定了躯干能否顺利前屈，是该项目最直接的因素。",
          en: "The extensibility of the hamstrings and lower back most directly determines how far the trunk can reach forward.",
        },
      },
      {
        name: { zh: "髋关节灵活性", en: "Hip mobility" },
        detail: {
          zh: "髋关节的屈曲活动范围影响骨盆前倾幅度，活动度不足会限制整体前屈。",
          en: "Hip flexion range controls pelvic tilt; restricted mobility limits the whole forward bend.",
        },
      },
      {
        name: { zh: "温度与放松", en: "Warmth and relaxation" },
        detail: {
          zh: "充分热身后、肌肉放松时柔韧表现更好；弹震式拉伸有受伤风险，应采用缓慢、持续的静态拉伸。",
          en: "Flexibility improves with a proper warm-up and relaxed muscles; ballistic stretching carries injury risk — slow, sustained static stretching is preferred.",
        },
      },
    ],
  },
  vital_capacity: {
    event: "vital_capacity",
    summary: {
      zh: "肺活量反映一次尽力呼吸的最大通气量，受呼吸肌力量、胸廓活动度和肺弹性影响。",
      en: "Vital capacity reflects the maximum air moved in one forced breath, influenced by respiratory-muscle strength, ribcage mobility and lung elasticity.",
    },
    factors: [
      {
        name: { zh: "呼吸肌力量", en: "Respiratory-muscle strength" },
        detail: {
          zh: "膈肌与肋间肌的力量决定吸气的扩张程度与呼气的彻底程度。",
          en: "Strength of the diaphragm and intercostals sets how fully the chest can expand and how completely air can be expelled.",
        },
      },
      {
        name: { zh: "有氧基础", en: "Aerobic base" },
        detail: {
          zh: "规律的有氧训练能增强呼吸效率、改善胸廓活动度，是提升肺活量表现的安全途径。",
          en: "Regular aerobic training improves breathing efficiency and ribcage mobility, which is the safe path to a better result.",
        },
      },
      {
        name: { zh: "动作配合", en: "Testing technique" },
        detail: {
          zh: "测试时站姿、深吸气后匀速用力呼气、避免漏气，能帮助发挥真实水平（属于测试技巧，非健康干预）。",
          en: "On test day, posture, a full inhale then a steady forceful exhale, and a tight seal help reveal the real value — this is test technique, not a health intervention.",
        },
      },
    ],
  },
  bmi: {
    event: "bmi",
    summary: {
      zh: "BMI 是身高体重的统计指标，不作为可训练项目；系统不会据此提供减重或饮食限制建议。",
      en: "BMI is a height/weight statistic, not a trainable event; the system does not give weight-loss or dietary-restriction advice based on it.",
    },
    factors: [
      {
        name: { zh: "说明", en: "Note" },
        detail: {
          zh: "本系统只记录与展示 BMI 得分。任何关于体重或饮食的问题，请咨询校医或专业人员。",
          en: "This system only records and displays the BMI score. For any weight or nutrition question, consult a clinician or qualified professional.",
        },
      },
    ],
  },
};

/** Return the factor analysis for one event, or null if not applicable. */
export function factorsFor(event: FitnessItemId): EventAnalysis {
  return EVENT_FACTORS[event];
}
