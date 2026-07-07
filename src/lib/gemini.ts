import { GoogleGenAI, Type } from "@google/genai";

// ─── Google Gen AI SDK client ───────────────────────────────────────────────

export const gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? "" });

export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
export const GEMINI_TTS_MODEL = process.env.GEMINI_TTS_MODEL || "gemini-3.1-flash-tts-preview";

// ─── Text-to-speech (Gemini native voices) ──────────────────────────────────

/** Wrap raw 16-bit PCM in a WAV header so browsers/Twilio can play it. */
function pcmToWav(pcm: Buffer, sampleRate = 24000, channels = 1, bits = 16): Buffer {
  const blockAlign = (channels * bits) / 8;
  const byteRate = sampleRate * blockAlign;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bits, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** Synthesize `text` with a Gemini voice; returns a playable WAV buffer. */
export async function geminiTts(text: string, voiceName: string): Promise<Buffer> {
  const res = await gemini.models.generateContent({
    model: GEMINI_TTS_MODEL,
    contents: text,
    config: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
    },
  });
  const data = res.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!data) throw new Error("No audio returned from Gemini TTS");
  return pcmToWav(Buffer.from(data, "base64"));
}

// ─── Conversation typing ────────────────────────────────────────────────────

export type TranscriptRole = "caller" | "agent";

export interface TranscriptTurn {
  role: TranscriptRole;
  text: string;
  at: string; // ISO8601
}

export interface BusinessContext {
  businessName: string;
  receptionistName: string;
  tone: string;
  industry?: string | null;
  rawContext?: string | null;
  ruleMatrix?: unknown;
  knowledge: string[]; // active KnowledgeBlob.data entries
}

/**
 * Wrap the tenant's business context into a single system instruction that
 * governs every live conversation turn.
 */
export function buildSystemPrompt(ctx: BusinessContext): string {
  const knowledge = ctx.knowledge.length
    ? ctx.knowledge.map((k, i) => `[KB-${i + 1}] ${k}`).join("\n\n")
    : "No additional knowledge base entries provided.";

  const ruleMatrix = ctx.ruleMatrix
    ? JSON.stringify(ctx.ruleMatrix, null, 2)
    : "None.";

  return [
    `You are ${ctx.receptionistName}, the AI receptionist answering live phone calls for "${ctx.businessName}".`,
    ctx.industry ? `Industry: ${ctx.industry}.` : "",
    `Speak in a ${ctx.tone.toLowerCase()} tone. Keep replies short, natural, and conversational — this is spoken aloud over a phone line, so avoid lists, markdown, or long monologues.`,
    ``,
    `── CRITICAL GUARDRAILS & INSTRUCTIONS ──`,
    `- ONLY answer questions using the facts and details explicitly provided in the BUSINESS CONTEXT, ENTERPRISE RULE MATRIX, and KNOWLEDGE BASE below.`,
    `- Never invent, assume, or extrapolate details (such as hours, pricing, policies, or services) not documented in the provided contexts. Doing so is a severe hallucination.`,
    `- If the caller asks for information that is not available, or if you do not know the answer, or if you are unable to fulfill their request, you MUST immediately say: "I'm sorry, I don't have that information. Let me transfer you to a representative who can help you further." or a similar variation containing the word "transfer" or "connect". Do not try to answer or guess.`,
    ``,
    `── BUSINESS CONTEXT ──`,
    ctx.rawContext?.trim() || "No free-form description provided.",
    ``,
    `── ENTERPRISE RULE MATRIX ──`,
    ruleMatrix,
    ``,
    `── KNOWLEDGE BASE ──`,
    knowledge,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Map our transcript turns into Gemini `contents`. */
function toContents(turns: TranscriptTurn[]) {
  return turns.map((t) => ({
    role: t.role === "caller" ? ("user" as const) : ("model" as const),
    parts: [{ text: t.text }],
  }));
}

/**
 * Produce the agent's next spoken reply given the conversation so far.
 */
export async function generateReply(
  systemInstruction: string,
  history: TranscriptTurn[],
  callerText: string,
): Promise<string> {
  const contents = [
    ...toContents(history),
    { 
      role: "user" as const, 
      parts: [{ text: `${callerText} (Remember: Keep your response to a maximum of 1 or 2 short sentences. Absolutely no lists or long paragraphs.)` }] 
    },
  ];

  const res = await gemini.models.generateContent({
    model: GEMINI_MODEL,
    contents,
    config: {
      systemInstruction,
      temperature: 0.6,
      maxOutputTokens: 80,
    },
  });

  return (res.text ?? "I'm sorry, could you repeat that?").trim();
}

// ─── Post-call semantic summary ─────────────────────────────────────────────

export type CallCategory =
  | "SALES"
  | "GENERAL_INFO"
  | "ISSUE"
  | "URGENT"
  | "SPAM"
  | "UNCLASSIFIED";

export type CallSentiment = "POSITIVE" | "NEUTRAL" | "NEGATIVE" | "MIXED";

export interface CallAnalysis {
  summary: string;
  category: CallCategory;
  sentiment: CallSentiment;
  isSpam: boolean;
  tags: string[];
  intent: Record<string, unknown>;
}

const ANALYSIS_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    summary: { type: Type.STRING, description: "2-3 sentence summary of the call." },
    category: {
      type: Type.STRING,
      enum: ["SALES", "GENERAL_INFO", "ISSUE", "URGENT", "SPAM", "UNCLASSIFIED"],
    },
    sentiment: {
      type: Type.STRING,
      description: "Overall caller sentiment across the call.",
      enum: ["POSITIVE", "NEUTRAL", "NEGATIVE", "MIXED"],
    },
    isSpam: { type: Type.BOOLEAN },
    tags: { type: Type.ARRAY, items: { type: Type.STRING } },
    intent: {
      type: Type.OBJECT,
      description: "Extracted structured intent parameters and booking actions.",
      properties: {
        callerGoal: { type: Type.STRING },
        requestedAction: { type: Type.STRING },
        action: {
          type: Type.STRING,
          enum: ["CREATE_BOOKING", "MODIFY_BOOKING", "NONE"],
          description: "Whether the caller wanted to create a new booking/order, modify an existing one, or did neither."
        },
        bookingReference: {
          type: Type.STRING,
          description: "The order or booking reference number if they wanted to edit or reschedule (e.g., ORD-0005, APT-0012)."
        },
        bookingType: {
          type: Type.STRING,
          enum: ["ORDER", "APPOINTMENT"]
        },
        scheduledAt: {
          type: Type.STRING,
          description: "The date and time the customer requested for the order pickup/delivery or appointment, in ISO 8601 format."
        },
        items: {
          type: Type.ARRAY,
          description: "List of menu items or services ordered or modified.",
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING, description: "Name of the item or service." },
              qty: { type: Type.INTEGER, description: "Quantity." }
            },
            required: ["name", "qty"]
          }
        },
        notes: {
          type: Type.STRING,
          description: "Any special instructions or notes."
        }
      },
      required: ["action"]
    },
  },
  required: ["summary", "category", "sentiment", "isSpam", "tags"],
};

/**
 * Generate a JSON semantic summary, category, and spam classification for a
 * finished call.
 */
export async function analyzeCall(
  businessName: string,
  transcript: TranscriptTurn[],
): Promise<CallAnalysis> {
  if (transcript.length === 0) {
    return { summary: "No conversation took place.", category: "UNCLASSIFIED", sentiment: "NEUTRAL", isSpam: false, tags: [], intent: {} };
  }

  const dialogue = transcript
    .map((t) => `${t.role === "caller" ? "Caller" : "Agent"}: ${t.text}`)
    .join("\n");

  const res = await gemini.models.generateContent({
    model: GEMINI_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          {
            text:
              `Analyze this phone call to "${businessName}" and return structured JSON. ` +
              `Classify the category, judge the caller's overall sentiment, detect spam/robocalls, ` +
              `extract concise tags and intent.\n\nTRANSCRIPT:\n${dialogue}`,
          },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: ANALYSIS_SCHEMA,
      temperature: 0.2,
    },
  });

  try {
    const parsed = JSON.parse(res.text ?? "{}") as Partial<CallAnalysis>;
    return {
      summary: parsed.summary ?? "Summary unavailable.",
      category: (parsed.category as CallCategory) ?? "UNCLASSIFIED",
      sentiment: (parsed.sentiment as CallSentiment) ?? "NEUTRAL",
      isSpam: parsed.isSpam ?? false,
      tags: parsed.tags ?? [],
      intent: parsed.intent ?? {},
    };
  } catch {
    return { summary: "Summary unavailable.", category: "UNCLASSIFIED", sentiment: "NEUTRAL", isSpam: false, tags: [], intent: {} };
  }
}

/**
 * Distill an unformatted business description (and/or scraped website text)
 * into a structured "enterprise rule matrix" during onboarding.
 */
export async function distillRuleMatrix(rawText: string): Promise<Record<string, unknown>> {
  const res = await gemini.models.generateContent({
    model: GEMINI_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          {
            text:
              `From the following business description, extract a structured rule matrix an AI ` +
              `receptionist can follow. Include services, hours, pricing, policies, FAQs, and escalation rules.\n\n${rawText.slice(0, 30000)}`,
          },
        ],
      },
    ],
    config: { responseMimeType: "application/json", temperature: 0.2 },
  });

  try {
    return JSON.parse(res.text ?? "{}") as Record<string, unknown>;
  } catch {
    return { raw: rawText.slice(0, 4000) };
  }
}
