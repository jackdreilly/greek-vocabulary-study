/**
 * `/courses/{courseId}/lessons/{lessonId}` document schema.
 */
import { z } from "genkit";
import { CountsSchema, SkillLevelSchema, StatusLogEntrySchema, StatusSchema, TimestampSchema } from "./common.js";
import { WidgetSchema } from "./plan.js";

export const LessonOverviewSchema = z.object({
  widgets: z.array(WidgetSchema),
  generationId: z.string().optional(),
});
export type LessonOverview = z.infer<typeof LessonOverviewSchema>;

export const LessonSchema = z.object({
  id: z.string(),
  courseId: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
  description: z.string().optional(),
  sourcePrompt: z.string().optional(),
  skillLevel: SkillLevelSchema.optional(),
  order: z.number().int().nonnegative(),

  status: StatusSchema,
  statusLog: z.array(StatusLogEntrySchema).default([]),
  error: z.string().optional(),

  overview: LessonOverviewSchema.optional(),

  generationId: z.string().optional(),
  counts: CountsSchema.default({}),

  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type Lesson = z.infer<typeof LessonSchema>;
