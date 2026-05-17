/**
 * `/courses/{courseId}/lessons/{lessonId}/games/{gameId}` document schema.
 * One AI-generated practice exercise.
 */
import { z } from "zod";
import { TimestampSchema } from "./common.js";

export const GameTypeSchema = z.enum([
  "missing_word",
  "reading_comprehension",
  "story_prompt",
  "sentence_translation",
  "word_translation",
]);
export type GameType = z.infer<typeof GameTypeSchema>;

export const GameSchema = z.object({
  id: z.string(),
  lessonId: z.string(),
  courseId: z.string(),
  type: GameTypeSchema,
  title: z.string().optional(),
  prompt: z.string(),
  expectedAnswer: z.string().optional(),
  acceptableAnswers: z.array(z.string()).optional(),
  requiredWords: z.array(z.string()).optional(),
  vocabulary: z.array(z.object({ el: z.string(), en: z.string() })).optional(),
  sourceEntryIds: z.array(z.string()).default([]),
  direction: z.enum(["el_to_en", "en_to_el"]).optional(),
  passage: z.string().optional(),
  question: z.string().optional(),
  rubric: z.string().optional(),
  generationId: z.string().optional(),
  createdAt: TimestampSchema,
});
export type Game = z.infer<typeof GameSchema>;
