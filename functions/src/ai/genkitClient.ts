import { genkit } from "genkit";
import { googleAI } from "@genkit-ai/google-genai";
import { defineSecret } from "firebase-functions/params";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const geminiApiKey = defineSecret("GEMINI_API_KEY");

let _ai: ReturnType<typeof genkit> | null = null;

function readEnvFileValue(filePath: string, keys: string[]): string | undefined {
  if (!existsSync(filePath)) return undefined;
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || !keys.includes(match[1])) continue;
    const raw = match[2].replace(/^['"]|['"]$/g, "");
    if (raw) return raw;
  }
  return undefined;
}

function resolveLocalApiKey(): string | undefined {
  const envKey =
    process.env.GEMINI_API_KEY ??
    process.env.GOOGLE_GENAI_API_KEY ??
    process.env.GOOGLE_API_KEY ??
    process.env.AI_STUDIO_API_KEY;
  if (envKey) return envKey;

  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "..", ".env"),
    resolve(here, "..", "..", ".env"),
    resolve(here, "..", "..", "..", ".env"),
  ];
  const keys = ["GEMINI_API_KEY", "GOOGLE_GENAI_API_KEY", "GOOGLE_API_KEY", "AI_STUDIO_API_KEY"];
  for (const candidate of candidates) {
    const value = readEnvFileValue(candidate, keys);
    if (value) return value;
  }
  return undefined;
}

function resolveApiKey(): string | undefined {
  const localKey = resolveLocalApiKey();
  if (localKey) return localKey;
  try {
    return geminiApiKey.value();
  } catch {
    return undefined;
  }
}

/**
 * Lazy singleton Genkit client. Initialized on first call so that we
 * don't read secrets during cold-start of functions that never call AI.
 */
export function getAI() {
  if (_ai) return _ai;
  _ai = genkit({
    plugins: [googleAI({ apiKey: resolveApiKey(), legacyResponseSchema: true })],
  });
  return _ai;
}
