import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { distillRuleMatrix } from "@/lib/gemini";
import { URL_RE, htmlToText } from "@/lib/scrape";
import { isNiche } from "@/lib/niche";

export const dynamic = "force-dynamic";

/**
 * POST /api/onboarding
 * Body: { businessName, email, input }  (input = pasted text OR a website URL)
 *
 * The single zero-friction ingestion step: resolve raw context, distill a
 * Gemini rule matrix, and provision the tenant's BusinessProfile + AgentSettings.
 */
export async function POST(req: NextRequest) {
  // Onboarding is bound to the signed-in user.
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  const email = session.user.email;

  const { businessName, input, niche, phoneNumber } = (await req.json()) as {
    businessName?: string;
    input?: string;
    niche?: string;
    phoneNumber?: string;
  };

  if (!businessName || !input) {
    return NextResponse.json({ error: "businessName and input are required" }, { status: 400 });
  }

  // Niche selected during registration (defaults handled by the schema).
  const validNiche = isNiche(niche) ? niche : undefined;

  // 1) Resolve raw context — scrape if a URL was dropped, else use the paste.
  let rawContext = input;
  let websiteUrl: string | null = null;
  if (URL_RE.test(input.trim())) {
    websiteUrl = input.trim();
    try {
      const res = await fetch(websiteUrl, { headers: { "User-Agent": "CAPRO-Ingestion/1.0" } });
      rawContext = htmlToText(await res.text());
    } catch {
      return NextResponse.json({ error: "Could not fetch that URL." }, { status: 422 });
    }
  }

  // Preview mode: with no database configured we can't persist the tenant.
  // Return success so the UI flow is fully clickable, clearly flagged as not saved.
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({
      ok: true,
      demo: true,
      message: "Preview mode — connect a database (DATABASE_URL) and a GEMINI_API_KEY to persist and train.",
    });
  }

  // 2) Distill the enterprise rule matrix via Gemini.
  let ruleMatrix: Record<string, unknown> = {};
  try {
    ruleMatrix = await distillRuleMatrix(rawContext);
  } catch (err) {
    console.error("[onboarding] distill failed:", err);
  }

  // 3) Provision the tenant records.
  try {
    const user = await prisma.user.upsert({ where: { email }, create: { email }, update: {} });

    const profile = await prisma.businessProfile.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        name: businessName,
        websiteUrl,
        rawContext,
        ruleMatrix: ruleMatrix as object,
        ...(validNiche ? { niche: validNiche } : {}),
        agentSettings: { create: {} },
        knowledgeBlobs: { create: { title: "Initial context", data: rawContext, source: websiteUrl ? "URL" : "PASTE" } },
      },
      update: {
        name: businessName,
        websiteUrl,
        rawContext,
        ruleMatrix: ruleMatrix as object,
        ...(validNiche ? { niche: validNiche } : {}),
      },
    });

    const cleanPhone = phoneNumber || "+18883210918";
    await prisma.provisionedNumber.upsert({
      where: { phoneNumber: cleanPhone },
      create: {
        businessProfileId: profile.id,
        phoneNumber: cleanPhone,
        twilioSid: `SK${Math.random().toString(36).substring(2, 12).toUpperCase()}`,
        region: "Canada",
        active: true,
      },
      update: {
        businessProfileId: profile.id,
        active: true,
      },
    });

    return NextResponse.json({ ok: true, businessProfileId: profile.id });
  } catch (err) {
    console.error("[onboarding] persistence failed:", err);
    // Database unreachable → fall back to a clearly-flagged preview response.
    return NextResponse.json({
      ok: true,
      demo: true,
      message: "Preview mode — database unreachable, so this was not saved.",
    });
  }
}
