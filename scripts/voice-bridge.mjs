// ════════════════════════════════════════════════════════════════════════════
//  CAPRO — Voice bridge: Twilio Media Streams  ↔  Gemini Live
//  Twilio carries the call; Gemini does listening + thinking + speaking.
//  Run alongside the app + DB:  node scripts/voice-bridge.mjs
//  (Live calls also need a public wss tunnel set as PUBLIC_WSS_URL.)
// ════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import { WebSocketServer } from "ws";
import { GoogleGenAI } from "@google/genai";
import { twilioToGemini, geminiToTwilio } from "./audio.mjs";
import twilio from "twilio";

import { createServer } from "http";

const twilioClient = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;

const PORT = Number(process.env.PORT || process.env.VOICE_BRIDGE_PORT || 3211);
const SECRET = process.env.VOICE_BRIDGE_SECRET || "";
// Half-cascade Live model: noticeably lower response latency than the
// native-audio models at slight cost in vocal expressiveness. 2.5-generation
// models are closed to newly created Google projects, so default to 3.x.
const LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || "gemini-3.1-flash-live-preview";
const APP_URL = process.env.APP_INTERNAL_URL || process.env.BETTER_AUTH_URL || "http://localhost:3000";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const server = createServer((req, res) => {
  if (req.url === "/health" || req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("OK");
  } else {
    res.writeHead(404);
    res.end();
  }
});

const wss = new WebSocketServer({ server });

server.listen(PORT, () => {
  console.log(`[voice-bridge] listening on port ${PORT} (model: ${LIVE_MODEL})`);
});

// Keep the app's voice endpoints warm so the context fetch at call start
// doesn't pay a serverless cold start (adds seconds on hobby-tier Vercel).
setInterval(() => {
  fetch(`${APP_URL}/api/voice/context?ping=1`, {
    headers: { Authorization: `Bearer ${SECRET}` },
  }).catch(() => {});
}, 4 * 60 * 1000).unref();

// ─── Shared call-control helpers (used by both pipelines) ───────────────────

const CALLER_WANTS_HUMAN = /\b(speak|talk) to (a )?(human|person|someone|representative|agent)\b/i;
const AGENT_WANTS_TRANSFER = /\b(transfer|connect|forward)( you)?\b/i;
const AGENT_MENTIONS_REP = /\b(representative|human agent)\b/i;
const CALLER_GOODBYE = /\b(bye|goodbye|hang up|talk later|see ya)\b/i;
const AGENT_GOODBYE = /\b(goodbye|bye|have a (great|nice|good) day|have a good one|take care)\b/i;

/** Returns the number to forward to when either side asked for a human, else null. */
function resolveTransferTarget(callerUtterance, agentReply, ctx) {
  if (
    !CALLER_WANTS_HUMAN.test(callerUtterance) &&
    !AGENT_WANTS_TRANSFER.test(agentReply) &&
    !AGENT_MENTIONS_REP.test(agentReply)
  ) return null;
  let target = ctx.forwardingNumber || "";
  const searchString = `${callerUtterance} ${agentReply}`.toLowerCase();
  for (const [dept, num] of Object.entries(ctx.forwardingNumbers || {})) {
    if (new RegExp(`\\b${dept}\\b`, "i").test(searchString)) { target = num; break; }
  }
  return target || null;
}

function wantsHangup(callerUtterance, agentReply) {
  return CALLER_GOODBYE.test(callerUtterance) || AGENT_GOODBYE.test(agentReply);
}

/** Redirect to a human after a delay that lets the spoken reply reach the caller. */
function transferCall(callSid, targetNumber, delayMs) {
  if (!twilioClient || !callSid) {
    console.warn("[voice-bridge] Twilio client or Call SID not available for redirect.");
    return;
  }
  console.log(`[voice-bridge] transfer detected for call ${callSid}. Forwarding to ${targetNumber}`);
  setTimeout(async () => {
    try {
      await twilioClient.calls(callSid).update({
        twiml: `<Response><Say>One moment while I connect you.</Say><Dial>${targetNumber}</Dial></Response>`,
      });
    } catch (e) {
      console.error("[voice-bridge] call redirect failed:", e.message);
    }
  }, delayMs);
}

/** Hang up after a delay that lets the spoken goodbye reach the caller. */
function hangupCall(callSid, delayMs) {
  if (!twilioClient || !callSid) return;
  console.log(`[voice-bridge] Goodbye/hangup detected. Hanging up call ${callSid}`);
  setTimeout(async () => {
    try {
      await twilioClient.calls(callSid).update({ status: "completed" });
    } catch (e) {
      console.error("[voice-bridge] call hangup failed:", e.message);
    }
  }, delayMs);
}

async function postTranscript(callSid, transcript, startedAt) {
  if (!callSid) return;
  const durationSeconds = Math.round((Date.now() - startedAt) / 1000);
  try {
    await fetch(`${APP_URL}/api/voice/transcript`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SECRET}` },
      body: JSON.stringify({ callSid, transcript, durationSeconds }),
    });
  } catch (e) {
    console.error("[voice-bridge] transcript post failed:", e.message);
  }
}

async function fetchContext(profileId, callSid) {
  let ctx = { systemInstruction: "You are a helpful phone receptionist. Keep replies short.", voiceId: "Kore", greeting: "" };
  try {
    const r = await fetch(`${APP_URL}/api/voice/context?profileId=${encodeURIComponent(profileId)}&callSid=${encodeURIComponent(callSid || "")}`, {
      headers: { Authorization: `Bearer ${SECRET}` },
    });
    if (r.ok) ctx = await r.json();
    else console.error("[voice-bridge] context", r.status);
  } catch (e) {
    console.error("[voice-bridge] context fetch failed:", e.message);
  }
  return ctx;
}

// Two pipelines share this server: Twilio Media Streams (audio ↔ Gemini Live)
// on the root path, and Twilio ConversationRelay (text ↔ Gemini) on /relay.
wss.on("connection", (ws, req) => {
  if ((req.url || "").startsWith("/relay")) return handleRelay(ws);
  return handleLive(ws);
});

// ~20ms of caller audio per Twilio media frame → 500 frames ≈ 10s of buffer.
const MAX_PENDING_FRAMES = 500;

function handleLive(twilio) {
  let streamSid = null;
  let callSid = null;
  let profileId = null;
  let greeted = false; // greeting already played from TwiML before the stream opened
  let session = null;
  let startedAt = Date.now();
  let finalized = false;
  const transcript = [];
  let inBuf = "";
  let outBuf = "";
  // Caller audio that arrives while the Gemini session is still connecting —
  // buffered and flushed on open so the caller's first words aren't lost.
  let pendingAudio = [];

  async function openGemini() {
    const ctx = await fetchContext(profileId, callSid);

    session = await ai.live.connect({
      model: LIVE_MODEL,
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: ctx.voiceId } } },
        systemInstruction: ctx.systemInstruction,
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        // End-of-speech tuning: respond sooner after the caller stops talking
        // than the default ~1s VAD window, but not so eagerly that natural
        // mid-sentence pauses get treated as end of turn.
        realtimeInputConfig: {
          automaticActivityDetection: {
            silenceDurationMs: 700,
          },
        },
      },
      callbacks: {
        onopen: () => {
          // Defer to ensure the outer `session` variable is assigned first.
          setTimeout(() => {
            if (!session) return;
            if (greeted) {
              // TwiML already spoke the greeting while we were connecting —
              // prime the model with that fact without triggering a reply.
              session.sendClientContent({
                turns: `You have already greeted the caller with: "${ctx.greeting || "a welcome message"}". Do not greet them again; listen and respond to their request.`,
                turnComplete: false,
              });
            } else {
              session.sendClientContent({
                turns: "The caller has just connected. Greet them warmly and briefly, then ask how you can help.",
                turnComplete: true,
              });
            }
          }, 0);
        },
        onmessage: (m) => {
          const sc = m.serverContent;
          if (!sc) return;
          // Caller barged in → tell Twilio to drop buffered agent audio.
          if (sc.interrupted && streamSid) twilio.send(JSON.stringify({ event: "clear", streamSid }));
          for (const p of sc.modelTurn?.parts || []) {
            const data = p.inlineData?.data;
            if (data && streamSid) {
              twilio.send(JSON.stringify({ event: "media", streamSid, media: { payload: geminiToTwilio(data) } }));
            }
          }
          if (sc.inputTranscription?.text) inBuf += sc.inputTranscription.text;
          if (sc.outputTranscription?.text) outBuf += sc.outputTranscription.text;
          if (sc.turnComplete) {
            const at = new Date().toISOString();
            const callerUtterance = inBuf.trim();
            const agentReply = outBuf.trim();
            if (callerUtterance) transcript.push({ role: "caller", text: callerUtterance, at });
            if (agentReply) transcript.push({ role: "agent", text: agentReply, at });

            const targetNumber = resolveTransferTarget(callerUtterance, agentReply, ctx);
            if (targetNumber) {
              transferCall(callSid, targetNumber, 2000);
            } else if (wantsHangup(callerUtterance, agentReply)) {
              hangupCall(callSid, 3000);
            }

            inBuf = "";
            outBuf = "";
          }
        },
        onerror: (e) => {
          console.error("[voice-bridge] gemini error:", e?.message);
          if (twilioClient && callSid && !finalized) {
            twilioClient.calls(callSid).update({ status: "completed" }).catch(() => {});
          }
        },
        onclose: () => {
          console.log(`[voice-bridge] Gemini Live session closed for call ${callSid}`);
          if (twilioClient && callSid && !finalized) {
            twilioClient.calls(callSid).update({ status: "completed" }).catch(() => {});
          }
        },
      },
    });

    // The TwiML greeting never crosses the Gemini stream, so record it here —
    // the transcript we post at hangup replaces the session's transcript.
    if (greeted && ctx.greeting) {
      transcript.push({ role: "agent", text: ctx.greeting, at: new Date(startedAt).toISOString() });
    }

    // Flush caller audio that arrived while the session was connecting.
    for (const data of pendingAudio.splice(0)) {
      try {
        session.sendRealtimeInput({ audio: { data, mimeType: "audio/pcm;rate=16000" } });
      } catch { /* session closed mid-flush */ }
    }
  }

  async function finalize() {
    if (finalized) return;
    finalized = true;
    try { session?.close(); } catch {}
    await postTranscript(callSid, transcript, startedAt);
  }

  twilio.on("message", async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    switch (msg.event) {
      case "start": {
        streamSid = msg.start?.streamSid;
        const params = msg.start?.customParameters || {};
        profileId = params.businessProfileId;
        callSid = params.callSid;
        greeted = params.greeted === "1";
        startedAt = Date.now();
        console.log(`[voice-bridge] call started (profile ${profileId}, ${callSid})`);
        try {
          await openGemini();
        } catch (e) {
          console.error("[voice-bridge] gemini connect failed:", e?.message);
          if (twilioClient && callSid) {
            twilioClient.calls(callSid).update({ status: "completed" }).catch(() => {});
          }
          await finalize();
        }
        break;
      }
      case "media": {
        if (!msg.media?.payload) break;
        const data = twilioToGemini(msg.media.payload);
        if (session) {
          try {
            session.sendRealtimeInput({ audio: { data, mimeType: "audio/pcm;rate=16000" } });
          } catch { /* session closed */ }
        } else if (pendingAudio.length < MAX_PENDING_FRAMES) {
          pendingAudio.push(data);
        }
        break;
      }
      case "stop":
        await finalize();
        break;
    }
  });

  twilio.on("close", () => finalize());
  twilio.on("error", () => finalize());
}

// ════════════════════════════════════════════════════════════════════════════
//  ConversationRelay pipeline — Twilio handles STT/TTS (instantly
//  interruptible at their edge); we stream Gemini *text* tokens back.
//  Enabled per call via USE_CONVERSATION_RELAY=true on the app.
// ════════════════════════════════════════════════════════════════════════════

const TEXT_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash";
const FALLBACK_TEXT_MODEL = process.env.GEMINI_FALLBACK_MODEL || "gemini-3.1-flash-lite";

// Overloaded models don't just error (429/503) — they can hang for 15s+,
// which is an eternity of dead air on a phone call. Give the primary model a
// short window to start streaming, then cut to the fallback model.
const PRIMARY_MODEL_TIMEOUT_MS = 4000;

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`no response within ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

async function generateStreamWithRetry(request) {
  try {
    return await withTimeout(ai.models.generateContentStream(request), PRIMARY_MODEL_TIMEOUT_MS);
  } catch (e) {
    console.warn(`[voice-bridge/relay] ${request.model} unavailable (${String(e?.message || "").slice(0, 80)}) — falling back to ${FALLBACK_TEXT_MODEL}`);
    return ai.models.generateContentStream({ ...request, model: FALLBACK_TEXT_MODEL });
  }
}

function handleRelay(ws) {
  let callSid = null;
  let profileId = null;
  let ctx = { systemInstruction: "You are a helpful phone receptionist. Keep replies short.", greeting: "" };
  let startedAt = Date.now();
  let finalized = false;
  const transcript = [];
  const history = []; // Gemini `contents` mirror of the transcript
  let genSeq = 0; // bumped on interrupt so in-flight streaming stops

  async function finalize() {
    if (finalized) return;
    finalized = true;
    await postTranscript(callSid, transcript, startedAt);
  }

  ws.on("message", async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    switch (msg.type) {
      case "setup": {
        callSid = msg.callSid;
        profileId = msg.customParameters?.businessProfileId;
        startedAt = Date.now();
        console.log(`[voice-bridge/relay] call started (profile ${profileId}, ${callSid})`);
        ctx = await fetchContext(profileId, callSid);
        // Twilio speaks the welcomeGreeting itself; mirror it in the record.
        if (ctx.greeting) {
          transcript.push({ role: "agent", text: ctx.greeting, at: new Date().toISOString() });
          history.push({ role: "model", parts: [{ text: ctx.greeting }] });
        }
        break;
      }

      case "prompt": {
        if (msg.last === false) break; // wait for the complete utterance
        const utterance = (msg.voicePrompt || "").trim();
        if (!utterance) break;
        transcript.push({ role: "caller", text: utterance, at: new Date().toISOString() });

        const myGen = ++genSeq;
        let reply = "";
        try {
          const stream = await generateStreamWithRetry({
            model: TEXT_MODEL,
            contents: [...history, { role: "user", parts: [{ text: utterance }] }],
            config: {
              systemInstruction:
                `${ctx.systemInstruction}\n\nYour reply is spoken aloud over the phone the moment you write it. ` +
                `Answer in one or two short sentences, never lists or headings, and ask at most one question at a time.`,
              temperature: 0.6,
              maxOutputTokens: 120,
              thinkingConfig: { thinkingBudget: 0 },
            },
          });
          for await (const chunk of stream) {
            if (genSeq !== myGen) break; // caller barged in — stop talking
            const token = chunk.text;
            if (token) {
              reply += token;
              ws.send(JSON.stringify({ type: "text", token, last: false }));
            }
          }
          if (genSeq === myGen) ws.send(JSON.stringify({ type: "text", token: "", last: true }));
        } catch (e) {
          console.error("[voice-bridge/relay] gemini error:", e?.message);
          if (genSeq === myGen) {
            ws.send(JSON.stringify({ type: "text", token: "I'm sorry, could you repeat that?", last: true }));
          }
        }
        if (!reply) break;

        history.push({ role: "user", parts: [{ text: utterance }] }, { role: "model", parts: [{ text: reply }] });
        transcript.push({ role: "agent", text: reply, at: new Date().toISOString() });

        const targetNumber = resolveTransferTarget(utterance, reply, ctx);
        if (targetNumber) {
          transferCall(callSid, targetNumber, 2000);
        } else if (wantsHangup(utterance, reply)) {
          hangupCall(callSid, 3000);
        }
        break;
      }

      case "interrupt": {
        genSeq++; // abort any in-flight token streaming
        // Keep the transcript faithful to what the caller actually heard.
        if (msg.utteranceUntilInterrupt) {
          const lastAgent = [...transcript].reverse().find((t) => t.role === "agent");
          if (lastAgent) lastAgent.text = `${msg.utteranceUntilInterrupt} …[interrupted]`;
        }
        break;
      }

      case "error":
        console.error("[voice-bridge/relay] twilio error:", msg.description);
        break;
    }
  });

  ws.on("close", () => finalize());
  ws.on("error", () => finalize());
}
