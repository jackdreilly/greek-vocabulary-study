import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { geminiApiKey } from "../ai/genkitClient.js";
import { getModelFor } from "../ai/configResolver.js";
import { generateUsageFlow, buildUsagePrompt } from "../ai/usageGeneration.js";
import { SkillLevelSchema } from "../schemas/common.js";

function status(message: string) {
  return { at: Timestamp.now(), message, source: "system" as const };
}

export const onUsageGenerationWritten = onDocumentWritten(
  {
    document: "courses/{courseId}/lessons/{lessonId}/entries/{entryId}/usageGenerations/{generationId}",
    secrets: [geminiApiKey],
  },
  async (event) => {
    const after = event.data?.after;
    if (!after?.exists || after.data()?.status !== "initializing") return;

    const { courseId, lessonId, entryId } = event.params;
    const db = getFirestore();
    const requestRef = after.ref;
    const lessonRef = db.doc(`courses/${courseId}/lessons/${lessonId}`);
    const courseRef = db.doc(`courses/${courseId}`);
    const entryRef = lessonRef.collection("entries").doc(entryId);

    const claimed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(requestRef);
      if (!snap.exists || snap.data()?.status !== "initializing") return false;
      tx.update(requestRef, {
        status: "streaming",
        statusLog: FieldValue.arrayUnion(status("Sentence usage generation claimed.")),
        updatedAt: Timestamp.now(),
      });
      return true;
    });
    if (!claimed) return;

    try {
      const [entrySnap, lessonSnap, courseSnap] = await Promise.all([
        entryRef.get(),
        lessonRef.get(),
        courseRef.get(),
      ]);
      if (!entrySnap.exists) throw new Error("Vocabulary entry no longer exists.");

      const entry = entrySnap.data() ?? {};
      const lesson = lessonSnap.data() ?? {};
      const course = courseSnap.data() ?? {};
      const lessonLevel = SkillLevelSchema.safeParse(lesson.skillLevel);
      const courseLevel = SkillLevelSchema.safeParse(course.skillLevel);
      const skillLevel =
        (lessonLevel.success ? lessonLevel.data : undefined) ??
        (courseLevel.success ? courseLevel.data : undefined);
      const modelUsed = await getModelFor("usageGen");
      const input = {
        lemma: String(entry.lemma ?? ""),
        article: typeof entry.article === "string" ? entry.article : undefined,
        english: String(entry.english ?? entry.senses?.[0] ?? ""),
        senses: Array.isArray(entry.senses) ? entry.senses.map(String) : [],
        category: typeof entry.category === "string" ? entry.category : undefined,
        skillLevel,
      };

      await requestRef.update({
        modelUsed,
        skillLevel: skillLevel ?? null,
        prompt: buildUsagePrompt(input),
        statusLog: FieldValue.arrayUnion(status("Asking AI for three sentence usages.")),
        updatedAt: Timestamp.now(),
      });
      const generated = await generateUsageFlow(input);
      await requestRef.update({
        usages: generated.usages,
        status: "ready",
        statusLog: FieldValue.arrayUnion(status("Three sentence usages generated.")),
        completedAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
    } catch (err) {
      logger.error("onUsageGenerationWritten failed", { courseId, lessonId, entryId, err });
      await requestRef.update({
        status: "error",
        error: err instanceof Error ? err.message : String(err),
        statusLog: FieldValue.arrayUnion(status("Sentence usage generation failed.")),
        updatedAt: Timestamp.now(),
      });
    }
  },
);
