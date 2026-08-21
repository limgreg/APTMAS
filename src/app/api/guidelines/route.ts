import { GUIDELINES } from "@/lib/aptams/guidelines";

// GET /api/guidelines — the small RAG corpus (national standard + WHO) used
// by the agent. Exposed so the UI can show "what the agent may cite".
export async function GET() {
  return Response.json({
    guidelines: GUIDELINES.map((g) => ({
      id: g.id,
      source: g.source,
      title_zh: g.title_zh,
      title_en: g.title_en,
      text_zh: g.text_zh,
      text_en: g.text_en,
    })),
  });
}
