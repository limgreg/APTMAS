// Training knowledge base — evidence-based drill advice per test item, in
// zh/en/ko. Adapted from the Task B agent bundle. Content is grounded: the
// agent may only repeat training advice that is present here, and every tip is
// attached to a citable node in buildContext() (see aptams/agent.ts).
//
// Safety: no weight-loss, caloric-deficit, or dietary-restriction advice lives
// here (AGENTS.md core rule #6). BMI is deliberately not actionable: its entry
// only states that body composition is not a training target here and concerns
// should go to a health professional. This mirrors the safety classifier in
// agent.ts and must not be weakened.

export interface TrainingTip {
  zh: string;
  en: string;
  ko: string;
}

export interface TrainingKnowledgeItem {
  id: string;
  name: { zh: string; en: string; ko: string };
  description: { zh: string; en: string; ko: string };
  tips: TrainingTip[];
  commonMistakes: TrainingTip[];
}

export const TRAINING_KB: TrainingKnowledgeItem[] = [
  {
    id: "sprint_50m",
    name: { zh: "50米跑", en: "50m Sprint", ko: "50m 달리기" },
    description: {
      zh: "测试速度素质和爆发力，要求在跑道上以最快速度跑完50米。",
      en: "Tests speed and explosive power over 50 metres at maximum effort.",
      ko: "속도와 순발력을 측정하며, 트랙에서 50미터를 최고 속도로 달립니다.",
    },
    tips: [
      {
        zh: "阻力冲刺：拖拽雪橇/弹力带跑30–40m×4–6组，负荷以不破坏技术动作为限（Murphy et al. 2023, J Strength Cond Res, SMD=0.55）。",
        en: "Resisted sprint: sled/band towing 30–40m × 4–6 sets, load limited to preserve technique (Murphy et al. 2023, J Strength Cond Res, SMD=0.55).",
        ko: "저항 스프린트: 썰매/밴드 견인 30–40m × 4–6세트, 기술이 흐트러지지 않는 하중으로 (Murphy et al. 2023, J Strength Cond Res, SMD=0.55).",
      },
      {
        zh: "水平增强式：跨步跳、深跳、单脚跳，每次训练超过80次跳跃，重点发展水平推进力。",
        en: "Horizontal plyometrics: bounding, depth jumps, single-leg hops, over 80 ground contacts per session, emphasising horizontal propulsion.",
        ko: "수평 플라이오메트릭: 바운딩, 뎁스 점프, 외발 홉, 세션당 80회 이상 접지로 수평 추진력 발달.",
      },
      {
        zh: "最大速度训练：30–60m全力冲刺×6–8组，组间充分休息3–5分钟，保证每组质量。",
        en: "Max-speed work: 30–60m sprints × 6–8 sets with full 3–5 min recovery to keep quality high.",
        ko: "최대 속도: 30–60m 전력 질주 × 6–8세트, 세트 간 3–5분 충분히 회복하여 품질 확보.",
      },
      {
        zh: "技术要点：起跑前倾约45°驱动角，前脚掌着地，优先提高步频而非刻意加大步幅。",
        en: "Technique: ~45° drive angle at the start, forefoot strike, prioritise stride rate over forced stride length.",
        ko: "기술: 스타트 시 약 45° 구동각, 앞발 착지, 보폭보다 보빈(스텝 빈도) 우선.",
      },
    ],
    commonMistakes: [
      { zh: "起跑时身体过于直立", en: "Standing too upright at the start", ko: "스타트 시 상체가 너무 수직" },
      { zh: "步幅过大导致减速", en: "Overstriding causing deceleration", ko: "보폭이 너무 커서 감속" },
      { zh: "摆臂不充分", en: "Insufficient arm drive", ko: "불충분한 팔 스윙" },
    ],
  },
  {
    id: "endurance_run",
    name: {
      zh: "耐力跑（男1000米/女800米）",
      en: "Endurance run (1000m male / 800m female)",
      ko: "지구력 달리기 (남 1000m / 여 800m)",
    },
    description: {
      zh: "测试心肺耐力和有氧能力，男生跑1000米、女生跑800米。",
      en: "Tests cardiovascular endurance and aerobic capacity (1000m men, 800m women).",
      ko: "심폐 지구력과 유산소 능력을 측정합니다 (남 1000m, 여 800m).",
    },
    tips: [
      {
        zh: "经典4×4间歇：90–95%最大心率跑4分钟＋3分钟慢跑恢复，每周3次（Helgerud et al. 2007，8周VO2max提升约5%）。",
        en: "Classic 4×4 intervals: 4 min at 90–95% HRmax with 3 min jog recovery, 3x/week (Helgerud et al. 2007, ~5% VO2max gain in 8 weeks).",
        ko: "고전 4×4 인터벌: 최대심박수 90–95%로 4분 + 3분 조깅 회복, 주 3회 (Helgerud et al. 2007, 8주에 VO2max 약 5% 향상).",
      },
      {
        zh: "长时HIIT：每组不少于2分钟、每次累计不少于15分钟、持续4周以上，可最大化有氧能力增益（Wen et al. 2019，53项RCT荟萃）。",
        en: "Long-interval HIIT: ≥2 min bouts, ≥15 min per session, sustained ≥4 weeks for maximal aerobic gain (Wen et al. 2019, 53-RCT meta-analysis).",
        ko: "장시간 HIIT: 세트당 ≥2분, 세션당 ≥15분, ≥4주 지속으로 유산소 능력 최대화 (Wen et al. 2019, 53개 RCT 메타분석).",
      },
      {
        zh: "持续有氧基础：以70–80%最大心率稳态跑30–40分钟，每周1–2次打有氧底子。",
        en: "Aerobic base: 30–40 min steady runs at 70–80% HRmax, 1–2x/week.",
        ko: "유산소 기초: 최대심박수 70–80%로 30–40분 안정적 달리기, 주 1–2회.",
      },
      {
        zh: "呼吸节奏：采用2步一吸2步一呼或3–3节奏；配速上前200米控制、中段匀速、最后200米再加速。",
        en: "Breathing: a 2-step inhale/2-step exhale or 3–3 rhythm; control the first 200m, hold steady, then finish hard.",
        ko: "호흡: 2보 1흡/2보 1호 또는 3–3 리듬; 처음 200m는 제어, 중간 균일, 마지막 200m 가속.",
      },
    ],
    commonMistakes: [
      { zh: "起跑过快导致后程掉速", en: "Starting too fast and fading late", ko: "너무 빠르게 시작해 후반 체력 부족" },
      { zh: "呼吸节奏紊乱", en: "Disordered breathing rhythm", ko: "호흡 리듬 혼란" },
      { zh: "忽视热身与跑后拉伸", en: "Skipping warm-up and cool-down", ko: "워밍업/정리 스트레칭 소홀" },
    ],
  },
  {
    id: "standing_long_jump",
    name: { zh: "立定跳远", en: "Standing long jump", ko: "제자리멀리뛰기" },
    description: {
      zh: "测试下肢爆发力与协调，双脚原地起跳、测量落地距离。",
      en: "Tests lower-body explosive power and coordination from a two-foot take-off.",
      ko: "하지 순발력과 협응력을 측정하며, 두 발로 제자리 도약해 착지 거리를 잽니다.",
    },
    tips: [
      {
        zh: "增强式训练：深跳、三级跳、纵跳、跨步跳，3–5组×6–10次，组间休息2–3分钟（2025 Scientific Reports荟萃，70项RCT/1703人，SMD=1.34）。",
        en: "Plyometrics: depth jumps, triple jump, vertical jumps and bounding, 3–5 × 6–10 with 2–3 min rest (2025 Scientific Reports meta, 70 RCTs/1703 participants, SMD=1.34).",
        ko: "플라이오메트릭: 뎁스 점프, 삼단뛰기, 수직 점프, 바운딩, 3–5세트 × 6–10회, 2–3분 휴식 (2025 Scientific Reports 메타, 70개 RCT/1703명, SMD=1.34).",
      },
      {
        zh: "力量基础：深蹲/弓步蹲3组×6–8次（约80–85% 1RM），配合提踵发展踝刚性。",
        en: "Strength base: squat/lunge 3 × 6–8 at ~80–85% 1RM, plus calf raises for ankle stiffness.",
        ko: "근력 기초: 스쿼트/런지 3세트 × 6–8회 (~80–85% 1RM), 카프 레이즈 병행으로 발목 강성 확보.",
      },
      {
        zh: "技术链条：反向预蹲→摆臂→爆发伸展→收腹举腿→屈膝缓冲落地，强调髋部的鞭打式伸展。",
        en: "Chain: countermovement → arm swing → explosive extension → tuck → cushioned landing; emphasise whip-like hip extension.",
        ko: "기술 연쇄: 카운터무브먼트 → 팔 스윙 → 폭발적 신전 → 무릎 모으기 → 완충 착지, 채찍형 고관절 신전 강조.",
      },
      {
        zh: "进阶安排：基础力量→弹跳训练→技术整合，每阶段4–6周；落地时注意膝对齐，避免膝外翻。",
        en: "Progress: strength → plyometrics → technique integration, 4–6 weeks per phase; keep knees aligned on landing to avoid valgus.",
        ko: "단계: 근력 → 플라이오메트릭 → 기술 통합, 단계별 4–6주; 착지 시 무릎 정렬을 유지해 내반/외반 주의.",
      },
    ],
    commonMistakes: [
      { zh: "起跳前踩线犯规", en: "Stepping over the line", ko: "도약 전 선을 넘음" },
      { zh: "只靠摆臂、腿部发力不足", en: "Relying on arm swing without leg drive", ko: "팔 동작에만 의존하고 다리 힘 부족" },
      { zh: "腾空不收腿导致距离缩短", en: "Not tucking the legs in flight", ko: "공중에서 다리를 모으지 않아 거리 감소" },
    ],
  },
  {
    id: "sit_and_reach",
    name: { zh: "坐位体前屈", en: "Sit-and-reach", ko: "좌위 체전굴" },
    description: {
      zh: "测试柔韧性，重点是腰背和大腿后侧肌群的伸展能力。",
      en: "Tests flexibility, especially the lower back and hamstrings.",
      ko: "유연성, 특히 허리와 대퇴 후측 근육군의 신장 능력을 측정합니다.",
    },
    tips: [
      {
        zh: "训练前动态热身：摆腿、躯干旋转、猫牛式，每侧10–15次，不会损害后续表现（Konrad et al. 2023, J Sport Health Sci）。",
        en: "Dynamic warm-up: leg swings, trunk rotations and cat-cow, 10–15 per side, without blunting performance (Konrad et al. 2023, J Sport Health Sci).",
        ko: "동적 워밍업: 레그 스윙, 몸통 회전, 캣카우, 좌우 10–15회, 수행력 저하 없음 (Konrad et al. 2023, J Sport Health Sci).",
      },
      {
        zh: "训练后静态/PNF拉伸：坐姿前屈保持30–60秒×3组；PNF收缩–放松优于单纯静态。",
        en: "Static/PNF after training: seated forward fold 30–60s × 3; contract-relax PNF outperforms static stretching alone.",
        ko: "훈련 후 정적/PNF: 좌위 전굴 30–60초 × 3세트; 수축-이완 PNF가 정적 스트레칭보다 효과적.",
      },
      {
        zh: "频率：每周不少于5天，4周可见活动度改善，8周以上效果更稳定。",
        en: "Frequency: ≥5 days/week; ROM improves in ~4 weeks and consolidates beyond 8 weeks.",
        ko: "빈도: 주 5일 이상; 약 4주에 가동범위 개선, 8주 이상에서 효과 공고화.",
      },
      {
        zh: "辅助动作：站立体前屈保持15–30秒、蝴蝶式拉伸大腿内侧；拉伸时保持均匀呼吸，不弹震。",
        en: "Accessories: standing forward fold 15–30s and butterfly for the inner thigh; breathe steadily and avoid bouncing.",
        ko: "보조: 서서 전굴 15–30초 유지, 나비 자세로 내측 스트레칭; 고르게 호흡하고 탄진 금지.",
      },
    ],
    commonMistakes: [
      { zh: "弹振式拉伸容易拉伤", en: "Bouncing stretches can cause strain", ko: "탄진식 스트레칭은 부상 위험" },
      { zh: "拉伸时憋气", en: "Holding the breath", ko: "스트레칭 중 호흡 멈춤" },
      { zh: "屈膝代偿", en: "Bending the knees to compensate", ko: "무릎을 굽혀 보상" },
    ],
  },
  {
    id: "strength",
    name: {
      zh: "力量项目（男引体向上/女仰卧起坐）",
      en: "Strength (male pull-ups / female sit-ups)",
      ko: "근력 (남 턱걸이 / 여 윗몸일으키기)",
    },
    description: {
      zh: "男生测试引体向上（上肢拉力），女生测试一分钟仰卧起坐（核心耐力）。",
      en: "Males perform pull-ups (upper-body pull strength); females perform one-minute sit-ups (core endurance).",
      ko: "남학생은 턱걸이(상체 당기는 힘), 여학생은 1분 윗몸일으키기(코어 지구력)를 측정합니다.",
    },
    tips: [
      {
        zh: "【男生】节奏离心：跳起至最高位，用3–5秒缓慢下落，5组×3–5次；12周渐进训练可显著增加最大次数。",
        en: "[Male] Tempo-eccentric: jump to the top and lower over 3–5s, 5 × 3–5; a 12-week progression substantially raises max reps.",
        ko: "[남] 템포-네거티브: 최고점에서 점프해 3–5초에 천천히 하강, 5세트 × 3–5회; 12주 점진으로 최대 횟수 유의미 증가.",
      },
      {
        zh: "【男生】力量储备：高位下拉4组×8–12次与悬垂/握力练习，为引体向上打基础。",
        en: "[Male] Build base: lat pulldown 4 × 8–12 plus hanging/grip work.",
        ko: "[남] 기초: 랫 풀다운 4세트 × 8–12회와 매달리기/악력 훈련.",
      },
      {
        zh: "【女生】1分钟计时练习＋渐进核心：卷腹、平板支撑、死虫式3组×15–30秒。",
        en: "[Female] 1-minute timed practice plus progressive core: crunches, plank, dead-bug 3 × 15–30s.",
        ko: "[여] 1분 타이머 연습 + 점진적 코어: 크런치, 플랭크, 데드버그 3세트 × 15–30초.",
      },
      {
        zh: "动作特异性：贴近考试动作的训练对该项成绩提升最直接；保持动作规范，避免借摆浪或抱头硬拉。",
        en: "Specificity: practising the tested movement transfers best; keep strict form and avoid kipping or pulling the neck.",
        ko: "특이성: 시험 동작과 유사한 훈련이 가장 직접적 전이; 규범 동작 유지, 킥잉/머리 잡아당기기 금지.",
      },
    ],
    commonMistakes: [
      { zh: "引体向上借摆动惯性", en: "Kipping/swinging on pull-ups", ko: "스윙 관성을 이용한 턱걸이" },
      { zh: "仰卧起坐双手抱头硬拉颈部", en: "Pulling the neck during sit-ups", ko: "윗몸일으키기 시 손으로 머리 당김" },
      { zh: "训练频率过高造成疲劳累积", en: "Overtraining without recovery", ko: "회복 없이 잦은 훈련으로 피로 누적" },
    ],
  },
  {
    id: "vital_capacity",
    name: { zh: "肺活量", en: "Vital capacity", ko: "폐활량" },
    description: {
      zh: "测试一次最大通气量，反映呼吸肌力量与肺通气能力。",
      en: "Measures maximal exhaled volume, reflecting respiratory-muscle strength and ventilatory capacity.",
      ko: "최대 호기량을 측정해 호흡근력과 환기 능력을 반영합니다.",
    },
    tips: [
      {
        zh: "有氧基础是关键：每周3–5次中高强度跑、游泳或跳绳，持续20–40分钟，提升心肺与呼吸肌耐力。",
        en: "Aerobic base is key: 3–5 sessions/week of moderate-to-vigorous running, swimming or skipping, 20–40 min, to build cardio-respiratory endurance.",
        ko: "유산소 기초가 핵심: 주 3–5회 중·고강도 달리기, 수영, 줄넘기 20–40분으로 심폐·호흡근 지구력 향상.",
      },
      {
        zh: "呼吸肌训练：每日数次腹式呼吸（吸气4秒–屏息2秒–呼气6–8秒），强化膈肌与肋间肌。",
        en: "Respiratory-muscle training: daily diaphragmatic breathing (4s inhale – 2s hold – 6–8s exhale) to strengthen diaphragm and intercostals.",
        ko: "호흡근 훈련: 매일 복식호흡 (4초 들이쉼 – 2초 멈춤 – 6–8초 내쉼)으로 횡경막과 늑간근 강화.",
      },
      {
        zh: "测量技巧：测试前充分吸气、贴紧吹嘴、匀速持续呼气不要漏气；站姿放松、避免耸肩。",
        en: "Test technique: inhale fully, seal the mouthpiece and exhale steadily without leaking; stand relaxed and avoid shrugging.",
        ko: "측정 요령: 최대 흡기 후 마우스피스를 밀착, 새지 않게 일정하게 지속 호기; 어깨 힘 빼고 편 자세.",
      },
    ],
    commonMistakes: [
      { zh: "吹气过快导致后半段无力", en: "Bursting too fast and fading", ko: "너무 빨리 불어 후반 호기 부족" },
      { zh: "吹嘴未贴紧造成漏气", en: "Poor seal causing air leak", ko: "마우스피스 밀착 불량으로 공기 누출" },
      { zh: "吸气不充分", en: "Not inhaling fully first", ko: "최대 흡기 부족" },
    ],
  },
  {
    id: "bmi",
    name: { zh: "BMI（身体质量指数）", en: "BMI (body mass index)", ko: "BMI (체질량지수)" },
    description: {
      zh: "BMI由身高与体重计算，本系统中仅作为身体组成的背景信息，不作为可训练目标。",
      en: "BMI is computed from height and mass; in this system it is background body-composition context, never an actionable training target.",
      ko: "BMI는 키와 몸무게로 계산되며, 이 시스템에서는 배경 정보일 뿐 훈련 목표가 아닙니다.",
    },
    tips: [
      {
        zh: "本系统不提供减重、热量缺口或饮食限制建议；对体型或健康有疑虑时请咨询校医或健康专业人员。",
        en: "This system does not give weight-loss, calorie-deficit or dietary-restriction advice; speak to a clinician or health professional about body-composition concerns.",
        ko: "이 시스템은 체중 감량, 칼로리 결핍, 식이 제한 조언을 하지 않습니다. 체형이나 건강 우려는 보건 교사나 의료 전문가와 상담하세요.",
      },
      {
        zh: "提升体测成绩应聚焦在速度、耐力、力量、柔韧等可训练项目，并以规律的有氧与力量活动为基础。",
        en: "To improve the test, focus on trainable items—speed, endurance, strength, flexibility—built on regular aerobic and strength activity.",
        ko: "기록 향상은 속도, 지구력, 근력, 유연성 등 훈련 가능한 항목과 규칙적인 유산소·근력 활동에 집중하세요.",
      },
    ],
    commonMistakes: [
      { zh: "把BMI当作需要快速降低的目标", en: "Treating BMI as a number to rapidly push down", ko: "BMI를 급격히 낮춰야 할 목표로 보기" },
    ],
  },
];

const KB_BY_ID = new Map(TRAINING_KB.map((it) => [it.id, it]));

export function getTrainingItem(id: string): TrainingKnowledgeItem | undefined {
  return KB_BY_ID.get(id);
}
