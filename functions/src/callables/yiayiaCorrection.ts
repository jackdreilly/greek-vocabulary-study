/**
 * Greek-text correction for Yiayia.
 *
 * When the user writes Greek in Yiayia (or any "write a full Greek sentence"
 * surface), the frontend calls this in parallel with the streaming reply.
 * Returns a structured correction widget payload:
 *   - correctedText:        the fully corrected version of their input
 *   - tips:                 specific issues (spelling, grammar, accent, etc.)
 *   - naturalPhrasings:     ALTERNATIVES that are more idiomatic / natural
 *                           even when the user's text is technically fine
 *   - isPerfect:            true iff there are no tips AND no naturalPhrasings
 *
 * If the user did not actually write any Greek, the function returns null.
 */
import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "genkit";
import { getDecodingFor, getModelFor } from "../ai/configResolver.js";
import { geminiApiKey, getAI } from "../ai/genkitClient.js";
import { ALLOWED_ORIGINS } from "../cors.js";
import { SKILL_LEVEL_LABELS, SkillLevelSchema, type SkillLevel } from "../schemas/common.js";

const GreekTipSchema = z.object({
  type: z.enum(["spelling", "grammar", "accent", "vocabulary", "word_order"]),
  original: z.string(),
  corrected: z.string(),
  explanation: z.string(),
});

const NaturalPhrasingSchema = z.object({
  greek: z.string(),
  english: z.string(),
  why: z.string(),
});

const GreekCorrectionSchema = z
  .object({
    correctedText: z.string(),
    tips: z.array(GreekTipSchema).max(5),
    naturalPhrasings: z.array(NaturalPhrasingSchema).max(3),
  })
  .nullable();

const InputSchema = z.object({
  courseId: z.string().optional().default(""),
  lessonId: z.string().optional().default(""),
  text: z.string().min(1).max(6000),
});

function hasGreekText(text: string): boolean {
  return /[Ͱ-Ͽἀ-῿]/.test(text);
}

async function readContextLine(courseId: string, lessonId: string): Promise<{ context: string; skillLevel: SkillLevel | undefined }> {
  if (!courseId) return { context: "", skillLevel: undefined };
  const db = getFirestore();
  const courseSnap = await db.doc(`courses/${courseId}`).get();
  const course = courseSnap.data() ?? {};
  let lesson: Record<string, unknown> | undefined;
  if (lessonId) {
    const lessonSnap = await db.doc(`courses/${courseId}/lessons/${lessonId}`).get();
    lesson = lessonSnap.data() ?? undefined;
  }
  const courseLevel = SkillLevelSchema.safeParse(course.skillLevel);
  const lessonLevel = lesson ? SkillLevelSchema.safeParse(lesson.skillLevel) : undefined;
  const skillLevel: SkillLevel | undefined =
    (lessonLevel?.success ? lessonLevel.data : undefined) ??
    (courseLevel.success ? courseLevel.data : undefined);
  const parts: string[] = [];
  if (course.title) parts.push(`Course: ${course.title}`);
  if (lesson?.title) parts.push(`Lesson: ${lesson.title}`);
  if (skillLevel) parts.push(`Learner skill level: ${skillLevel} — ${SKILL_LEVEL_LABELS[skillLevel]}`);
  return { context: parts.join("\n"), skillLevel };
}

const SYSTEM_PROMPT = `You are a Greek language proofreader and idiomatic editor. The user has written Greek as a learner. Return strict JSON — no markdown, no prose.

Output schema:
- correctedText: a single grammatically correct, properly-accented version of the user's full input. If the input is already fully correct, return it verbatim.
- tips: up to 5 specific corrections. Each tip has type (spelling | grammar | accent | vocabulary | word_order), original (exact fragment from input), corrected (correct Greek), explanation (one short English sentence).
- naturalPhrasings: up to 3 ALTERNATIVE ways to express the same intent that sound more natural / idiomatic / native than the user's wording, even if the user's Greek was technically correct. Each item has greek (the alternative), english (its rough English meaning), why (one short English sentence saying why a native might prefer it). Skip an item if there really is no better way to say it — better to return an empty array than to fabricate an alternative.

If the user did NOT actually write Greek (e.g. only English, or a one-word request like "μίλα ελληνικά"), return null instead of an object.

Be encouraging, precise, and concise. Calibrate naturalPhrasings to the learner's skill level when given — don't suggest C2 idioms to an A1 learner.`;

export const yiayiaCorrection = onCall(
  { secrets: [geminiApiKey], cors: ALLOWED_ORIGINS },
  async (request) => {
    const parsed = InputSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError("invalid-argument", parsed.error.issues.map((i) => i.message).join("; "));
    }
    const { courseId, lessonId, text } = parsed.data;
    if (!hasGreekText(text)) return { correction: null };

    try {
      const [model, decoding, ctx] = await Promise.all([
        getModelFor("yiayiaChat"),
        getDecodingFor("yiayiaChat"),
        readContextLine(courseId, lessonId),
      ]);

      const prompt = [
        ctx.context ? `Context:\n${ctx.context}` : "",
        `Learner wrote: ${text}`,
      ]
        .filter(Boolean)
        .join("\n\n");

      const { output } = await getAI().generate({
        model,
        output: { schema: GreekCorrectionSchema },
        config: {
          maxOutputTokens: 1200,
          ...decoding,
        },
        system: SYSTEM_PROMPT,
        prompt,
      });

      return { correction: output ?? null };
    } catch (err) {
      throw new HttpsError("internal", err instanceof Error ? err.message : String(err));
    }
  },
);
