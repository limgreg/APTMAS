import { NextRequest } from "next/server";
import { Config, LLMClient } from "coze-coding-dev-sdk";
import { getSession, jsonError } from "@/lib/aptams/api-auth";
import { getStore } from "@/lib/aptams/store";
import { buildContext, safetyCheck, type Locale } from "@/lib/aptams/agent";
import { buildSystemPrompt, parseSentences } from "@/lib/aptams/prompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ChatBody {
  message: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  student_id?: string;
  locale?: Locale;
}

const MODEL = process.env.APTAMS_LLM_MODEL ?? "doubao-seed-2-0-mini-260215";

let _client: LLMClient | null = null;
function getClient(): LLMClient {
  if (!_client) {
    _client = new LLMClient(
      new Config({
        apiKey: process.env.COZE_API_KEY ?? "",
        baseUrl: process.env.COZE_BASE_URL,
        modelBaseUrl: process.env.COZE_MODEL_BASE_URL,
      }),
    );
  }
  return _client;
}

function sse(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(
    `event: ${event}\n` + `data: ${JSON.stringify(data)}\n\n`,
  );
}

// Accept both string and LangChain content-block shapes without importing types.
function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (typeof c === "string") return c;
        if (c && typeof c === "object" && "text" in c) {
          const t = (c as { text?: unknown }).text;
          return typeof t === "string" ? t : "";
        }
        return "";
      })
      .join("");
  }
  return "";
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as ChatBody | null;
  if (!body?.message) return jsonError("message required", 400);

  const locale: Locale =
    body.locale === "en" || body.locale === "ko" ? body.locale : "zh";

  const session = getSession(req);
  if (!session) return jsonError("not signed in", 401);
  const role = session.role;
  const store = getStore();

  // A student may only ever ask about themselves: the id comes from the session and
  // `body.student_id` is ignored outright. Previously it was honoured, so a student could
  // ask the agent to narrate another student's record. A teacher may name a student, and
  // buildContext() then applies the role filter so no reported-layer field reaches them.
  const studentId =
    role === "student" ? session.subject : (body.student_id ?? store.defaultStudentId);
  const student = store.getStudent(studentId);
  if (!student) return jsonError("student not found", 404);

  // 1) Structural safety: refuse unsafe intents before any LLM call.
  const safety = safetyCheck(body.message, locale);
  if (safety.unsafe && safety.refusal) {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(sse("delta", { text: safety.refusal!.text }));
        controller.enqueue(
          sse("sentence", {
            text: safety.refusal!.text,
            source_node_ids: safety.refusal!.source_node_ids,
            kind: safety.refusal!.kind,
          }),
        );
        controller.enqueue(sse("done", { grounded: true }));
        controller.close();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  }

  // 2) Build the closed provenance context (privacy-filtered by role) + prompt.
  const context = buildContext(student, role, body.message, locale);
  const systemPrompt = buildSystemPrompt(context, student, locale);
  const knownIds = new Set<string>([
    ...context.nodes.map((n) => n.node_id),
    ...context.guideline_clauses.map((n) => n.node_id),
  ]);

  const messages = [
    { role: "system" as const, content: systemPrompt },
    ...(body.history ?? [])
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-6)
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    { role: "user" as const, content: body.message },
  ];

  // 3) Stream raw deltas for a typewriter UI, then validate grounding on end.
  const encoder = new TextEncoder();
  let accumulated = "";
  // We strip "[source:...]" citation markers from the live typewriter text but
  // keep the raw text in `accumulated` so the final grounding parse can read
  // the citations. `cleanLen` tracks how much of the cleaned stream we have
  // already emitted; `citationBuf` holds a possibly-incomplete "[source:..."
  // span until we know whether it closes (never emit it) or is ordinary text.
  let citationBuf: string | null = null;
  let emittedRawLen = 0;
  const CITATION_OPEN = "[";
  const CITATION_PREFIX = "[source:";

  // Returns the cleaned (citation-free) text that should be shown for the
  // current accumulated string, while preserving any unterminated span in the
  // buffer in case the model is mid-tag.
  function drainClean(): string {
    // First finalize any previously-held open span against new text.
    // We operate on the tail of `accumulated` only.
    let out = "";
    // Process the not-yet-emitted suffix using the buffer state machine.
    while (true) {
      if (citationBuf === null) {
        const idx = accumulated.indexOf(CITATION_OPEN, emittedRawLen);
        if (idx === -1) {
          out += accumulated.slice(emittedRawLen);
          emittedRawLen = accumulated.length;
          break;
        }
        out += accumulated.slice(emittedRawLen, idx);
        citationBuf = "";
        emittedRawLen = idx;
        // fall through to consume from idx
      }
      // We are inside/starting a potential citation span at emittedRawLen.
      const remaining = accumulated.slice(emittedRawLen);
      if (citationBuf === "") {
        // Just saw '['. Decide whether it starts a citation tag once we have
        // enough characters to match the prefix.
        if (remaining.length < CITATION_PREFIX.length) {
          // Need more chars; hold.
          break;
        }
        if (remaining.startsWith(CITATION_PREFIX)) {
          citationBuf = CITATION_PREFIX;
          emittedRawLen += CITATION_PREFIX.length;
          // continue consuming until ']'
        } else {
          // Not a citation: emit the '[' as ordinary text and continue.
          out += CITATION_OPEN;
          emittedRawLen += 1;
          citationBuf = null;
          continue;
        }
      }
      // citationBuf holds "[source:"; scan for closing ']'
      const closeIdx = accumulated.indexOf("]", emittedRawLen);
      if (closeIdx === -1) {
        // Check it still looks like a citation (alnum/colon/underscore/hyphen/dot).
        const tail = accumulated.slice(emittedRawLen);
        if (/^[a-zA-Z0-9:._-]*$/.test(tail)) {
          // Still a plausible in-progress citation; hold.
          break;
        }
        // Diverged — treat as ordinary text: emit the held prefix + tail so far.
        out += citationBuf + tail;
        emittedRawLen = accumulated.length;
        citationBuf = null;
        break;
      }
      // Found the closing ']'. Validate the id; discard the whole span.
      const id = accumulated.slice(emittedRawLen, closeIdx);
      if (/^[a-zA-Z0-9:._-]+$/.test(id)) {
        // Valid citation tag — drop it silently.
        emittedRawLen = closeIdx + 1;
        citationBuf = null;
        continue;
      }
      // Malformed — emit as ordinary text.
      out += citationBuf + id + "]";
      emittedRawLen = closeIdx + 1;
      citationBuf = null;
      continue;
    }
    return out;
  }

  const stream = new ReadableStream({
    async start(controller) {
      // Send the provenance palette so the UI can render citation chips.
      controller.enqueue(
        sse("sources", {
          sources: [...context.nodes, ...context.guideline_clauses].map(
            (n) => ({
              id: n.node_id,
              kind: n.kind,
              layer: n.layer,
              summary_zh: n.summary_zh,
              summary_en: n.summary_en,
              summary_ko: n.summary_ko ?? n.summary_en,
            }),
          ),
        }),
      );

      try {
        const client = getClient();
        const gen = client.stream(
          messages,
          {
            model: MODEL,
            streaming: true,
            thinking: "disabled",
            temperature: 0.3,
          },
        );
        for await (const chunk of gen) {
          const piece = extractText(chunk.content);
          if (piece) {
            accumulated += piece;
            const clean = drainClean();
            if (clean) controller.enqueue(sse("delta", { text: clean }));
          }
        }
        // Flush any trailing non-citation text held in the buffer.
        if (citationBuf !== null) {
          controller.enqueue(sse("delta", { text: citationBuf }));
          citationBuf = null;
        }

        // 4) Grounding gate: only sentences with valid citations survive.
        const sentences = parseSentences(accumulated, knownIds);
        const groundedCount = sentences.length;
        for (const s of sentences) {
          controller.enqueue(sse("sentence", s));
        }
        if (sentences.length === 0) {
          const fallback =
            locale === "zh"
              ? "抱歉，基于当前已核实的数据，我无法给出有依据的回答；建议咨询体育老师或校医。"
              : "Sorry — I can't give a grounded answer from the verified data available; please consult a PE teacher or clinician.";
          controller.enqueue(sse("delta", { text: "\n\n" + fallback }));
          controller.enqueue(
            sse("sentence", {
              text: fallback,
              source_node_ids: ["flag:needs_human", "guideline:aptams:escalation"].filter(
                (id) => knownIds.has(id),
              ),
              kind: "escalation",
            }),
          );
        }
        controller.enqueue(
          sse("done", { grounded: groundedCount > 0, groundedCount }),
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        controller.enqueue(sse("error", { message: msg }));
        const fallback =
          locale === "zh"
            ? "模型服务暂时不可用。以上结论均来自体测数据与公开标准，可参考已展示的分数、趋势与提分路径；需要建议请咨询体育老师。"
            : "The model service is temporarily unavailable. The scores, trend and route above come directly from the test data and public standard; consult a PE teacher for advice.";
        controller.enqueue(sse("delta", { text: fallback }));
      } finally {
        controller.close();
      }
    },
  });

  // Use encoder to silence unused warning; encoding is done via sse() helper.
  void encoder;

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
