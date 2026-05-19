import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "genkit";
import { geminiApiKey, getAI } from "../ai/genkitClient.js";
import { getDecodingFor, getModelFor } from "../ai/configResolver.js";
import { ALLOWED_ORIGINS } from "../cors.js";
import { SKILL_LEVEL_LABELS, SkillLevelSchema, type SkillLevel } from "../schemas/common.js";

const ExerciseSchema = z.object({
  id: z.string().optional(),
  type: z.string().optional().default("practice"),
  title: z.string().optional(),
  prompt: z.string().optional().default(""),
  expectedAnswer: z.string().optional(),
  acceptableAnswers: z.array(z.string()).optional().default([]),
  requiredWords: z.array(z.string()).optional().default([]),
  sourceEntryIds: z.array(z.union([z.string(), z.number()])).optional().default([]),
  direction: z.string().optional(),
  passage: z.string().optional(),
  question: z.string().optional(),
  rubric: z.string().optional(),
});

const ScoreGameAnswerInputSchema = z.object({
  courseId: z.string().optional().default(""),
  lessonId: z.string(),
  lessonTitle: z.string(),
  exercise: ExerciseSchema,
  answer: z.string().min(1).max(2000),
  preferences: z
    .object({
      responseLanguage: z.enum(["english", "greek"]).default("english"),
      cefrLevel: z.enum(["A1", "A2", "B1", "B2", "C1"]).default("A2"),
    })
    .optional()
    .default({ responseLanguage: "english", cefrLevel: "A2" }),
});

const ScoreGameAnswerFlowInputSchema = ScoreGameAnswerInputSchema.extend({
  exact: z.boolean(),
  skillLevel: SkillLevelSchema.optional(),
});

const GameAttemptResultSchema = z.object({
  accepted: z.boolean(),
  score: z.number().min(0).max(1),
  verdict: z.enum(["correct", "almost", "incorrect"]),
  feedback: z.string(),
  betterAnswer: z.string(),
  shortReason: z.string(),
  greekCorrection: z
    .object({
      correctedText: z.string(),
      tips: z.array(
        z.object({
          type: z.enum(["spelling", "grammar", "accent", "vocabulary", "word_order"]),
          original: z.string(),
          corrected: z.string(),
          explanation: z.string(),
        }),
      ),
      naturalPhrasings: z.array(
        z.object({
          greek: z.string(),
          english: z.string(),
          why: z.string(),
        }),
      ),
    })
    .nullable(),
});

function stripCombiningMarks(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function normalizeStudyText(text: string): string {
  return stripCombiningMarks(String(text || "").toLocaleLowerCase("el"))
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function deterministicMatch(answer: string, expected: string[]): boolean {
  const normalized = normalizeStudyText(answer);
  return Boolean(normalized && expected.some((candidate) => normalizeStudyText(candidate) === normalized));
}

const scoreGameAnswerFlow = getAI().defineFlow(
  {
    name: "scoreGameAnswer",
    inputSchema: ScoreGameAnswerFlowInputSchema,
    outputSchema: GameAttemptResultSchema,
  },
  async (input) => {
    const model = await getModelFor("gameScoring");
    const decoding = await getDecodingFor("gameScoring");
    const expected = [
      input.exercise.expectedAnswer,
      ...(input.exercise.acceptableAnswers ?? []),
    ]
      .filter(Boolean)
      .join(" || ");

    const { output } = await getAI().generate({
      model,
      output: { schema: GameAttemptResultSchema },
      config: {
        maxOutputTokens: 2048,
        ...decoding,
      },
      system:
        "You grade answers for a Modern Greek learning app. Be encouraging, concise, and strict enough to help learning. Accept minor spelling, accent, casing, and punctuation differences when meaning is clear. Return JSON only.",
      prompt: `Lesson: ${input.lessonTitle}
Lesson id: ${input.lessonId}
Learner preferences: response language ${input.preferences.responseLanguage}, level ${input.preferences.cefrLevel}
${input.skillLevel ? `Learner skill level (binding): ${input.skillLevel} — ${SKILL_LEVEL_LABELS[input.skillLevel]}` : ""}
Exercise type: ${input.exercise.type}
Direction: ${input.exercise.direction ?? ""}
Title: ${input.exercise.title ?? ""}
Prompt: ${input.exercise.prompt}
Passage: ${input.exercise.passage ?? ""}
Question: ${input.exercise.question ?? ""}
Expected answer or criteria: ${input.exercise.expectedAnswer ?? ""}
Acceptable answers: ${expected}
Rubric: ${input.exercise.rubric ?? ""}
Target words: ${(input.exercise.requiredWords ?? []).join(", ")}
Learner answer: ${input.answer}
Deterministic normalized exact match: ${input.exact ? "yes" : "no"}

Rules:
- If deterministic normalized exact match is yes, accepted must be true, verdict correct, score at least 0.96.
- For story or open-ended prompts, grade relevance, use of target words, and understandable Greek rather than demanding one exact sentence.
- For reading questions, accept short answers if they show comprehension.
- Include greekCorrection only when the learner wrote Greek; otherwise use null.
- When greekCorrection is present:
  - tips: up to 5 specific issues (spelling | grammar | accent | vocabulary | word_order), each with the exact "original" fragment, the "corrected" Greek, and a one-sentence English "explanation".
  - naturalPhrasings: up to 3 alternative ways a native speaker might more naturally phrase the same intent — even when the learner's Greek is technically correct. Each item has greek, english (rough meaning), and why (one sentence). Return an empty array if there really isn't a more natural alternative.
- Feedback, shortReason, and betterAnswer commentary should follow the learner response language preference. Keep betterAnswer itself in the target answer language.`,
    });

    if (!output) throw new Error("AI grading returned no output.");
    if (!input.exact) return output;
    return {
      ...output,
      accepted: true,
      verdict: "correct" as const,
      score: Math.max(output.score, 0.96),
      betterAnswer: output.betterAnswer || input.exercise.expectedAnswer || input.answer,
      shortReason: output.shortReason || "Exact match",
    };
  },
);

async function resolveSkillLevel(courseId: string, lessonId: string): Promise<SkillLevel | undefined> {
  if (!courseId) return undefined;
  const db = getFirestore();
  const courseSnap = await db.doc(`courses/${courseId}`).get();
  const course = courseSnap.data();
  let level: SkillLevel | undefined;
  if (course) {
    const parsed = SkillLevelSchema.safeParse(course.skillLevel);
    if (parsed.success) level = parsed.data;
  }
  if (lessonId) {
    const lessonSnap = await db.doc(`courses/${courseId}/lessons/${lessonId}`).get();
    const lesson = lessonSnap.data();
    if (lesson) {
      const parsed = SkillLevelSchema.safeParse(lesson.skillLevel);
      if (parsed.success) level = parsed.data;
    }
  }
  return level;
}

export const scoreGameAnswer = onCall({ secrets: [geminiApiKey], cors: ALLOWED_ORIGINS }, async (request) => {
  const parsed = ScoreGameAnswerInputSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", parsed.error.issues.map((issue) => issue.message).join("; "));
  }

  const input = parsed.data;
  const expected = [
    input.exercise.expectedAnswer,
    ...(input.exercise.acceptableAnswers ?? []),
  ].filter(Boolean) as string[];

  try {
    const skillLevel = await resolveSkillLevel(input.courseId, input.lessonId);
    return await scoreGameAnswerFlow({
      ...input,
      exact: deterministicMatch(input.answer, expected),
      skillLevel,
    });
  } catch (err) {
    throw new HttpsError("internal", err instanceof Error ? err.message : String(err));
  }
});
