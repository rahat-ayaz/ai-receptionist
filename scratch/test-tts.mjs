import "dotenv/config";
import { GoogleGenAI } from "@google/genai";

const gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function run() {
  console.log("Testing with gemini-3.1-flash-tts-preview...");
  try {
    const res = await gemini.models.generateContent({
      model: "gemini-3.1-flash-tts-preview",
      contents: "Hello, thank you for calling.",
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } },
      },
    });
    const data = res.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    console.log("Success! Audio length:", data ? data.length : 0);
  } catch (err) {
    console.error("Error:", err.message);
  }
}

run();
