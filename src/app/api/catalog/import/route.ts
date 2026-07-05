import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentProfileId } from "@/lib/tenant";
import { parseDocument, extractEntries } from "@/lib/ingest";
import { URL_RE, fetchUrlText } from "@/lib/scrape";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BYTES = 25 * 1024 * 1024; // 25MB

/**
 * POST /api/catalog/import
 * Accepts a multipart `file`, or JSON `{ url }` / `{ text }`. Parses the source
 * into text, extracts structured entries (niche-aware), and returns them for
 * review — nothing is saved here.
 */
export async function POST(req: NextRequest) {
  const businessProfileId = await currentProfileId();
  if (!businessProfileId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const profile = await prisma.businessProfile.findUnique({
    where: { id: businessProfileId },
    select: { niche: true },
  });

  let text = "";
  const contentType = req.headers.get("content-type") ?? "";

  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "No file provided" }, { status: 400 });
      }
      if (file.size > MAX_BYTES) {
        return NextResponse.json({ error: "File exceeds the 25MB limit." }, { status: 413 });
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      text = await parseDocument(buffer, file.name);
    } else {
      const body = (await req.json()) as { url?: string; text?: string };
      if (body.url) {
        if (!URL_RE.test(body.url.trim())) {
          return NextResponse.json({ error: "Enter a valid http(s) URL." }, { status: 400 });
        }
        try {
          text = await fetchUrlText(body.url.trim());
        } catch {
          return NextResponse.json({ error: "Could not fetch that URL." }, { status: 422 });
        }
      } else if (body.text) {
        if (body.text.length > MAX_BYTES) {
          return NextResponse.json({ error: "Text exceeds the 25MB limit." }, { status: 413 });
        }
        text = body.text;
      } else {
        return NextResponse.json({ error: "Provide a file, url, or text." }, { status: 400 });
      }
    }
  } catch (err) {
    console.error("[catalog/import] parse failed:", err);
    return NextResponse.json({ error: "Could not read that document." }, { status: 422 });
  }

  const result = await extractEntries(text, profile?.niche ?? null);

  if (result.items.length === 0) {
    return NextResponse.json({
      items: [],
      suggestedNiche: result.suggestedNiche,
      usedAi: result.usedAi,
      message:
        "No entries could be extracted automatically. Add a GEMINI_API_KEY for AI extraction, or add items manually.",
    });
  }

  return NextResponse.json({
    items: result.items,
    suggestedNiche: result.suggestedNiche,
    usedAi: result.usedAi,
    count: result.items.length,
  });
}
