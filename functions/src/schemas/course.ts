/**
 * `/courses/{courseId}` document schema.
 * See docs/rewrite/01-schema-and-migration.md.
 */
import { z } from "genkit";
import {
  CountsSchema,
  LanguagePairSchema,
  SkillLevelSchema,
  StatusLogEntrySchema,
  StatusSchema,
  TimestampSchema,
} from "./common.js";

export const LessonSummarySchema = z.object({
  title: z.string(),
  subtitle: z.string().optional(),
  order: z.number().int().nonnegative(),
  status: StatusSchema,
  entryCount: z.number().int().nonnegative().default(0),
  planCount: z.number().int().nonnegative().default(0),
  gameCount: z.number().int().nonnegative().default(0),
});
export type LessonSummary = z.infer<typeof LessonSummarySchema>;

export const CourseSchema = z.object({
  id: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
  description: z.string().optional(),
  sourcePrompt: z.string().optional(),
  language: LanguagePairSchema.default({ source: "en", target: "el" }),
  skillLevel: SkillLevelSchema.optional(),

  status: StatusSchema,
  statusLog: z.array(StatusLogEntrySchema).default([]),
  error: z.string().optional(),

  generationId: z.string().optional(),

  lessonSummaries: z.record(z.string(), LessonSummarySchema).default({}),
  counts: CountsSchema.default({}),

  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type Course = z.infer<typeof CourseSchema>;
