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
// native-audio models at slight cost in vocal expressiveness.
const LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || "gemini-live-2.5-flash-preview";
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

// ~20ms of caller audio per Twilio media frame → 500 frames ≈ 10s of buffer.
const MAX_PENDING_FRAMES = 500;

wss.on("connection", (twilio) => {
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
    let ctx = { systemInstruction: "You are a helpful phone receptionist. Keep replies short.", voiceId: "Kore" };
    try {
      const r = await fetch(`${APP_URL}/api/voice/context?profileId=${encodeURIComponent(profileId)}&callSid=${encodeURIComponent(callSid || "")}`, {
        headers: { Authorization: `Bearer ${SECRET}` },
      });
      if (r.ok) ctx = await r.json();
      else console.error("[voice-bridge] context", r.status);
    } catch (e) {
      console.error("[voice-bridge] context fetch failed:", e.message);
    }

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

            // Check if transfer is requested by caller or initiated by agent due to lack of info.
            const callerWantsHuman = /\b(speak|talk) to (a )?(human|person|someone|representative|agent)\b/i.test(callerUtterance);
            const agentWantsTransfer = /\b(transfer|connect|forward)( you)?\b/i.test(agentReply) || /\b(representative|human agent)\b/i.test(agentReply);

            if (callerWantsHuman || agentWantsTransfer) {
              let targetNumber = ctx.forwardingNumber || "";
              const depts = ctx.forwardingNumbers || {};
              const searchString = (callerUtterance + " " + agentReply).toLowerCase();
              for (const [dept, num] of Object.entries(depts)) {
                if (new RegExp(`\\b${dept}\\b`, "i").test(searchString)) {
                  targetNumber = num;
                  break;
                }
              }

              if (targetNumber) {
                console.log(`[voice-bridge] transfer detected for call ${callSid}. Forwarding to ${targetNumber}`);
                if (twilioClient && callSid) {
                  // Give a short delay to let the spoken agent reply reach the caller before dialing.
                  setTimeout(async () => {
                    try {
                      await twilioClient.calls(callSid).update({
                        twiml: `<Response><Say>One moment while I connect you.</Say><Dial>${targetNumber}</Dial></Response>`
                      });
                    } catch (e) {
                      console.error("[voice-bridge] call redirect failed:", e.message);
                    }
                  }, 2000);
                } else {
                  console.warn("[voice-bridge] Twilio client or Call SID not available for redirect.");
                }
              }
            } else {
              // Check if caller or agent wants to end the call (saying goodbye / bye)
              const callerWantsHangup = /\b(bye|goodbye|hang up|talk later|see ya)\b/i.test(callerUtterance);
              const agentWantsHangup = /\b(goodbye|bye|have a (great|nice|good) day|have a good one|take care)\b/i.test(agentReply);

              if (callerWantsHangup || agentWantsHangup) {
                console.log(`[voice-bridge] Goodbye/hangup detected. Hanging up call ${callSid}`);
                if (twilioClient && callSid) {
                  // Give a 3-second delay to let the spoken agent reply reach the caller before hanging up.
                  setTimeout(async () => {
                    try {
                      await twilioClient.calls(callSid).update({ status: "completed" });
                    } catch (e) {
                      console.error("[voice-bridge] call hangup failed:", e.message);
                    }
                  }, 3000);
                }
              }
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
});
