import { genkit } from "genkit";
import { googleAI } from "@genkit-ai/google-genai";
import { defineSecret } from "firebase-functions/params";

export const geminiApiKey = defineSecret("GEMINI_API_KEY");

let _ai: ReturnType<typeof genkit> | null = null;

/**
 * Lazy singleton Genkit client. Initialized on first call so that we
 * don't read secrets during cold-start of functions that never call AI.
 */
export function getAI() {
  if (_ai) return _ai;
  _ai = genkit({
    plugins: [googleAI({ apiKey: geminiApiKey.value() })],
  });
  return _ai;
}
