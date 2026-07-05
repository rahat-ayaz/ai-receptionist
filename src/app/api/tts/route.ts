import { NextRequest, NextResponse } from "next/server";
import { geminiTts } from "@/lib/gemini";
import { resolveVoice } from "@/lib/voices";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/tts?voice=<gemini-voice>&text=<text>
 * Returns Gemini-synthesized speech as WAV. Public so it can be used both by
 * the in-app voice preview and by Twilio <Play> on live calls.
 */
export async function GET(req: NextRequest) {
  if (!process.env.GEMINI_API_KEY) {
    return new NextResponse("TTS not configured", { status: 503 });
  }

  const voice = resolveVoice(req.nextUrl.searchParams.get("voice"));
  const text = (req.nextUrl.searchParams.get("text") || "Hello, thank you for calling.").slice(0, 1200);

  try {
    const wav = await geminiTts(text, voice);
    return new NextResponse(new Uint8Array(wav), {
      headers: {
        "Content-Type": "audio/wav",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (err) {
    console.error("[tts] generation failed:", err);
    return new NextResponse("TTS error", { status: 502 });
  }
}
