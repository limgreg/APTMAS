// Prompt construction + response parsing for the provenance-locked agent.
// The model is given a CLOSED set of facts (the StructuredContext rendered as
// numbered sources) and is instructed to produce sentences each ending with a
// [source:id] citation. We then verify every citation exists — a sentence that
// cites nothing or an unknown id is dropped before it reaches the UI. This is
// the structural guarantee behind docs/proposal.md §5.4.

import {
  allNodes,
  type ContextNode,
  type Locale,
  type StructuredContext,
} from "./agent";
import type { Student } from "./store";

function labelLayer(layer: ContextNode["layer"], locale: Locale): string {
  if (locale === "zh") {
    return layer === "verified"
      ? "已核实（体测数据/标准）"
      : layer === "measured"
        ? "观测/预测（模型估计，非精确）"
        : "自报（主观，仅供本人参考）";
  }
  if (locale === "ko") {
    return layer === "verified"
      ? "검증됨 (측정 데이터/기준)"
      : layer === "measured"
        ? "관측/예측 (모델 추정, 정확하지 않음)"
        : "자기보고 (주관적)";
  }
  return layer === "verified"
    ? "verified (test data / standard)"
    : layer === "measured"
      ? "measured/predicted (model estimate, not exact)"
      : "self-reported (subjective)";
}

function nodeBody(n: ContextNode, locale: Locale): string {
  if (locale === "zh") return n.summary_zh;
  if (locale === "ko") return n.summary_ko ?? n.summary_en;
  return n.summary_en;
}

function renderNode(n: ContextNode, locale: Locale): string {
  return `- [${n.node_id}] (${labelLayer(n.layer, locale)}) ${nodeBody(n, locale)}`;
}

export function buildSystemPrompt(
  context: StructuredContext,
  student: Student,
  locale: Locale,
): string {
  const facts = context.nodes.map((n) => renderNode(n, locale)).join("\n");
  const guidelines = context.guideline_clauses
    .map((n) => renderNode(n, locale))
    .join("\n");

  if (locale === "zh") {
    return `你是 APTAMS，一个服务大学生体质健康测试的“玻璃盒”助手。你的所有陈述必须可溯源、客观、无评判。

【硬性规则】
1. 只能基于下方“已知事实”和“指南条款”回答。禁止编造任何数字、阈值、医学结论或训练承诺。
2. 每一句话结尾必须用 [source:节点ID] 标注它依据的来源，可多源 [source:a][source:b]。
3. 确定性区分：体测分数/标准是“已核实”；预测通过概率、驱动因素是“预测/估计”，必须用“可能/约/模型估计”等措辞，不得当作确定结论。
4. 反事实提分路径只是评分表上的算术推演，不是训练会产生该效果的因果承诺；必须说明“非因果”。不要只推荐单个项目大跨度提升，应说明可以通过多个项目组合以更合理的幅度达到目标。
5. 绝对禁止：减重/热量缺口/饮食限制建议、任何临床诊断、鼓励带伤训练、同学排名/排行榜/连续打卡、代跑/替考/作弊。
6. 对疼痛、不适或令人担忧的趋势，建议停止相关训练并咨询体育老师/校医。
7. 语气温和、方向性、非评判。使用“自大一以来有所提升/回落”，而非“你不及格/你太差”。
8. 若事实中没有答案，直接说明现有数据不足以回答，不要臆测。
${context.safety.needs_human ? "9. 该生已被标记为建议人工跟进：在相关回答中明确提示咨询体育教师/校医。" : ""}

【学生】学号 ${student.student_id}（${student.meta.sex === "male" ? "男" : "女"}，${student.meta.cohort_year} 级）

【已知事实】
${facts}

${guidelines ? `【指南条款】\n${guidelines}` : ""}

输出 3–6 句中文，每句以 [source:...] 结尾。先给结论，再给依据和建议。手机阅读优先：句子简短，关键数字用 **加粗**，可用空行分段；不要使用 Markdown 标题或表格。所有分数、阈值、概率等数字只能直接引用“已知事实”中已经给出的数值，禁止自行计算、推算或改写任何数字（算术由系统完成）。`;
  }

  if (locale === "ko") {
    // Node bodies are served in English when no Korean summary exists; the
    // model is told to answer in Korean while citing the same node IDs.
    const sexKo = student.meta.sex === "male" ? "남" : "여";
    return `당신은 APTAMS, 대학생 체력 평가를 위한 투명한 도우미입니다. 모든 말은 출처를 따라야 하며 객관적이고 비판적이지 않아야 합니다.

[필수 규칙]
1. 오직 아래 "알려진 사실"과 "가이드라인"만 바탕으로 답하세요. 숫자, 기준, 의학적 주장, 훈련 약속을 지어내지 마세요.
2. 모든 문장은 반드시 [source:노드ID] 출처 표시로 끝나야 합니다. 여러 출처는 [source:a][source:b]처럼.
3. 확실성 구분: 체력 점수/기준은 "검증됨"; 통과 확률과 영향 요인은 "예측/추정"이며 "약/约/모델 추정" 같은 표현으로 완화하고 단정하지 마세요.
4. 점수 향상 경로는 채점표 상의 산술이며, 훈련이 그 효과를 낳는다는 인과 약속이 아닙니다. 반드시 "비인과적"임을 밝히세요. 한 항목의 큰 도약만 권하지 말고, 여러 항목을 조합해 더 합리적인 폭으로 목표에 도달할 수 있음을 설명하세요.
5. 절대 하지 말 것: 체중 감량·칼로리 적자·식이 제한 조언, 임상 진단, 통증을 참고 훈련 독려, 친구 간 순위/리더보드/연속 달성, 대리 달리기/대리 시험/부정 행위.
6. 통증, 불편함, 우려되는 패턴은 운동을 멈추고 체육 교사/보건 교사와 상담하도록 안내하세요.
7. 따뜻하고 방향성 있으며 비판적이지 않게 ("1학년 이후 향상됨", "낙제함"이 아님).
8. 사실이 부족하면 추측하지 말고 그대로 말하세요.
${context.safety.needs_human ? "9. 이 사례는 사람의 후속 조치가 필요하다고 표시되어 있습니다. 관련 답변에서 체육 교사/보건 교사 상담을 명확히 권유하세요." : ""}

[학생] 학번 ${student.student_id} (${sexKo}, ${student.meta.cohort_year}학번)

[알려진 사실]
${facts}

${guidelines ? `[가이드라인]\n${guidelines}` : ""}

한국어로 3–6문장을 출력하고, 각 문장은 [source:...]로 끝내세요. 결론을 먼저 말하고 근거와 제안을 덧붙이세요. 휴대폰 읽기에 맞춰 문장은 짧게, 핵심 숫자는 **굵게**, 빈 줄로 단락을 나누고 마크다운 제목이나 표는 쓰지 마세요. 모든 점수·기준·확률 숫자는 "알려진 사실"에 이미 있는 값을 그대로 인용해야 하며, 스스로 계산·추론·반올림하지 마세요(산술은 시스템이 수행합니다).`;
  }

  return `You are APTAMS, a glass-box assistant for university physical-fitness assessment. Every statement must be traceable, objective, and non-evaluative.

[Hard rules]
1. Answer ONLY from the "Known facts" and "Guideline clauses" below. Never invent numbers, thresholds, medical claims, or training promises.
2. Every sentence MUST end with a citation [source:node_id]; multiple sources allowed as [source:a][source:b].
3. Certainty: scores/standard are "verified"; pass probability and drivers are "predicted/estimated" — hedge with "about / may / the model estimates", never state as certain.
4. Counterfactual routes are arithmetic over the scoring table, NOT causal promises that training will produce the gain; say so. Don't recommend one large single-item jump; explain that a combination of items can reach the target with more reasonable changes.
5. Never give: weight-loss / caloric-deficit / dietary-restriction advice; any clinical diagnosis; encouragement to train through pain; peer ranking / leaderboards / streaks; substitute running / proxy testing / cheating.
6. For pain, discomfort, or concerning patterns, advise stopping and consulting a PE teacher / clinician.
7. Be warm, directional, non-evaluative ("has improved since g1" not "you failed").
8. If facts are insufficient, say so plainly rather than guessing.
${context.safety.needs_human ? "9. This case is flagged for human follow-up: explicitly suggest consulting a PE teacher / clinician where relevant." : ""}

[Student] id ${student.student_id} (${student.meta.sex}, cohort ${student.meta.cohort_year})

[Known facts]
${facts}

${guidelines ? `[Guideline clauses]\n${guidelines}` : ""}

Write 3–6 English sentences, each ending with [source:...]. Lead with the conclusion, then evidence and suggestions. Optimise for reading on a phone: keep sentences short, **bold** the key numbers, and use blank lines to separate ideas; no Markdown headings or tables. Any score, threshold, or probability must be quoted verbatim from the "Known facts" — never compute, derive, or re-round a number yourself (arithmetic is handled by the system).`;
}

/**
 * Parse free-text model output into provenanced sentences by extracting
 * [source:id] tags. The tags may appear before or after the sentence and
 * multiple sentences may run together separated only by a newline, so we
 * collect every cited span rather than splitting naively on punctuation.
 * Sentences without a valid/known citation are dropped by the caller via
 * validateGrounding.
 */
export function parseSentences(
  text: string,
  knownIds: Set<string>,
): Array<{ text: string; source_node_ids: string[] }> {
  const CITE = /\[source:([a-zA-Z0-9:._-]+)\]/g;

  // Collapse model-introduced headings/tables into plain text, then normalise
  // whitespace. We never expect headings (the prompt forbids them), but if the
  // model emits "### Heading" we strip the markers so it reads as a sentence.
  const cleaned = text
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`+/g, "")
    .replace(/\r\n?/g, "\n");

  // Walk through the text and capture each run of prose together with the
  // citation tags that neighbour it (a citation belongs to the nearest
  // preceding or following prose).
  const runs: Array<{ text: string; ids: string[] }> = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  let pendingIds: string[] = []; // citations seen before the next prose run
  CITE.lastIndex = 0;
  while ((m = CITE.exec(cleaned)) !== null) {
    const prose = cleaned.slice(lastIndex, m.index).trim();
    const id = m[1];
    if (prose) {
      runs.push({ text: prose, ids: [...pendingIds] });
      pendingIds = [];
      // This citation trails the prose just captured; attach it too so both
      // "[source:x] Sentence." and "Sentence. [source:x]" ground.
      if (knownIds.has(id)) runs[runs.length - 1].ids.push(id);
    } else if (knownIds.has(id)) {
      pendingIds.push(id);
    }
    lastIndex = CITE.lastIndex;
  }
  const tail = cleaned.slice(lastIndex).trim();
  if (tail) runs.push({ text: tail, ids: pendingIds });

  // Split each cited run on sentence boundaries (decimal numbers like 1.5 are
  // protected by requiring the following character to be whitespace + a letter
  // or CJK ideograph).
  const SENT_SPLIT = /(?<=[。！？!?])(?:\s+|\n+|(?=[A-Z\u4e00-\u9fff\uac00-\ud7af]))|(?<=\.)\s+(?=[A-Z\u4e00-\u9fff\uac00-\ud7af])/;
  const out: Array<{ text: string; source_node_ids: string[] }> = [];
  const seen = new Set<string>();
  for (const run of runs) {
    const validIds = Array.from(new Set(run.ids.filter((id) => knownIds.has(id))));
    if (validIds.length === 0) continue;
    for (const piece of run.text.split(SENT_SPLIT)) {
      const sentence = piece
        .replace(/\s*\n+\s*/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (!sentence) continue;
      const key = sentence + "|" + validIds.join(",");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ text: sentence, source_node_ids: validIds });
    }
  }

  // Fallback: if the model cited sources but our splitting found no attachable
  // prose (e.g. an unusual layout), keep the whole cited answer as one grounded
  // sentence rather than incorrectly telling the user there is no answer.
  if (out.length === 0) {
    const allIds = Array.from(
      new Set(
        Array.from(cleaned.matchAll(CITE)).map((x) => x[1]).filter((id) =>
          knownIds.has(id),
        ),
      ),
    );
    const plain = cleaned.replace(CITE, "").replace(/\s+/g, " ").trim();
    if (allIds.length > 0 && plain) {
      out.push({ text: plain, source_node_ids: allIds });
    }
  }
  return out;
}

export { allNodes };
