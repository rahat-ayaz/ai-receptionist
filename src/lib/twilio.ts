import twilio from "twilio";
import { resolveVoice } from "./voices";

const accountSid = process.env.TWILIO_ACCOUNT_SID ?? "";
const authToken = process.env.TWILIO_AUTH_TOKEN ?? "";

export const twilioClient = twilio(accountSid, authToken);

const VoiceResponse = twilio.twiml.VoiceResponse;

// Nodes that can speak: the response root or a <Gather> block.
type SayNode =
  | InstanceType<typeof VoiceResponse>
  | ReturnType<InstanceType<typeof VoiceResponse>["gather"]>;

/**
 * Speak `text`. When Gemini is configured, plays a Gemini-synthesized voice via
 * <Play> of our /api/tts endpoint; otherwise falls back to Twilio's Polly <Say>.
 */
function speak(node: SayNode, text: string, voiceId?: string | null, _voiceSpeed?: number | null) {
  if (process.env.GEMINI_API_KEY) {
    const base = process.env.APP_BASE_URL || process.env.BETTER_AUTH_URL || "";
    const url = `${base}/api/tts?voice=${encodeURIComponent(resolveVoice(voiceId))}&text=${encodeURIComponent(text)}`;
    node.play({}, url);
  } else {
    // Last resort when no Gemini key is configured (e.g. bare dev setups).
    node.say({ voice: "Polly.Joanna-Neural" }, text);
  }
}

/** Verify an inbound webhook genuinely originates from Twilio. */
export function validateTwilioSignature(
  signature: string,
  url: string,
  params: Record<string, string>,
): boolean {
  if (process.env.BYPASS_TWILIO_SIGNATURE === "true") return true;
  // In local dev without a public signing URL / Twilio creds, allow through.
  if (process.env.NODE_ENV !== "production" && !signature) return true;
  if (!authToken) return false;
  return twilio.validateRequest(authToken, signature, url, params);
}

interface GreetingOptions {
  greeting: string;
  /** Public base URL where Twilio should send the next turn (speech) callback. */
  actionUrl: string;
  /** Whether to dual-channel record the call. */
  record: boolean;
  voiceId?: string | null;
  voiceSpeed?: number | null;
}

/**
 * Build the opening TwiML: optional recording, speak the greeting, then gather
 * the caller's speech and post the result back to the telephony endpoint.
 */
export function buildGreetingTwiML(opts: GreetingOptions): string {
  const vr = new VoiceResponse();

  const gather = vr.gather({
    input: ["speech"],
    action: opts.actionUrl,
    method: "POST",
    speechTimeout: "2",
    speechModel: "phone_call",
  });
  speak(gather, opts.greeting, opts.voiceId, opts.voiceSpeed);

  // If no speech was detected, reprompt once.
  vr.redirect({ method: "POST" }, opts.actionUrl);

  return vr.toString();
}

interface ReplyOptions {
  text: string;
  actionUrl: string;
  hangup?: boolean;
  voiceId?: string | null;
  voiceSpeed?: number | null;
}

/** Speak the agent's reply, then either gather the next turn or hang up. */
export function buildReplyTwiML(opts: ReplyOptions): string {
  const vr = new VoiceResponse();

  if (opts.hangup) {
    speak(vr, opts.text, opts.voiceId, opts.voiceSpeed);
    vr.hangup();
    return vr.toString();
  }

  const gather = vr.gather({
    input: ["speech"],
    action: opts.actionUrl,
    method: "POST",
    speechTimeout: "2",
    speechModel: "phone_call",
  });
  speak(gather, opts.text, opts.voiceId, opts.voiceSpeed);
  vr.redirect({ method: "POST" }, opts.actionUrl);

  return vr.toString();
}

/**
 * Hand the whole call to the Gemini Live voice bridge over a Media Stream.
 * Twilio opens a bidirectional audio WebSocket to `wssUrl`, passing the given
 * parameters so the bridge knows which tenant/call it is.
 */
export function buildStreamTwiML(
  wssUrl: string,
  params: Record<string, string>,
  greeting?: { text: string; voiceId?: string | null; voiceSpeed?: number | null },
): string {
  const vr = new VoiceResponse();
  // Speaking the greeting from TwiML masks the seconds the bridge needs to
  // fetch context and open the Gemini session (pass greeted="1" in params so
  // the bridge tells the model not to greet a second time). Twilio/Vercel
  // cache the TTS audio by URL, so only the first play pays generation.
  if (greeting) speak(vr, greeting.text, greeting.voiceId, greeting.voiceSpeed);
  const stream = vr.connect().stream({ url: wssUrl });
  for (const [name, value] of Object.entries(params)) stream.parameter({ name, value });
  return vr.toString();
}

/** Forward the call to a human fallback number. */
export function buildForwardTwiML(
  forwardTo: string,
  message?: string,
  voiceId?: string | null,
  voiceSpeed?: number | null,
): string {
  const vr = new VoiceResponse();
  if (message) speak(vr, message, voiceId, voiceSpeed);
  vr.dial({}, forwardTo);
  return vr.toString();
}

export function buildRejectTwiML(message: string, voiceId?: string | null, voiceSpeed?: number | null): string {
  const vr = new VoiceResponse();
  speak(vr, message, voiceId, voiceSpeed);
  vr.hangup();
  return vr.toString();
}

/** Dispatch an out-of-band SMS (used by trigger rules). */
export async function sendSms(to: string, body: string, fromOverride?: string): Promise<string | null> {
  const from = fromOverride || process.env.TWILIO_SMS_FROM;
  if (!from) {
    console.warn("[twilio] No source phone number available (TWILIO_SMS_FROM or provisioned number missing) — skipping SMS dispatch.");
    return null;
  }
  const msg = await twilioClient.messages.create({ to, from, body });
  return msg.sid;
}

/**
 * Send an SMS verification code. Uses Twilio when credentials are configured,
 * otherwise logs the code to the server console so phone verification is
 * testable during local development.
 */
export async function sendSmsCode(to: string, body: string): Promise<void> {
  const from = process.env.TWILIO_SMS_FROM;
  if (!from || !accountSid || !authToken) {
    console.log(`\n📱 [sms:console] To: ${to}\n   ${body}\n`);
    return;
  }
  try {
    await twilioClient.messages.create({ to, from, body });
  } catch (err) {
    console.error("[twilio] SMS code send failed, falling back to console:", err);
    console.log(`\n📱 [sms:console] To: ${to}\n   ${body}\n`);
  }
}

/**
 * Live provisioning: search for an available local number in a region and
 * reserve it, pointing its voice webhook at the telephony endpoint.
 */
export async function provisionLocalNumber(
  areaCode: string,
  country = "US",
): Promise<{ phoneNumber: string; sid: string }> {
  const available = await twilioClient
    .availablePhoneNumbers(country)
    .local.list({ areaCode: Number(areaCode), voiceEnabled: true, smsEnabled: true, limit: 1 });

  if (available.length === 0) {
    throw new Error(`No available numbers for area code ${areaCode}`);
  }

  const voiceUrl = `${process.env.APP_BASE_URL}/api/telephony`;
  const purchased = await twilioClient.incomingPhoneNumbers.create({
    phoneNumber: available[0].phoneNumber,
    voiceUrl,
    voiceMethod: "POST",
  });

  return { phoneNumber: purchased.phoneNumber, sid: purchased.sid };
}
