import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { geminiApiKey } from "../ai/genkitClient.js";
import { getModelFor } from "../ai/configResolver.js";
import { buildVocabPrompt, generateVocabFlow, normalizeArticle, primaryEnglish } from "../ai/vocabGeneration.js";
import { SkillLevelSchema } from "../schemas/common.js";

function status(message: string) {
  return { at: Timestamp.now(), message, source: "system" };
}

function generationId(kind: string) {
  return `gen_${kind}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function entryId(order: number, lemma: string) {
  const stem = lemma
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);
  return `e${String(order).padStart(3, "0")}${stem ? `-${stem}` : ""}`;
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

function persistable(value: unknown) {
  return JSON.parse(JSON.stringify(value));
}

export const onVocabBatchWritten = onDocumentWritten(
  {
    document: "courses/{courseId}/lessons/{lessonId}/vocabBatches/{batchId}",
    secrets: [geminiApiKey],
  },
  async (event) => {
    const after = event.data?.after;
    if (!after?.exists) return;
    const data = after.data();
    if (!data || data.status !== "initializing") return;

    const { courseId, lessonId, batchId } = event.params;
    const db = getFirestore();
    const batchRef = after.ref;
    const lessonRef = db.doc(`courses/${courseId}/lessons/${lessonId}`);
    const courseRef = db.doc(`courses/${courseId}`);

    const claimed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(batchRef);
      const current = snap.data();
      if (!current || current.status !== "initializing") return false;
      tx.update(batchRef, {
        status: "streaming",
        statusLog: FieldValue.arrayUnion(status("Vocabulary generation claimed.")),
        updatedAt: Timestamp.now(),
      });
      return true;
    });
    if (!claimed) return;

    const genId = generationId("entry_batch");
    const genRef = db.doc(`generations/${genId}`);
    const startedAt = Date.now();

    try {
      const [courseSnap, lessonSnap, existingSnap] = await Promise.all([
        courseRef.get(),
        lessonRef.get(),
        lessonRef.collection("entries").orderBy("order").get(),
      ]);
      const course = courseSnap.data() ?? {};
      const lesson = lessonSnap.data() ?? {};
      const existing = existingSnap.docs.map((doc) => doc.data());
      const modelUsed = await getModelFor("lessonGen");

      await genRef.set({
        id: genId,
        kind: "entry_batch",
        parentDoc: batchRef.path,
        sourcePrompt: data.prompt ?? "",
        prompts: {
          originalCourse: typeof course.sourcePrompt === "string" ? course.sourcePrompt : "",
          originalLesson: typeof lesson.sourcePrompt === "string" ? lesson.sourcePrompt : "",
          originalVocab: String(data.prompt ?? "Add useful vocabulary for this lesson."),
        },
        trigger: { kind: "user_action", description: `Vocabulary batch for ${lesson.title ?? lessonId}` },
        status: "streaming",
        statusLog: [status("Vocabulary batch generation started.")],
        modelUsed,
        manifest: [],
        createdAt: Timestamp.now(),
      });

      await batchRef.update({
        generationId: genId,
        statusLog: FieldValue.arrayUnion(status("Asking AI for new vocabulary.")),
        updatedAt: Timestamp.now(),
      });

      const lessonLevelParse = SkillLevelSchema.safeParse(lesson.skillLevel);
      const courseLevelParse = SkillLevelSchema.safeParse(course.skillLevel);
      const skillLevel =
        (lessonLevelParse.success ? lessonLevelParse.data : undefined) ??
        (courseLevelParse.success ? courseLevelParse.data : undefined);

      const vocabInput = {
        courseTitle: String(course.title ?? "Greek course"),
        courseDescription: typeof course.description === "string" ? course.description : "",
        courseSourcePrompt: typeof course.sourcePrompt === "string" ? course.sourcePrompt : "",
        lessonTitle: String(lesson.title ?? lessonId),
        lessonDescription: typeof lesson.description === "string" ? lesson.description : "",
        lessonSourcePrompt: typeof lesson.sourcePrompt === "string" ? lesson.sourcePrompt : "",
        prompt: String(data.prompt ?? "Add useful vocabulary for this lesson."),
        count: Math.max(1, Math.min(80, Number(data.count ?? 20))),
        existingLemmas: existing.map((entry) => String(entry.lemma ?? "")).filter(Boolean),
        requiredLemmas: [],
        skillLevel,
        chainContext: JSON.stringify({
          lessonTitle: String(lesson.title ?? lessonId),
          lessonOverview: typeof lesson.description === "string" ? lesson.description : "",
          existingLemmaCount: existing.length,
        }, null, 2),
      };
      await genRef.update({
        "prompts.vocab": buildVocabPrompt(vocabInput),
      });
      const generated = await generateVocabFlow(vocabInput);
      await genRef.update({
        "stepOutputs.vocab": persistable({
          count: generated.suggestions.length,
          lemmas: generated.suggestions.map((suggestion) => suggestion.lemma),
        }),
      });

      const manifest: Array<{ path: string; action: "create" }> = [];
      let order = existing.length;
      for (const suggestion of generated.suggestions) {
        order += 1;
        const id = entryId(order, suggestion.lemma);
        const ref = lessonRef.collection("entries").doc(id);
        manifest.push({ path: ref.path, action: "create" });
        await ref.set(compact({
          id,
          courseId,
          lessonId,
          lemma: suggestion.lemma,
          article: normalizeArticle(suggestion.article),
          english: primaryEnglish(suggestion),
          senses: suggestion.english_senses,
          notes: suggestion.notes ?? "",
          category: suggestion.category,
          order,
          generationId: genId,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        }));
        await batchRef.update({
          statusLog: FieldValue.arrayUnion(status(`Added ${suggestion.lemma}.`)),
          updatedAt: Timestamp.now(),
        });
      }

      const nextEntryCount = existing.length + generated.suggestions.length;
      await Promise.all([
        batchRef.update({
          status: "ready",
          createdEntryIds: manifest.map((item) => item.path.split("/").pop()),
          statusLog: FieldValue.arrayUnion(status(`Generated ${generated.suggestions.length} vocabulary entries.`)),
          updatedAt: Timestamp.now(),
        }),
        lessonRef.update({
          "counts.entries": nextEntryCount,
          updatedAt: Timestamp.now(),
        }),
        courseRef.update({
          [`lessonSummaries.${lessonId}.entryCount`]: nextEntryCount,
          "counts.entries": FieldValue.increment(generated.suggestions.length),
          updatedAt: Timestamp.now(),
        }).catch(() => undefined),
        genRef.update({
          status: "done",
          manifest,
          completedAt: Timestamp.now(),
          latencyMs: Date.now() - startedAt,
          statusLog: FieldValue.arrayUnion(status("Vocabulary batch generation complete.")),
        }),
      ]);
    } catch (err) {
      logger.error("onVocabBatchWritten failed", { courseId, lessonId, batchId, err });
      await Promise.all([
        batchRef.update({
          status: "error",
          error: err instanceof Error ? err.message : String(err),
          statusLog: FieldValue.arrayUnion(status("Vocabulary generation failed.")),
          updatedAt: Timestamp.now(),
        }),
        genRef.set(
          {
            id: genId,
            kind: "entry_batch",
            parentDoc: batchRef.path,
            status: "error",
            error: err instanceof Error ? err.message : String(err),
            statusLog: FieldValue.arrayUnion(status("Vocabulary generation failed.")),
            manifest: [],
            createdAt: Timestamp.now(),
          },
          { merge: true },
        ),
      ]);
    }
  },
);
