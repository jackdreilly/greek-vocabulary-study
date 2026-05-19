/**
 * `/ai_config/main` singleton document schema.
 * See docs/rewrite/03-ai-config.md for the full design.
 */
import { z } from "genkit";
import { TimestampSchema } from "./common.js";

export const ModelChoiceSchema = z.object({
  provider: z.enum(["googleai"]),
  model: z.string(),
  genkitId: z.string().optional(),
});
export type ModelChoice = z.infer<typeof ModelChoiceSchema>;

export const DecodingSchema = z.object({
  temperature: z.number().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  topK: z.number().int().positive().optional(),
  topP: z.number().optional(),
});
export type Decoding = z.infer<typeof DecodingSchema>;

/**
 * Surfaces — keys under `models`. Adding a new AI feature means adding a
 * new surface here and a corresponding default in functions/src/ai/defaults.ts.
 */
export const SurfaceSchema = z.enum([
  "courseGen",
  "lessonGen",
  "planGen",
  "gameScoring",
  "yiayiaChat",
  "yiayiaAdmin",
  "embeddings",
]);
export type Surface = z.infer<typeof SurfaceSchema>;

export const AIConfigSchema = z.object({
  models: z.record(SurfaceSchema, ModelChoiceSchema),
  decoding: z.record(z.string(), DecodingSchema).default({}),
  features: z.record(z.string(), z.boolean()).default({}),
  updatedAt: TimestampSchema.optional(),
  updatedBy: z.string().optional(),
});
export type AIConfig = z.infer<typeof AIConfigSchema>;
