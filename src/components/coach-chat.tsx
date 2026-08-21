"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Camera, Mic, Send } from "lucide-react";
import {
  analyzeMealPhoto,
  streamChat,
  type ChatEvent,
  type MealAnalysis,
  type Session,
  type SourceInfo,
} from "@/lib/api";
import type { Locale, Student } from "@/lib/types";
import { dict, type Dict } from "@/lib/i18n";
import { useLanguage } from "@/components/language-context";
import {
  CitedAnswer,
  MarkdownText,
  type CitedSentence,
} from "@/components/markdown-text";
import { cn } from "@/lib/utils";

/** Imperative surface so the shell / other views can hand a prompt to the coach. */
export interface CoachHandle {
  ask: (prompt: string) => void;
}

// Minimal Web Speech API typings (see aptams-shell.tsx for the rationale).
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionErrorEventLike {
  error: string;
}
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}
interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionLike;
}
function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
  /** Parsed grounded sentences with their source ids (assistant turns). */
  citations?: CitedSentence[];
  /** Optional meal-estimate attached to a user turn (shown as a result card). */
  meal?: MealAnalysis;
  /** Optional thumbnail data URI for a meal photo the user attached. */
  image?: string;
}

const PROMPTS: Record<Locale, string[]> = {
  en: [
    "Why did my score drop this year?",
    "What's my fastest path to 80?",
    "Show me my weakest item",
    "Build me a 4-week plan",
    "Am I on track to pass?",
    "How do I improve my endurance run?",
    "Explain my radar profile",
  ],
  zh: [
    "我今年的总分为什么下降了？",
    "达到 80 分最快的路径是什么？",
    "我最薄弱的项目是哪个？",
    "帮我制定一个四周训练计划",
    "我目前能通过体测吗？",
    "怎样提升耐力跑成绩？",
    "解释一下我的雷达图轮廓",
  ],
  ko: [
    "올해 총점이 왜 떨어졌나요?",
    "80점까지 가장 빠른 길은?",
    "가장 약한 항목을 보여줘",
    "4주 훈련 계획을 짜줘",
    "통과 궤도에 있나요?",
    "耐力跑(오래달리기)은 어떻게 향상하나요?",
    "내 레이더 프로필을 설명해줘",
  ],
};

export const CoachChat = forwardRef<
  CoachHandle,
  {
    student: Student;
    role: "student" | "teacher";
  }
>(function CoachChat({ student, role }, ref) {
  const { lang: locale } = useLanguage();
  const tr = dict[locale];
  const session: Session = useMemo(
    () => ({ role, studentId: student.student_id, locale }),
    [role, student.student_id, locale],
  );

  const [input, setInput] = useState("");
  const [history, setHistory] = useState<ChatTurn[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [current, setCurrent] = useState("");
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [grounded, setGrounded] = useState<number | null>(null);

  // Voice
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const finalTranscriptRef = useRef("");
  const [recording, setRecording] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  // Meal photo
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [analyzingMeal, setAnalyzingMeal] = useState(false);
  const [mealError, setMealError] = useState<string | null>(null);
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [pendingMeal, setPendingMeal] = useState<MealAnalysis | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sourceListRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [history, current]);

  const onCite = useCallback((id: string) => {
    const el = sourceListRef.current;
    if (!el) return;
    const row = el.querySelector<HTMLElement>(`[data-source-id="${id}"]`);
    row?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    row?.classList.add("source-flash");
    window.setTimeout(() => row?.classList.remove("source-flash"), 1200);
  }, []);

  useEffect(() => {
    setHistory([]);
    setCurrent("");
    setInput("");
    setSources([]);
    setGrounded(null);
  }, [locale]);

  useEffect(() => () => recognitionRef.current?.stop(), []);

  const speechLang =
    locale === "ko" ? "ko-KR" : locale === "en" ? "en-US" : "zh-CN";

  const stopRecording = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const toggleRecording = useCallback(() => {
    const SR = getSpeechRecognition();
    if (!SR) {
      setVoiceError(
        locale === "zh"
          ? "当前浏览器不支持语音输入"
          : locale === "ko"
            ? "이 브라우저는 음성 입력을 지원하지 않습니다"
            : "Voice input is not supported in this browser",
      );
      return;
    }
    if (recording) {
      stopRecording();
      return;
    }
    setVoiceError(null);
    finalTranscriptRef.current = "";
    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = speechLang;
    recognition.onstart = () => setRecording(true);
    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) finalTranscriptRef.current += r[0].transcript + " ";
        else interim += r[0].transcript;
      }
      setInput((finalTranscriptRef.current + interim).trim());
    };
    recognition.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setVoiceError(
          locale === "zh"
            ? "请允许使用麦克风"
            : locale === "ko"
              ? "마이크 권한을 허용해 주세요"
              : "Please allow microphone access",
        );
      } else if (event.error !== "no-speech" && event.error !== "aborted") {
        setVoiceError(
          locale === "zh"
            ? "语音识别失败，请重试"
            : locale === "ko"
              ? "음성 인식에 실패했습니다"
              : "Speech recognition failed",
        );
      }
    };
    recognition.onend = () => setRecording(false);
    recognitionRef.current = recognition;
    recognition.start();
  }, [recording, speechLang, locale, stopRecording]);

  const onPickPhoto = () => fileInputRef.current?.click();

  const handlePhoto = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) return;
      setMealError(null);
      const dataUri = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("read failed"));
        reader.onload = () => {
          const img = new Image();
          img.onerror = () => reject(new Error("decode failed"));
          img.onload = () => {
            const max = 1024;
            const scale = Math.min(1, max / Math.max(img.width, img.height));
            const w = Math.round(img.width * scale);
            const h = Math.round(img.height * scale);
            const canvas = document.createElement("canvas");
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext("2d");
            if (!ctx) {
              resolve(reader.result as string);
              return;
            }
            ctx.drawImage(img, 0, 0, w, h);
            resolve(canvas.toDataURL("image/jpeg", 0.82));
          };
          img.src = reader.result as string;
        };
        reader.readAsDataURL(file);
      });

      setPendingImage(dataUri);
      setAnalyzingMeal(true);
      try {
        const analysis = await analyzeMealPhoto(dataUri, locale);
        setPendingMeal(analysis);
      } catch {
        setMealError(
          locale === "zh"
            ? "图像识别失败，请换一张更清晰的照片"
            : locale === "ko"
              ? "이미지 인식에 실패했습니다"
              : "Image analysis failed; try a clearer photo",
        );
        setPendingImage(null);
      } finally {
        setAnalyzingMeal(false);
      }
    },
    [locale],
  );

  const send = useCallback(
    async (prompt?: string) => {
      const text = (prompt ?? input).trim();
      if ((!text && !pendingMeal) || streaming) return;

      const userTurn: ChatTurn = {
        role: "user",
        content: text,
        meal: pendingMeal ?? undefined,
        image: pendingImage ?? undefined,
      };
      const nextHist = [...history, userTurn];
      setHistory(nextHist);
      setInput("");
      setPendingImage(null);
      setPendingMeal(null);
      setStreaming(true);
      setCurrent("");
      setGrounded(null);

      let messageToSend = text;
      if (userTurn.meal) {
        const m = userTurn.meal;
        const items = m.food_items.join(locale === "zh" ? "、" : ", ");
        const note =
          locale === "zh"
            ? `（附：我刚记录了一餐，识别为${items || "未识别"}，图像估算约 ${m.calories} kcal、蛋白质 ${m.protein_g}g、碳水 ${m.carbs_g}g、脂肪 ${m.fat_g}g。请把它作为一般营养信息看待，不要给减重或热量目标建议。）`
            : locale === "ko"
              ? `(참고: 방금 기록한 식사는 ${items || "알 수 없음"}(으)로, 이미지 기준 약 ${m.calories} kcal, 단백질 ${m.protein_g}g, 탄수 ${m.carbs_g}g, 지방 ${m.fat_g}g입니다. 일반 영양 정보로만 다루고 체중 감량이나 칼로리 목표 조언은 하지 마세요.)`
              : `(Attached: I just logged a meal identified as ${items || "unknown items"}, image-estimated at ~${m.calories} kcal, ${m.protein_g}g protein, ${m.carbs_g}g carbs, ${m.fat_g}g fat. Treat it as general nutrition info; do not give weight-loss or calorie-target advice.)`;
        messageToSend = text ? `${text}\n\n${note}` : note;
      }

      let answer = "";
      const cited: CitedSentence[] = [];
      const onEvent = (ev: ChatEvent) => {
        if (ev.event === "sources") setSources(ev.sources);
        if (ev.event === "delta") {
          answer += ev.text;
          setCurrent(answer);
        }
        if (ev.event === "sentence") {
          cited.push({
            text: ev.text,
            source_node_ids: ev.source_node_ids,
          });
        }
        if (ev.event === "done") {
          setGrounded(ev.groundedCount ?? cited.length);
          const clean = answer
            .replace(/\[source:[a-zA-Z0-9:._-]+\]/g, "")
            .replace(/^\s{0,3}#{1,6}\s*/gm, "")
            .trim();
          setHistory((h) => [
            ...h,
            {
              role: "assistant",
              content: clean,
              citations: cited.length ? cited : undefined,
            },
          ]);
          setCurrent("");
        }
        if (ev.event === "error") {
          answer += `\n[${ev.message}]`;
          setCurrent(answer);
        }
      };
      try {
        await streamChat(
          session,
          messageToSend,
          nextHist
            .filter((t) => t.role === "user" || t.role === "assistant")
            .map((t) => ({ role: t.role, content: t.content })),
          onEvent,
        );
      } catch (e) {
        setCurrent(
          (c) => c + `\n[${e instanceof Error ? e.message : "stream error"}]`,
        );
      } finally {
        setStreaming(false);
      }
    },
    [history, input, pendingMeal, pendingImage, session, streaming, locale],
  );

  useImperativeHandle(ref, () => ({ ask: (p: string) => void send(p) }), [send]);

  const mealCopy = useMemo(() => mealLabels(locale), [locale]);
  const empty = history.length === 0 && !current;

  // Glance strip — data-driven from the signed-in student.
  const passGate = student.score.pass_threshold || 60;
  const gapToPass = passGate - student.score.total;
  const chancePct = student.progress.available
    ? Math.round(student.progress.pass_probability * 100)
    : null;
  const cheapest = useMemo(() => {
    const r = student.route.options[0];
    if (!r || r.changes.length === 0) return null;
    // "Cheapest" = the single change awarding the most points within the safety cap.
    const best = [...r.changes].sort(
      (a, b) => b.to_points - b.from_points - (a.to_points - a.from_points),
    )[0];
    return { delta: best.to_points - best.from_points, itemId: best.indicator_id };
  }, [student.route.options]);

  const glanceNote = (id: string): string => {
    if (locale === "zh") {
      if (id === "total")
        return gapToPass > 0
          ? `距及格线还差 ${gapToPass.toFixed(1)} 分`
          : `已高于及格线 ${(-gapToPass).toFixed(1)} 分`;
      if (id === "chance")
        return student.progress.available
          ? "风险标记，非成绩预测"
          : "暂无早期数据，模型不可用";
      return cheapest
        ? `${itemLabel(tr, cheapest.itemId)}，推进一个评分档`
        : "当前成绩已达到目标";
    }
    if (locale === "ko") {
      if (id === "total")
        return gapToPass > 0
          ? `통과선까지 ${gapToPass.toFixed(1)}점 부족`
          : `통과선보다 ${(-gapToPass).toFixed(1)}점 높음`;
      if (id === "chance")
        return student.progress.available
          ? "위험 표시, 성적 예측 아님"
          : "이전 연도 데이터 없음";
      return cheapest
        ? `${itemLabel(tr, cheapest.itemId)}, 한 등급 상승`
        : "이미 목표에 도달";
    }
    if (id === "total")
      return gapToPass > 0
        ? `${gapToPass.toFixed(1)} points below the pass line`
        : `${(-gapToPass).toFixed(1)} points above the pass line`;
    if (id === "chance")
      return student.progress.available
        ? "risk flag, not a forecast"
        : "no earlier-year data available";
    return cheapest
      ? `${itemLabel(tr, cheapest.itemId)}, one band`
      : "already meets the target";
  };

  return (
    <div className="mx-auto flex w-full max-w-[820px] flex-col px-4 pb-40 pt-10 sm:px-6">
      {/* Empty hero */}
      {empty ? (
        <div style={{ animation: "rise .6s ease-out both" }}>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-primary">
            COACH
          </p>
          <h1 className="mt-3 max-w-[20ch] font-display text-[38px] font-bold leading-[1.04] tracking-[-0.02em] sm:text-[52px]">
            {locale === "zh"
              ? "问你的身体，而不是你的分数。"
              : locale === "ko"
                ? "점수가 아니라 몸에 대해 물어보세요."
                : "Ask about your body, not your grade."}
          </h1>
          <p className="mt-4 max-w-[56ch] text-[16px] leading-relaxed text-muted-foreground">
            {tr.coachSubtitle}
          </p>

          {/* Glance strip */}
          <div className="mt-8 grid grid-cols-3 gap-3 sm:gap-[14px]">
            <GlanceCard
              label={locale === "zh" ? "本年总分" : locale === "ko" ? "올해 총점" : "Year 4 total"}
              value={student.score.total.toFixed(1)}
              note={glanceNote("total")}
              tone={gapToPass > 0 ? "warn" : "lime"}
            />
            <GlanceCard
              label={locale === "zh" ? "通过概率" : locale === "ko" ? "통과 확률" : "Chance of passing"}
              value={chancePct != null ? `${chancePct}%` : "—"}
              note={glanceNote("chance")}
              tone={chancePct != null && chancePct < 50 ? "warn" : "lime"}
            />
            <GlanceCard
              label={locale === "zh" ? "最易提分" : locale === "ko" ? "가장 쉬운 향상" : "Cheapest points"}
              value={cheapest ? `+${cheapest.delta}` : "—"}
              note={glanceNote("cheapest")}
              tone="lime"
            />
          </div>

          {/* Prompt chips */}
          <div className="mt-7 flex max-w-[760px] flex-wrap gap-2.5">
            {PROMPTS[locale].map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => void send(p)}
                className="chip rounded-full border border-border-strong bg-surface-2 px-4 py-[11px] text-[14px] text-[#D6DBD1] transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-primary hover:bg-primary hover:text-primary-foreground"
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div
          ref={scrollRef}
          className="flex max-h-[560px] flex-col gap-5 overflow-y-auto pr-1"
          translate="no"
          aria-live="polite"
        >
          {history.map((m, i) => (
            <div key={i} className="space-y-2.5">
              {m.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={m.image}
                  alt=""
                  className="ml-auto max-h-44 rounded-2xl border border-border object-cover"
                />
              )}
              {m.role === "user" && m.meal && (
                <MealResultCard meal={m.meal} copy={mealCopy} />
              )}
              <ChatBubble
                role={m.role}
                content={m.content}
                citations={m.citations}
                sources={sources}
                onCite={onCite}
              />
            </div>
          ))}
          {current && (
            <ChatBubble
              role="assistant"
              content={current}
              typing
              sources={sources}
              onCite={onCite}
            />
          )}
          {streaming && !current && (
            <p className="text-sm text-muted-foreground">{tr.thinking}</p>
          )}
        </div>
      )}

      {/* Provenance drawer */}
      {sources.length > 0 && (
        <div
          ref={sourceListRef}
          className="mt-5 rounded-2xl border border-border bg-surface-2/60 p-3"
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {tr.sources} ({sources.length})
            {grounded !== null && (
              <span className="ml-2 text-primary">· {grounded} cited</span>
            )}
          </p>
          <div className="mt-2 max-h-36 space-y-1 overflow-y-auto">
            {sources.slice(0, 16).map((s) => (
              <div
                key={s.id}
                data-source-id={s.id}
                className="flex items-start gap-2 rounded-md px-1.5 py-1 text-[11px] leading-snug transition-colors"
              >
                <LayerChip layer={s.layer} tr={tr} />
                <span className="text-muted-foreground">
                  <span className="font-mono text-foreground/70">{s.id}</span> —{" "}
                  {locale === "zh"
                    ? s.summary_zh
                    : locale === "ko"
                      ? (s.summary_ko ?? s.summary_en)
                      : s.summary_en}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pending meal preview */}
      {pendingImage && (
        <div className="mt-4 rounded-2xl border border-border bg-accent/40 p-2.5">
          <div className="flex items-start gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={pendingImage}
              alt=""
              className="h-16 w-16 rounded-xl object-cover"
            />
            <div className="min-w-0 flex-1">
              {analyzingMeal ? (
                <p className="text-xs text-muted-foreground">{mealCopy.analyzing}</p>
              ) : pendingMeal ? (
                <div className="text-xs">
                  <p className="font-medium">
                    {pendingMeal.food_items.join(locale === "zh" ? "、" : ", ") ||
                      mealCopy.unknown}
                  </p>
                  <p className="mt-0.5 font-mono text-muted-foreground">
                    {pendingMeal.calories} kcal · P {pendingMeal.protein_g}g · C{" "}
                    {pendingMeal.carbs_g}g · F {pendingMeal.fat_g}g
                  </p>
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setPendingImage(null);
                  setPendingMeal(null);
                }}
                className="mt-1 text-[11px] text-muted-foreground underline-offset-2 hover:underline"
              >
                {mealCopy.remove}
              </button>
            </div>
          </div>
        </div>
      )}

      {(voiceError || mealError) && (
        <p className="mt-2 text-[11px] text-warn">{voiceError ?? mealError}</p>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handlePhoto(f);
          e.target.value = "";
        }}
      />

      {/* Composer */}
      <div
        className="mt-6 flex items-center gap-2 rounded-[18px] border border-border-strong bg-[rgba(16,18,16,.9)] px-3 py-3 backdrop-blur-md"
        style={{ boxShadow: "0 18px 50px -28px rgba(0,0,0,.9)" }}
      >
        <button
          type="button"
          onClick={onPickPhoto}
          disabled={analyzingMeal || streaming}
          title={mealCopy.logMeal}
          aria-label={mealCopy.logMeal}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:text-primary"
        >
          <Camera className="h-[18px] w-[18px]" />
        </button>
        <button
          type="button"
          onClick={toggleRecording}
          disabled={streaming}
          aria-pressed={recording}
          title={recording ? tr.voiceStop : tr.voiceInput}
          className={cn(
            "flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl transition-colors",
            recording
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-primary",
          )}
        >
          <Mic className="h-[18px] w-[18px]" />
        </button>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder={tr.askPlaceholder}
          className="h-10 w-full bg-transparent px-1 text-[16px] text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={streaming || (!input.trim() && !pendingMeal)}
          className="shrink-0 pr-1 font-condensed text-[15px] font-bold uppercase tracking-[0.1em] text-primary transition-opacity disabled:opacity-40"
        >
          {tr.send}
        </button>
      </div>
    </div>
  );
});

function GlanceCard({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone: "lime" | "warn";
}) {
  return (
    <div
      className="rounded-[14px] border border-border px-4 py-[16px] sm:px-[18px]"
      style={{ background: "var(--panel-grad)", animation: "rise .6s .1s ease-out both" }}
    >
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <p
        className="mt-2 font-display text-[28px] font-bold leading-none sm:text-[30px]"
        style={{ color: tone === "warn" ? "var(--warn-soft)" : "var(--primary)" }}
      >
        {value}
      </p>
      <p className="mt-2 text-[13px] leading-snug text-muted-foreground">{note}</p>
    </div>
  );
}

function ChatBubble({
  role,
  content,
  typing,
  citations,
  sources,
  onCite,
}: {
  role: "user" | "assistant";
  content: string;
  typing?: boolean;
  citations?: CitedSentence[];
  sources?: { id: string }[];
  onCite?: (id: string) => void;
}) {
  const isUser = role === "user";
  if (isUser) {
    return (
      <div className="flex justify-end">
        <div
          className="max-w-[88%] whitespace-pre-wrap rounded-[18px] rounded-br-[4px] bg-primary px-[18px] py-3 text-[15px] font-medium leading-relaxed text-primary-foreground"
        >
          {content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] border border-border-strong bg-[#1A1D18] text-[13px] text-primary">
        ◆
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[16px] leading-[1.65] text-[#E6EAE1]">
          {typing ? (
            <span>
              <MarkdownText text={content} />
              <span className="caret-blink ml-0.5 inline-block w-[2px] bg-primary align-middle" style={{ height: "1.05em" }} />
            </span>
          ) : citations && citations.length > 0 ? (
            <CitedAnswer
              sentences={citations}
              sources={sources ?? []}
              onCite={onCite}
            />
          ) : (
            <MarkdownText text={content} />
          )}
        </div>
        {!typing && citations && citations.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {citations.flatMap((c) => c.source_node_ids).filter(onlyUnique).map((id) => (
              <ProvenanceChip key={id} id={id} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function onlyUnique(value: string, index: number, arr: string[]): boolean {
  return arr.indexOf(value) === index;
}

function ProvenanceChip({ id }: { id: string }) {
  const glyph = id.startsWith("route")
    ? "~"
    : id.startsWith("training")
      ? "◐"
      : "✓";
  return (
    <span className="rounded-md border border-border-strong bg-surface-0 px-2 py-[3px] font-mono text-[10px] tracking-wide text-muted-foreground">
      {glyph} {id}
    </span>
  );
}

function LayerChip({ layer, tr }: { layer: string; tr: Dict }) {
  const label =
    layer === "verified"
      ? tr.verified
      : layer === "measured"
        ? tr.measured
        : tr.reported;
  const glyph = layer === "verified" ? "✓" : layer === "measured" ? "~" : "◐";
  return (
    <span className="shrink-0 rounded-md border border-border-strong bg-surface-0 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
      {glyph} {label}
    </span>
  );
}

function itemLabel(tr: Dict, id: string): string {
  switch (id) {
    case "bmi":
      return "BMI";
    case "vital_capacity":
      return tr.itemVital;
    case "sprint_50m":
      return tr.itemSprint;
    case "standing_long_jump":
      return tr.itemJump;
    case "sit_and_reach":
      return tr.itemReach;
    case "endurance_run":
      return tr.itemEndurance;
    case "strength":
      return tr.itemStrength;
    default:
      return id;
  }
}

function MealResultCard({
  meal,
  copy,
}: {
  meal: MealAnalysis;
  copy: ReturnType<typeof mealLabels>;
}) {
  return (
    <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm border border-border bg-muted/40 p-3 text-sm">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {copy.loggedMeal}
      </p>
      {meal.food_items.length > 0 && (
        <p className="mt-1 font-medium">{meal.food_items.join("、")}</p>
      )}
      <div className="mt-2 grid grid-cols-4 gap-2 text-center">
        <Macro label="kcal" value={meal.calories} />
        <Macro label="P" value={`${meal.protein_g}g`} />
        <Macro label="C" value={`${meal.carbs_g}g`} />
        <Macro label="F" value={`${meal.fat_g}g`} />
      </div>
      <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
        {meal.disclaimer}
      </p>
    </div>
  );
}

function Macro({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md bg-background/70 py-1.5">
      <p className="font-mono text-sm font-semibold tabular-nums">{value}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}

function mealLabels(locale: Locale) {
  if (locale === "ko") {
    return {
      logMeal: "식사 사진 기록",
      loggedMeal: "기록된 식사",
      analyzing: "사진을 분석하는 중…",
      unknown: "식품을 인식하지 못함",
      remove: "제거",
    };
  }
  if (locale === "en") {
    return {
      logMeal: "Log a meal photo",
      loggedMeal: "Logged meal",
      analyzing: "Analyzing the photo…",
      unknown: "No food identified",
      remove: "Remove",
    };
  }
  return {
    logMeal: "记录一餐照片",
    loggedMeal: "已记录一餐",
    analyzing: "正在识别照片中的食物…",
    unknown: "未识别到食物",
    remove: "移除",
  };
}
