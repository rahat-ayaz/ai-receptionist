// ════════════════════════════════════════════════════════════════════════════
//  Audio codecs for the voice bridge — self-contained, no deps.
//  Twilio Media Streams: 8kHz μ-law (G.711).  Gemini Live: 16kHz PCM16 in,
//  24kHz PCM16 out. These helpers convert between them.
// ════════════════════════════════════════════════════════════════════════════

const BIAS = 0x84; // 132
const CLIP = 32635;

/** 16-bit signed PCM sample → 8-bit μ-law byte (G.711). */
export function linearToMulaw(sample) {
  let sign = (sample >> 8) & 0x80;
  if (sign) sample = -sample;
  if (sample > CLIP) sample = CLIP;
  sample += BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (sample & mask) === 0 && exponent > 0; exponent--, mask >>= 1) {}
  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

/** 8-bit μ-law byte → 16-bit signed PCM sample. */
export function mulawToLinear(u) {
  u = ~u & 0xff;
  const sign = u & 0x80;
  const exponent = (u >> 4) & 0x07;
  const mantissa = u & 0x0f;
  let sample = ((mantissa << 3) + BIAS) << exponent;
  sample -= BIAS;
  return sign ? -sample : sample;
}

/** Buffer of μ-law bytes → Int16Array of PCM samples. */
export function mulawBufToPcm16(buf) {
  const out = new Int16Array(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = mulawToLinear(buf[i]);
  return out;
}

/** Int16Array of PCM samples → Buffer of μ-law bytes. */
export function pcm16ToMulawBuf(int16) {
  const out = Buffer.allocUnsafe(int16.length);
  for (let i = 0; i < int16.length; i++) out[i] = linearToMulaw(int16[i]);
  return out;
}

/** Int16Array (little-endian) → Buffer. */
export function int16ToBuffer(int16) {
  const buf = Buffer.allocUnsafe(int16.length * 2);
  for (let i = 0; i < int16.length; i++) buf.writeInt16LE(int16[i], i * 2);
  return buf;
}

/** Buffer (little-endian PCM16) → Int16Array. */
export function bufferToInt16(buf) {
  const out = new Int16Array(Math.floor(buf.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = buf.readInt16LE(i * 2);
  return out;
}

/** Linear-interpolation resample of an Int16Array between sample rates. */
export function resample(int16, srcRate, dstRate) {
  if (srcRate === dstRate) return int16;
  const ratio = dstRate / srcRate;
  const outLen = Math.max(1, Math.floor(int16.length * ratio));
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i / ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, int16.length - 1);
    const frac = pos - i0;
    out[i] = (int16[i0] * (1 - frac) + int16[i1] * frac) | 0;
  }
  return out;
}

// ─── High-level frame converters ────────────────────────────────────────────

/** Twilio μ-law 8kHz (base64) → Gemini PCM16 16kHz (base64). */
export function twilioToGemini(base64Mulaw) {
  const mulaw = Buffer.from(base64Mulaw, "base64");
  const pcm8k = mulawBufToPcm16(mulaw);
  const pcm16k = resample(pcm8k, 8000, 16000);
  return int16ToBuffer(pcm16k).toString("base64");
}

/** Gemini PCM16 24kHz (base64) → Twilio μ-law 8kHz (base64). */
export function geminiToTwilio(base64Pcm24k) {
  const pcm24k = bufferToInt16(Buffer.from(base64Pcm24k, "base64"));
  const pcm8k = resample(pcm24k, 24000, 8000);
  return pcm16ToMulawBuf(pcm8k).toString("base64");
}
