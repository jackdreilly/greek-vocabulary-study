/**
 * `/courses/{courseId}/lessons/{lessonId}/plans/{planId}` document schema.
 *
 * A plan is a "textbook module" — a sequence of typed widgets. Each widget
 * type is a discriminated union member. When you add a new widget type:
 *   1. Add a new member to `WidgetSchema` below.
 *   2. Add a render branch in web/src/routes/.../PlanReader.svelte.
 *   3. Update docs/vision.md if it needs new patterns.
 */
import { z } from "genkit";
import { StatusLogEntrySchema, StatusSchema, TimestampSchema } from "./common.js";

export const CalloutKindSchema = z.enum([
  "pattern",
  "history",
  "etymology",
  "tip",
  "cultural",
  "mnemonic",
]);

const HeadingWidget = z.object({
  id: z.string().optional(),
  type: z.literal("heading"),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  text: z.string(),
});

const ProseWidget = z.object({
  id: z.string().optional(),
  type: z.literal("prose"),
  markdown: z.string(),
});

const CalloutWidget = z.object({
  id: z.string().optional(),
  type: z.literal("callout"),
  calloutKind: CalloutKindSchema,
  title: z.string().optional(),
  markdown: z.string(),
});

const VocabTableWidget = z.object({
  id: z.string().optional(),
  type: z.literal("vocab_table"),
  rows: z.array(
    z.object({
      el: z.string(),
      en: z.string(),
      example: z.string().optional(),
    })
  ),
});

const ConjugationTableWidget = z.object({
  id: z.string().optional(),
  type: z.literal("conjugation_table"),
  headers: z.array(z.string()),
  rows: z.array(
    z.object({
      form: z.string(),
      cells: z.array(z.string()),
    })
  ),
  interactivePractice: z.boolean().optional(),
});

const ComparisonTableWidget = z.object({
  id: z.string().optional(),
  type: z.literal("comparison_table"),
  headers: z.array(z.string()),
  rows: z.array(z.array(z.string())),
});

const ReadingPassageWidget = z.object({
  id: z.string().optional(),
  type: z.literal("reading_passage"),
  el: z.string(),
  en: z.string(),
  glossary: z.array(z.object({ el: z.string(), en: z.string() })).optional(),
});

const DialogueWidget = z.object({
  id: z.string().optional(),
  type: z.literal("dialogue"),
  lines: z.array(
    z.object({
      speaker: z.string(),
      el: z.string(),
      en: z.string(),
    })
  ),
});

const MiniQuizWidget = z.object({
  id: z.string().optional(),
  type: z.literal("mini_quiz"),
  items: z.array(
    z.object({
      q: z.string(),
      options: z.array(z.string()).min(2),
      correctIndex: z.number().int().nonnegative(),
      explanation: z.string().optional(),
    })
  ),
});

const FillInBlanksWidget = z.object({
  id: z.string().optional(),
  type: z.literal("fill_in_blanks"),
  items: z.array(
    z.object({
      sentence: z.string(),
      answer: z.string(),
      hint: z.string().optional(),
    })
  ),
});

const WordTreeWidget = z.object({
  id: z.string().optional(),
  type: z.literal("word_tree"),
  root: z.object({ el: z.string(), en: z.string() }),
  branches: z.array(
    z.object({
      el: z.string(),
      en: z.string(),
      relation: z.string(),
    })
  ),
});

const MarkdownWidget = z.object({
  id: z.string().optional(),
  type: z.literal("markdown"),
  title: z.string().optional(),
  markdown: z.string(),
});

export const WidgetSchema = z.discriminatedUnion("type", [
  HeadingWidget,
  ProseWidget,
  CalloutWidget,
  VocabTableWidget,
  ConjugationTableWidget,
  ComparisonTableWidget,
  ReadingPassageWidget,
  DialogueWidget,
  MiniQuizWidget,
  FillInBlanksWidget,
  WordTreeWidget,
  MarkdownWidget,
]);
export type Widget = z.infer<typeof WidgetSchema>;
export type WidgetType = Widget["type"];

export const PlanSchema = z.object({
  id: z.string(),
  lessonId: z.string(),
  courseId: z.string(),
  planNumber: z.number().int().positive(),
  title: z.string(),
  subtitle: z.string().optional(),
  estimatedMinutes: z.number().int().positive().optional(),
  coveredWords: z.array(z.string()).default([]),
  coveredConcepts: z.array(z.string()).default([]),

  status: StatusSchema,
  statusLog: z.array(StatusLogEntrySchema).default([]),
  widgets: z.array(WidgetSchema).default([]),
  error: z.string().optional(),

  generationId: z.string().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type Plan = z.infer<typeof PlanSchema>;
