// Meal-photo vision endpoint.
//
// This is a NEUTRAL awareness/logging feature: it identifies foods in a photo
// and returns an image-based estimate of energy/macros. It is deliberately NOT
// wired to BMI, does not set calorie targets, does not recommend a deficit, and
// never tells the user to eat less. The fixed disclaimer returned here is the
// only framing the UI should use, and the agent's safety classifier still
// refuses weight-loss/calorie-restriction prompts (AGENTS.md core rule #6).
//
// The estimate comes from a vision LLM and is approximate; it must never be
// presented as a measurement or used to score a fitness item.

import { NextRequest, NextResponse } from "next/server";
import { Config, HeaderUtils, LLMClient } from "coze-coding-dev-sdk";
import { getSession } from "@/lib/aptams/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VISION_MODEL = process.env.APTAMS_VISION_MODEL ?? "doubao-seed-2-0-lite-260215";

type MealLocale = "zh" | "en" | "ko";

interface MealAnalysis {
  food_items: string[];
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  confidence: "high" | "medium" | "low";
  disclaimer: string;
}

function isMealLocale(v: unknown): v is MealLocale {
  return v === "zh" || v === "en" || v === "ko";
}

function disclaimerFor(locale: MealLocale): string {
  if (locale === "ko") {
    return "이 분석은 이미지 기반의 추정치이며 정확한 측정이 아닙니다. 칼로리 목표나 섭취 제안이 아닌 참고용입니다.";
  }
  if (locale === "en") {
    return "This is an image-based estimate, not a measurement. It is for awareness only and is not a calorie target or eating recommendation.";
  }
  return "以上为基于图像的估算，并非精确测量，仅供记录与参考，不构成热量目标或饮食建议。";
}

function emptyResult(locale: MealLocale, reason?: string): MealAnalysis {
  return {
    food_items: [],
    calories: 0,
    protein_g: 0,
    carbs_g: 0,
    fat_g: 0,
    confidence: "low",
    disclaimer: reason ? `${reason} ${disclaimerFor(locale)}` : disclaimerFor(locale),
  };
}

function buildPrompt(locale: MealLocale): string {
  // The prompt explicitly forbids any advice/target/deficit language so the
  // model only returns a neutral description + estimate.
  const common = `Return ONLY a JSON object, no markdown fences, with this exact shape:
{"food_items":string[],"calories":number,"protein_g":number,"carbs_g":number,"fat_g":number,"confidence":"high"|"medium"|"low"}
Rules:
- Identify all visible foods/drinks; estimate total nutritional content from typical portions.
- Round whole numbers. If the image contains no food, return empty arrays and zeros.
- confidence "high" only if food is clearly identifiable, else "medium"/"low".
- Do NOT give diet advice, calorie targets, weight-loss language, or recommendations. Output numbers only.`;
  if (locale === "ko") {
    return `이 사진 속 음식을 인식해 총 칼로리, 단백질, 탄수화물, 지방을 추정하세요. ${common}`;
  }
  if (locale === "en") {
    return `Identify the food(s) in this photo and estimate total calories, protein, carbohydrates, and fat. ${common}`;
  }
  return `请识别这张照片中的食物，估算总热量、蛋白质、碳水化合物和脂肪。${common}`;
}

function coerceConfidence(v: unknown): MealAnalysis["confidence"] {
  return v === "high" || v === "medium" ? v : "low";
}

export async function POST(request: NextRequest) {
  const session = getSession(request);
  if (!session) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }

  let imageDataUri = "";
  let locale: MealLocale = "zh";
  try {
    const body = (await request.json()) as {
      image?: string;
      imageBase64?: string;
      imageDataUri?: string;
      locale?: unknown;
    };
    locale = isMealLocale(body.locale) ? body.locale : "zh";
    const raw = body.image ?? body.imageDataUri ?? body.imageBase64 ?? "";
    if (!raw || typeof raw !== "string") {
      return NextResponse.json(
        { error: "missing image data" },
        { status: 400 },
      );
    }
    // Accept either a full data URI or a bare base64 string.
    imageDataUri = raw.startsWith("data:") ? raw : `data:image/jpeg;base64,${raw}`;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  // Guard against obviously oversized payloads (base64 ~ a few MB).
  if (imageDataUri.length > 12 * 1024 * 1024) {
    return NextResponse.json(
      { error: "image too large; please use a smaller photo" },
      { status: 413 },
    );
  }

  try {
    const client = new LLMClient(
      new Config(),
      HeaderUtils.extractForwardHeaders(request.headers),
    );
    const response = await client.invoke(
      [
        {
          role: "user",
          content: [
            { type: "text", text: buildPrompt(locale) },
            { type: "image_url", image_url: { url: imageDataUri, detail: "high" } },
          ],
        },
      ],
      { model: VISION_MODEL, temperature: 0.2, thinking: "disabled" },
    );

    const content = response.content ?? "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json(emptyResult(locale), { headers: { vary: "locale" } });
    }
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    const foodItems = Array.isArray(parsed.food_items)
      ? parsed.food_items.filter((x): x is string => typeof x === "string")
      : [];
    const result: MealAnalysis = {
      food_items: foodItems,
      calories: Number(parsed.calories) || 0,
      protein_g: Number(parsed.protein_g) || 0,
      carbs_g: Number(parsed.carbs_g) || 0,
      fat_g: Number(parsed.fat_g) || 0,
      confidence: coerceConfidence(parsed.confidence),
      disclaimer: disclaimerFor(locale),
    };
    return NextResponse.json(result, { headers: { vary: "locale" } });
  } catch (error) {
    console.error("[Coach meal API] Error:", error);
    return NextResponse.json(
      emptyResult(
        locale,
        locale === "zh"
          ? "图像识别失败，请换一张更清晰的照片。"
          : locale === "ko"
            ? "이미지 인식에 실패했습니다. 더 선명한 사진을 사용해 주세요."
            : "Image analysis failed; try a clearer photo.",
      ),
      { status: 502 },
    );
  }
}
