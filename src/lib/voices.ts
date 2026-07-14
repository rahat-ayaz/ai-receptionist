// ─── Agent voices ────────────────────────────────────────────────────────────
// Only voices available across EVERY pipeline the agent can speak through:
// Gemini TTS (previews/greetings), Gemini Live half-cascade, and Twilio
// ConversationRelay's Google TTS (Chirp3-HD). Newer Gemini-only voices
// (Sulafat, Achird, Gacrux, …) are rejected by Twilio mid-call — keep them out
// of the picker. Pure data module — safe in both server and client code.

export const VOICES = [
  { id: "Kore", label: "Kore", note: "Firm" },
  { id: "Puck", label: "Puck", note: "Upbeat" },
  { id: "Charon", label: "Charon", note: "Informative" },
  { id: "Zephyr", label: "Zephyr", note: "Bright" },
  { id: "Fenrir", label: "Fenrir", note: "Excitable" },
  { id: "Leda", label: "Leda", note: "Youthful" },
  { id: "Orus", label: "Orus", note: "Firm" },
  { id: "Aoede", label: "Aoede", note: "Breezy" },
] as const;

export type VoiceId = (typeof VOICES)[number]["id"];

export const DEFAULT_VOICE: VoiceId = "Kore";

const VOICE_IDS = new Set<string>(VOICES.map((v) => v.id));

/** Return a valid Gemini voice name, falling back to the default. */
export function resolveVoice(id?: string | null): string {
  return id && VOICE_IDS.has(id) ? id : DEFAULT_VOICE;
}

// Agent tone presets (mirrors the AgentTone enum) for the settings dropdown.
export const TONES = ["PROFESSIONAL", "FRIENDLY", "CONCISE", "EMPATHETIC", "ENERGETIC"] as const;
