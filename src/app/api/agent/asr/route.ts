// Server-side speech-to-text endpoint, ported from the Task B agent bundle.
// The client uses the in-browser Web Speech API for live transcription; this
// route is the fallback/alternative that accepts base64 audio and returns text
// via the SDK ASRClient. It requires an authenticated session (role comes from
// the signed cookie, like every other APTAMS API route).

import { NextRequest, NextResponse } from "next/server";
import { ASRClient, Config, HeaderUtils } from "coze-coding-dev-sdk";
import { getSession } from "@/lib/aptams/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const session = getSession(request);
  if (!session) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }

  let audioBase64: string | undefined;
  try {
    const body = (await request.json()) as { audioBase64?: string };
    audioBase64 = body.audioBase64;
  } catch {
    return NextResponse.json(
      { error: "invalid JSON body" },
      { status: 400 },
    );
  }

  if (!audioBase64 || typeof audioBase64 !== "string") {
    return NextResponse.json(
      { error: "Missing audioBase64 in request body" },
      { status: 400 },
    );
  }

  try {
    const customHeaders = HeaderUtils.extractForwardHeaders(
      Object.fromEntries(request.headers) as Record<string, string>,
    );
    const client = new ASRClient(new Config(), customHeaders);

    const result = await client.recognize({
      uid: `aptams-${session.subject ?? session.role}`,
      base64Data: audioBase64,
    });

    if (!result.text || result.text.trim() === "") {
      return NextResponse.json(
        { error: "speech recognition returned empty text" },
        { status: 422 },
      );
    }

    return NextResponse.json({
      text: result.text,
      duration: result.duration,
    });
  } catch (error: unknown) {
    console.error("[ASR API] Error:", error);
    const message =
      error instanceof Error ? error.message : "speech recognition failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
