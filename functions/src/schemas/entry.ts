/**
 * `/courses/{courseId}/lessons/{lessonId}/entries/{entryId}` document schema.
 * Vocabulary entries — immutable in normal flow (edits are delete + create).
 */
import { z } from "zod";
import { TimestampSchema } from "./common.js";

export const EntryExampleSchema = z.object({
  el: z.string(),
  en: z.string(),
});
export type EntryExample = z.infer<typeof EntryExampleSchema>;

export const EntrySchema = z.object({
  id: z.string(),
  lessonId: z.string(),
  courseId: z.string(),
  lemma: z.string(),
  article: z.string().optional(),
  english: z.string(),
  senses: z.array(z.string()).default([]),
  examples: z.array(EntryExampleSchema).optional(),
  category: z.string().optional(),
  groupKey: z.string().optional(),
  order: z.number().int().nonnegative().default(0),
  generationId: z.string().optional(),
  createdAt: TimestampSchema,
});
export type Entry = z.infer<typeof EntrySchema>;

/**
 * Slim variant for in-prompt RAG / context windows.
 * Used when a Cloud Function passes entries into a Genkit call.
 */
export const EntrySummarySchema = EntrySchema.pick({
  id: true,
  lemma: true,
  english: true,
  category: true,
}).extend({
  topSense: z.string().optional(),
});
export type EntrySummary = z.infer<typeof EntrySummarySchema>;
