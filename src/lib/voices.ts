// ─── Agent voices (Google Gemini TTS) ───────────────────────────────────────
// The agent now speaks with Gemini's native text-to-speech voices. Pure data
// module — safe to import in both server (TTS) and client (settings UI).

export const VOICES = [
  { id: "Kore", label: "Kore", note: "Firm" },
  { id: "Puck", label: "Puck", note: "Upbeat" },
  { id: "Charon", label: "Charon", note: "Informative" },
  { id: "Zephyr", label: "Zephyr", note: "Bright" },
  { id: "Fenrir", label: "Fenrir", note: "Excitable" },
  { id: "Leda", label: "Leda", note: "Youthful" },
  { id: "Orus", label: "Orus", note: "Firm" },
  { id: "Aoede", label: "Aoede", note: "Breezy" },
  { id: "Callirrhoe", label: "Callirrhoe", note: "Easy-going" },
  { id: "Autonoe", label: "Autonoe", note: "Bright" },
  { id: "Enceladus", label: "Enceladus", note: "Breathy" },
  { id: "Iapetus", label: "Iapetus", note: "Clear" },
  { id: "Umbriel", label: "Umbriel", note: "Easy-going" },
  { id: "Algieba", label: "Algieba", note: "Smooth" },
  { id: "Despina", label: "Despina", note: "Smooth" },
  { id: "Erinome", label: "Erinome", note: "Clear" },
  { id: "Algenib", label: "Algenib", note: "Gravelly" },
  { id: "Rasalgethi", label: "Rasalgethi", note: "Informative" },
  { id: "Laomedeia", label: "Laomedeia", note: "Upbeat" },
  { id: "Achernar", label: "Achernar", note: "Soft" },
  { id: "Alnilam", label: "Alnilam", note: "Firm" },
  { id: "Schedar", label: "Schedar", note: "Even" },
  { id: "Gacrux", label: "Gacrux", note: "Mature" },
  { id: "Pulcherrima", label: "Pulcherrima", note: "Forward" },
  { id: "Achird", label: "Achird", note: "Friendly" },
  { id: "Zubenelgenubi", label: "Zubenelgenubi", note: "Casual" },
  { id: "Vindemiatrix", label: "Vindemiatrix", note: "Gentle" },
  { id: "Sadachbia", label: "Sadachbia", note: "Lively" },
  { id: "Sadaltager", label: "Sadaltager", note: "Knowledgeable" },
  { id: "Sulafat", label: "Sulafat", note: "Warm" },
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
