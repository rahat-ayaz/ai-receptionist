import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentProfileId } from "@/lib/tenant";
import { parseDocument } from "@/lib/ingest";
import { URL_RE, fetchUrlText } from "@/lib/scrape";
import type { KbSource } from "@prisma/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BYTES = 25 * 1024 * 1024; // 25MB
const MAX_CHARS = 40000; // cap per blob so the agent prompt stays sane

export async function GET() {
  const businessProfileId = await currentProfileId();
  if (!businessProfileId) return NextResponse.json({ blobs: [] });
  const blobs = await prisma.knowledgeBlob.findMany({
    where: { businessProfileId },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ blobs });
}

/**
 * POST /api/knowledge
 * Add a knowledge-base entry from a multipart `file` (PDF/Word/Excel/CSV/text),
 * a JSON `{ url }` (scraped), or `{ text, title }`. The extracted text becomes a
 * KnowledgeBlob that feeds the agent's system prompt.
 */
export async function POST(req: NextRequest) {
  const businessProfileId = await currentProfileId();
  if (!businessProfileId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let title = "";
  let data = "";
  let source: KbSource = "MANUAL";
  const contentType = req.headers.get("content-type") ?? "";

  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) return NextResponse.json({ error: "No file provided" }, { status: 400 });
      if (file.size > MAX_BYTES) return NextResponse.json({ error: "File exceeds the 25MB limit." }, { status: 413 });
      const buffer = Buffer.from(await file.arrayBuffer());
      data = await parseDocument(buffer, file.name);
      title = file.name.replace(/\.[^.]+$/, "");
      source = "DOCUMENT";
    } else {
      const body = (await req.json()) as { url?: string; text?: string; title?: string };
      if (body.url) {
        if (!URL_RE.test(body.url.trim())) return NextResponse.json({ error: "Enter a valid http(s) URL." }, { status: 400 });
        try {
          data = await fetchUrlText(body.url.trim());
        } catch {
          return NextResponse.json({ error: "Could not fetch that URL." }, { status: 422 });
        }
        title = body.title?.trim() || body.url.trim();
        source = "URL";
      } else if (body.text) {
        data = body.text;
        title = body.title?.trim() || "Pasted note";
        source = "PASTE";
      } else {
        return NextResponse.json({ error: "Provide a file, url, or text." }, { status: 400 });
      }
    }
  } catch (err) {
    console.error("[knowledge] parse failed:", err);
    return NextResponse.json({ error: "Could not read that document." }, { status: 422 });
  }

  if (!data.trim()) {
    return NextResponse.json({ error: "No readable text found in that source." }, { status: 422 });
  }

  const blob = await prisma.knowledgeBlob.create({
    data: { businessProfileId, title: title.slice(0, 160), data: data.slice(0, MAX_CHARS), source },
  });
  return NextResponse.json({ blob });
}
