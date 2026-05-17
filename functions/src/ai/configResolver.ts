/**
 * AI config resolver.
 *
 * Reads `ai_config/main` from Firestore with a 60-second in-memory cache,
 * exposes helpers to resolve the model / decoding / feature flags for a
 * given AI "surface" (courseGen, lessonGen, planGen, etc).
 *
 * See docs/rewrite/03-ai-config.md for the full doc shape.
 */
import { getFirestore } from "firebase-admin/firestore";
import type { DocumentData } from "firebase-admin/firestore";
import { DEFAULT_AI_CONFIG } from "./defaults.js";

const CACHE_TTL_MS = 60_000;
let cached: { data: DocumentData; expiresAt: number } | null = null;

async function ensureSeeded(): Promise<DocumentData> {
  const db = getFirestore();
  const ref = db.doc("ai_config/main");
  const snap = await ref.get();
  if (snap.exists) return snap.data()!;
  await ref.set({
    ...DEFAULT_AI_CONFIG,
    updatedAt: new Date(),
    updatedBy: "seed-on-read",
  });
  const re = await ref.get();
  return re.data()!;
}

export async function getAIConfig(): Promise<DocumentData> {
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  const data = await ensureSeeded();
  cached = { data, expiresAt: Date.now() + CACHE_TTL_MS };
  return data;
}

export async function getModelFor(surface: string): Promise<string> {
  const cfg = await getAIConfig();
  const choice = cfg.models?.[surface];
  if (!choice) throw new Error(`No AI config for surface "${surface}"`);
  return choice.genkitId ?? `${choice.provider}/${choice.model}`;
}

export async function getDecodingFor(surface: string): Promise<Record<string, unknown>> {
  const cfg = await getAIConfig();
  return cfg.decoding?.[surface] ?? {};
}

export async function getFeatureFlag(name: string): Promise<boolean> {
  const cfg = await getAIConfig();
  return Boolean(cfg.features?.[name]);
}

export function invalidateAIConfigCache(): void {
  cached = null;
}
