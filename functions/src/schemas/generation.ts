/**
 * `/generations/{generationId}` document schema.
 * See docs/vision.md.
 */
import { z } from "genkit";
import { StatusLogEntrySchema, TimestampSchema } from "./common.js";

export const GenerationKindSchema = z.enum([
  "course",
  "lesson",
  "plan",
  "plan_widget",
  "game_batch",
  "entry_batch",
  "yiayia_edit",
  "legacy_import",
  "manual_admin",
]);
export type GenerationKind = z.infer<typeof GenerationKindSchema>;

export const GenerationStatusSchema = z.enum([
  "pending",
  "streaming",
  "done",
  "error",
  "reverted",
]);
export type GenerationStatus = z.infer<typeof GenerationStatusSchema>;

export const ManifestEntrySchema = z.object({
  path: z.string(),
  action: z.enum(["create", "update", "arrayUnion"]),
  field: z.string().optional(),
  before: z.unknown().optional(),
  addedValue: z.unknown().optional(),
});
export type ManifestEntry = z.infer<typeof ManifestEntrySchema>;

export const GenerationSchema = z.object({
  id: z.string(),
  kind: GenerationKindSchema,
  parentDoc: z.string().optional(),
  parentGenerationId: z.string().optional(),

  sourcePrompt: z.string().optional(),
  trigger: z.object({
    kind: z.enum(["user_action", "cascade", "yiayia_admin", "migration"]),
    description: z.string(),
  }),

  status: GenerationStatusSchema,
  statusLog: z.array(StatusLogEntrySchema).default([]),
  error: z.string().optional(),

  modelUsed: z.string().optional(),
  modelsUsed: z.array(z.string()).optional(),
  tokensIn: z.number().int().nonnegative().optional(),
  tokensOut: z.number().int().nonnegative().optional(),
  latencyMs: z.number().int().nonnegative().optional(),

  manifest: z.array(ManifestEntrySchema).default([]),

  createdAt: TimestampSchema,
  completedAt: TimestampSchema.optional(),
  revertedAt: TimestampSchema.optional(),
  revertedBy: z.string().optional(),
});
export type Generation = z.infer<typeof GenerationSchema>;
