// Lightweight, safe inline renderer for assistant messages. The model is
// forbidden from emitting headings/tables and only uses **bold** and blank
// lines; we strip any stray markdown markers and turn trailing citation ids
// into clickable chips that scroll/highlight the matching source row.
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface CitedSentence {
  text: string;
  source_node_ids: string[];
}

/** Remove markdown heading/table markers the model should not have emitted. */
function stripMarkdown(s: string): string {
  return s
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/`+/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1");
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  // Split on **bold** while preserving the surrounding segments.
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) {
      return (
        <strong key={`${keyPrefix}-b-${i}`} className="font-semibold">
          {p.slice(2, -2)}
        </strong>
      );
    }
    return <span key={`${keyPrefix}-t-${i}`}>{p}</span>;
  });
}

export function MarkdownText({ text }: { text: string }) {
  const clean = stripMarkdown(text);
  const paragraphs = clean.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return (
    <>
      {paragraphs.map((para, pi) => (
        <p key={pi} className={cn(pi > 0 && "mt-2")}>
          {renderInline(para, `p-${pi}`)}
        </p>
      ))}
    </>
  );
}

export function CitationChips({
  ids,
  sources,
  onCite,
}: {
  ids: string[];
  sources: { id: string }[];
  onCite?: (id: string) => void;
}) {
  if (!ids.length) return null;
  const known = new Set(sources.map((s) => s.id));
  const chips = ids.filter((id) => known.has(id));
  if (!chips.length) return null;
  return (
    <span className="ml-1 inline-flex flex-wrap gap-1 align-middle">
      {chips.map((id) => (
        <button
          type="button"
          key={id}
          onClick={() => onCite?.(id)}
          className="rounded bg-background/70 px-1 py-0.5 font-mono text-[9px] leading-none text-primary underline-offset-2 ring-1 ring-border transition-colors hover:bg-accent hover:underline"
        >
          {id}
        </button>
      ))}
    </span>
  );
}

/** Render already-parsed, grounded sentences with their citation chips. */
export function CitedAnswer({
  sentences,
  sources,
  onCite,
}: {
  sentences: CitedSentence[];
  sources: { id: string }[];
  onCite?: (id: string) => void;
}) {
  return (
    <>
      {sentences.map((s, i) => (
        <p key={i} className={cn(i > 0 && "mt-2")}>
          {renderInline(s.text, `s-${i}`)}
          <CitationChips
            ids={s.source_node_ids}
            sources={sources}
            onCite={onCite}
          />
        </p>
      ))}
    </>
  );
}
