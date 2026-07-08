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
const LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || "gemini-2.5-flash-native-audio-latest";
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

wss.on("connection", (twilio) => {
  let streamSid = null;
  let callSid = null;
  let profileId = null;
  let session = null;
  let startedAt = Date.now();
  let finalized = false;
  const transcript = [];
  let inBuf = "";
  let outBuf = "";

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
      },
      callbacks: {
        onopen: () => {
          // Defer greeting trigger to ensure the outer `session` variable is assigned first.
          setTimeout(() => {
            if (session) {
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
        onerror: (e) => console.error("[voice-bridge] gemini error:", e?.message),
        onclose: () => {},
      },
    });
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
        startedAt = Date.now();
        console.log(`[voice-bridge] call started (profile ${profileId}, ${callSid})`);
        await openGemini();
        break;
      }
      case "media": {
        if (session && msg.media?.payload) {
          try {
            session.sendRealtimeInput({
              audio: { data: twilioToGemini(msg.media.payload), mimeType: "audio/pcm;rate=16000" },
            });
          } catch { /* session not ready / closed */ }
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
