import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { z } from "genkit";

const FocusKindSchema = z.enum(["vocab", "flashcard", "game", "plan"]);

const optionalString = z
  .union([z.string(), z.null(), z.undefined()])
  .optional()
  .transform((value) => (typeof value === "string" ? value.trim() : ""));

const optionalNumber = z
  .union([z.number(), z.null(), z.undefined()])
  .optional()
  .transform((value) => (typeof value === "number" && Number.isFinite(value) ? value : undefined));

const FocusObjectSchema = z.object({
  kind: z
    .union([FocusKindSchema, z.null(), z.undefined()])
    .optional()
    .transform((value) => (typeof value === "string" ? value : "")),
  label: optionalString,
  courseId: optionalString,
  lessonId: optionalString,
  tab: optionalString,
  words: z.array(optionalString).optional().default([]),
  entryId: optionalString,
  gameId: optionalString,
  planId: optionalString,
  type: optionalString,
  title: optionalString,
  prompt: optionalString,
  summary: optionalString,
  expectedAnswer: optionalString,
  index: optionalNumber,
  total: optionalNumber,
});

export const FocusContextSchema = z
  .union([FocusObjectSchema, z.null(), z.undefined()])
  .transform((value) => {
    if (!value || !value.kind) return null;
    return {
      ...value,
      kind: value.kind as z.infer<typeof FocusKindSchema>,
      label: trim(value.label, 180),
      words: value.words.map((word) => trim(word, 120)).filter(Boolean).slice(0, 25),
      title: trim(value.title, 220),
      prompt: trim(value.prompt, 1200),
      summary: trim(value.summary, 1600),
      expectedAnswer: trim(value.expectedAnswer, 800),
    };
  });

export type FocusContext = NonNullable<z.infer<typeof FocusContextSchema>>;

function trim(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function strings(value: unknown, max = 12): string[] {
  return Array.isArray(value)
    ? value.map((item) => trim(item, 160)).filter(Boolean).slice(0, max)
    : [];
}

function positionLabel(focus: FocusContext): string {
  if (!focus.index) return "";
  return focus.total ? `${focus.index} of ${focus.total}` : String(focus.index);
}

function widgetSummary(widget: Record<string, unknown>): string {
  const type = trim(widget.type, 80);
  const text =
    trim(widget.text, 220) ||
    trim(widget.title, 220) ||
    trim(widget.markdown, 220) ||
    trim(widget.el, 220) ||
    trim(widget.q, 220);
  return `${type}: ${text}`.trim().slice(0, 260);
}

export async function buildFocusContext(focus: FocusContext | null): Promise<string> {
  if (!focus) return "";

  const parts: string[] = [];
  const label = focus.label || focus.title || focus.kind;
  parts.push(`CURRENTLY FOCUSED UI ITEM: ${focus.kind}${label ? ` — ${label}` : ""}`);
  if (focus.courseId) parts.push(`Focused courseId: ${focus.courseId}`);
  if (focus.lessonId) parts.push(`Focused lessonId: ${focus.lessonId}`);
  if (focus.tab) parts.push(`Focused tab: ${focus.tab}`);
  if (focus.entryId) parts.push(`Focused entryId: ${focus.entryId}`);
  if (focus.gameId) parts.push(`Focused gameId: ${focus.gameId}`);
  if (focus.planId) parts.push(`Focused planId: ${focus.planId}`);
  if (focus.type) parts.push(`Focused item type: ${focus.type}`);
  const position = positionLabel(focus);
  if (position) parts.push(`Focused item position: ${position}`);
  if (focus.words.length) parts.push(`Focused words: ${focus.words.join(", ")}`);
  if (focus.prompt) parts.push(`Focused prompt: ${focus.prompt}`);
  if (focus.summary) parts.push(`Focused summary: ${focus.summary}`);
  if (focus.expectedAnswer) {
    parts.push(
      `Focused expected answer: ${focus.expectedAnswer}\nUse this for guidance, but do not reveal it immediately unless the learner asks or needs feedback.`,
    );
  }

  if (!focus.courseId || !focus.lessonId) {
    return parts.join("\n");
  }

  const db = getFirestore();
  try {
    if ((focus.kind === "vocab" || focus.kind === "flashcard") && focus.entryId) {
      const snap = await db
        .doc(`courses/${focus.courseId}/lessons/${focus.lessonId}/entries/${focus.entryId}`)
        .get();
      const entry = snap.data();
      if (entry) {
        const senses = strings(entry.senses, 8);
        const examples = Array.isArray(entry.examples)
          ? entry.examples
              .map((example) => {
                const ex = example as Record<string, unknown>;
                return [trim(ex.el, 180), trim(ex.en, 180)].filter(Boolean).join(" = ");
              })
              .filter(Boolean)
              .slice(0, 3)
          : [];
        parts.push(
          [
            "Focused vocabulary document:",
            `lemma: ${[trim(entry.article, 40), trim(entry.lemma, 160)].filter(Boolean).join(" ")}`,
            `english: ${trim(entry.english, 500)}`,
            senses.length ? `senses: ${senses.join("; ")}` : "",
            trim(entry.category, 120) ? `category: ${trim(entry.category, 120)}` : "",
            examples.length ? `examples: ${examples.join(" | ")}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        );
      }
    }

    if (focus.kind === "game" && focus.gameId) {
      const snap = await db
        .doc(`courses/${focus.courseId}/lessons/${focus.lessonId}/games/${focus.gameId}`)
        .get();
      const game = snap.data();
      if (game) {
        const requiredWords = strings(game.requiredWords, 12);
        const acceptableAnswers = strings(game.acceptableAnswers, 8);
        parts.push(
          [
            "Focused game document:",
            `type: ${trim(game.type, 120)}`,
            trim(game.title, 180) ? `title: ${trim(game.title, 180)}` : "",
            `prompt: ${trim(game.prompt, 1200)}`,
            trim(game.passage, 1200) ? `passage: ${trim(game.passage, 1200)}` : "",
            trim(game.question, 500) ? `question: ${trim(game.question, 500)}` : "",
            trim(game.expectedAnswer, 800)
              ? `expected answer: ${trim(game.expectedAnswer, 800)}`
              : "",
            acceptableAnswers.length ? `acceptable answers: ${acceptableAnswers.join("; ")}` : "",
            requiredWords.length ? `required words: ${requiredWords.join(", ")}` : "",
            trim(game.rubric, 800) ? `rubric: ${trim(game.rubric, 800)}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        );
      }
    }

    if (focus.kind === "plan" && focus.planId) {
      const snap = await db
        .doc(`courses/${focus.courseId}/lessons/${focus.lessonId}/plans/${focus.planId}`)
        .get();
      const plan = snap.data();
      if (plan) {
        const widgets = Array.isArray(plan.widgets)
          ? plan.widgets
              .slice(0, 10)
              .map((widget) => widgetSummary(widget as Record<string, unknown>))
              .filter(Boolean)
          : [];
        parts.push(
          [
            "Focused plan document:",
            `title: ${trim(plan.title, 220)}`,
            trim(plan.subtitle, 500) ? `subtitle: ${trim(plan.subtitle, 500)}` : "",
            typeof plan.planNumber === "number" ? `plan number: ${plan.planNumber}` : "",
            trim(plan.status, 80) ? `status: ${trim(plan.status, 80)}` : "",
            strings(plan.coveredWords, 20).length
              ? `covered words: ${strings(plan.coveredWords, 20).join(", ")}`
              : "",
            strings(plan.coveredConcepts, 20).length
              ? `covered concepts: ${strings(plan.coveredConcepts, 20).join(", ")}`
              : "",
            widgets.length ? `widgets:\n${widgets.map((line) => `- ${line}`).join("\n")}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        );
      }
    }
  } catch (err) {
    logger.warn("Failed to read focused context", {
      kind: focus.kind,
      courseId: focus.courseId,
      lessonId: focus.lessonId,
      entryId: focus.entryId,
      gameId: focus.gameId,
      planId: focus.planId,
      err,
    });
  }

  parts.push(
    `When the user says "this", "this card", "this game", "this plan", or "the clicked vocab card", resolve it to the focused UI item above unless the chat history clearly says otherwise.`,
  );

  return parts.join("\n");
}
