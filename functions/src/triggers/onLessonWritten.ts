import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { z } from "genkit";
import { geminiApiKey, getAI } from "../ai/genkitClient.js";
import { generateVocabFlow, normalizeArticle, primaryEnglish } from "../ai/vocabGeneration.js";
import { getModelFor, getDecodingFor } from "../ai/configResolver.js";

const LessonOverviewSchema = z.object({
  overviewMarkdown: z.string(),
});

const generateLessonOverviewFlow = getAI().defineFlow(
  {
    name: "generateLessonOverview",
    inputSchema: z.object({
      courseTitle: z.string(),
      courseDescription: z.string().optional(),
      lessonTitle: z.string(),
      lessonSubtitle: z.string().optional(),
      lessonSourcePrompt: z.string().optional(),
    }),
    outputSchema: LessonOverviewSchema,
  },
  async (input) => {
    const model = await getModelFor("lessonGen");
    const decoding = await getDecodingFor("lessonGen");
    const { output } = await getAI().generate({
      model,
      output: { schema: LessonOverviewSchema },
      config: { maxOutputTokens: 1500, ...decoding },
      system: "You are a Modern Greek curriculum designer. Write concise, scannable lesson overviews in markdown.",
      prompt: `Write a lesson overview in markdown for this Greek vocabulary lesson.

Course: ${input.courseTitle}
Course description: ${input.courseDescription ?? ""}
Lesson: ${input.lessonTitle}
Lesson subtitle: ${input.lessonSubtitle ?? ""}
Lesson focus: ${input.lessonSourcePrompt ?? input.lessonTitle}

Requirements:
- Use ## section headers and bullet lists — NOT a wall of prose.
- Sections to include: "## What you'll learn" (3-5 bullets of vocabulary areas or situations), "## You'll be able to" (3-4 practical outcomes in the learner's voice, e.g. "Order a coffee and ask for the bill").
- Keep it under 150 words total.
- Write in English. Do not include the lesson title as a heading (it's already shown above the overview).`,
    });
    if (!output) throw new Error("Lesson overview generation returned no output.");
    return output;
  },
);

function status(message: string) {
  return { at: Timestamp.now(), message, source: "system" };
}

function generationId(kind: string) {
  return `gen_${kind}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function entryId(index: number, lemma: string) {
  const latinish = lemma
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);
  return `e${String(index + 1).padStart(3, "0")}${latinish ? `-${latinish}` : ""}`;
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

export const onLessonWritten = onDocumentWritten(
  {
    document: "courses/{courseId}/lessons/{lessonId}",
    secrets: [geminiApiKey],
  },
  async (event) => {
    const after = event.data?.after;
    if (!after?.exists) return;
    const data = after.data();
    if (!data || data.status !== "initializing") return;

    const { courseId, lessonId } = event.params;
    const db = getFirestore();
    const lessonRef = after.ref;
    const courseRef = db.doc(`courses/${courseId}`);

    const claimed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(lessonRef);
      const current = snap.data();
      if (!current || current.status !== "initializing") return false;
      tx.update(lessonRef, {
        status: "streaming",
        statusLog: FieldValue.arrayUnion(status("Lesson generation claimed.")),
        updatedAt: Timestamp.now(),
      });
      return true;
    });
    if (!claimed) return;

    const genId = generationId("lesson");
    const genRef = db.doc(`generations/${genId}`);
    const startedAt = Date.now();

    try {
      const courseSnap = await courseRef.get();
      const course = courseSnap.data() ?? {};
      const modelUsed = await getModelFor("lessonGen");

      await genRef.set({
        id: genId,
        kind: "lesson",
        parentDoc: lessonRef.path,
        parentGenerationId: data.parentGenerationId ?? course.generationId ?? "",
        sourcePrompt: data.sourcePrompt ?? course.sourcePrompt ?? "",
        trigger: { kind: "cascade", description: `Lesson generation for ${data.title ?? lessonId}` },
        status: "streaming",
        statusLog: [status("Lesson generation started.")],
        modelUsed,
        manifest: [{ path: lessonRef.path, action: "update" }],
        createdAt: Timestamp.now(),
      });

      await Promise.all([
        lessonRef.update({
          statusLog: FieldValue.arrayUnion(status("Generating overview.")),
          generationId: genId,
          generationHistory: FieldValue.arrayUnion(genId),
          updatedAt: Timestamp.now(),
        }),
        courseRef.update({
          [`lessonSummaries.${lessonId}`]: {
            title: data.title ?? lessonId,
            subtitle: data.subtitle ?? "",
            order: Number(data.order ?? 999),
            status: "streaming",
            entryCount: 0,
            planCount: 0,
            gameCount: 0,
          },
          "counts.lessons": data.parentGenerationId ? FieldValue.increment(0) : FieldValue.increment(1),
          updatedAt: Timestamp.now(),
        }).catch(() => undefined),
      ]);

      const generatedOverview = await generateLessonOverviewFlow({
        courseTitle: String(course.title ?? "Greek course"),
        courseDescription: typeof course.description === "string" ? course.description : "",
        lessonTitle: String(data.title ?? lessonId),
        lessonSubtitle: typeof data.subtitle === "string" ? data.subtitle : "",
        lessonSourcePrompt: typeof data.sourcePrompt === "string" ? data.sourcePrompt : "",
      });

      await lessonRef.update({
        description: generatedOverview.overviewMarkdown,
        overview: {
          generationId: genId,
          widgets: [
            { id: "overview-heading", type: "heading", level: 1, text: data.title ?? lessonId },
            { id: "overview-prose", type: "markdown", markdown: generatedOverview.overviewMarkdown },
          ],
        },
        statusLog: FieldValue.arrayUnion(status("Overview ready. Generating vocabulary.")),
        updatedAt: Timestamp.now(),
      });

      const generated = await generateVocabFlow({
        courseTitle: String(course.title ?? "Greek course"),
        courseDescription: typeof course.description === "string" ? course.description : "",
        courseSourcePrompt: typeof course.sourcePrompt === "string" ? course.sourcePrompt : "",
        lessonTitle: String(data.title ?? lessonId),
        lessonDescription: generatedOverview.overviewMarkdown,
        lessonSourcePrompt: typeof data.sourcePrompt === "string" ? data.sourcePrompt : "",
        prompt: typeof data.sourcePrompt === "string" ? data.sourcePrompt : String(data.title ?? lessonId),
        count: Number(data.targetEntryCount ?? 30),
        existingLemmas: [],
      });

      const manifest: Array<{ path: string; action: "create" | "update" }> = [{ path: lessonRef.path, action: "update" }];
      for (const [index, suggestion] of generated.suggestions.entries()) {
        const id = entryId(index, suggestion.lemma);
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
          order: index + 1,
          generationId: genId,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        }));
        await lessonRef.update({
          statusLog: FieldValue.arrayUnion(status(`Added vocabulary ${index + 1} of ${generated.suggestions.length}.`)),
          updatedAt: Timestamp.now(),
        });
      }

      const entryCount = generated.suggestions.length;
      await Promise.all([
        lessonRef.update({
          status: "ready",
          statusLog: FieldValue.arrayUnion(status("Lesson vocabulary complete.")),
          counts: { ...(data.counts ?? {}), entries: entryCount, plans: 0, games: 0 },
          updatedAt: Timestamp.now(),
        }),
        courseRef.update({
          [`lessonSummaries.${lessonId}.status`]: "ready",
          [`lessonSummaries.${lessonId}.entryCount`]: entryCount,
          "counts.entries": FieldValue.increment(entryCount),
          updatedAt: Timestamp.now(),
        }),
        genRef.update({
          status: "done",
          manifest,
          completedAt: Timestamp.now(),
          latencyMs: Date.now() - startedAt,
          statusLog: FieldValue.arrayUnion(status("Lesson generation complete.")),
        }),
      ]);
    } catch (err) {
      logger.error("onLessonWritten failed", { courseId, lessonId, err });
      await Promise.all([
        lessonRef.update({
          status: "error",
          error: err instanceof Error ? err.message : String(err),
          statusLog: FieldValue.arrayUnion(status("Lesson generation failed.")),
          updatedAt: Timestamp.now(),
        }),
        genRef.set(
          {
            id: genId,
            kind: "lesson",
            parentDoc: lessonRef.path,
            status: "error",
            error: err instanceof Error ? err.message : String(err),
            statusLog: FieldValue.arrayUnion(status("Lesson generation failed.")),
            manifest: [{ path: lessonRef.path, action: "update" }],
            createdAt: Timestamp.now(),
          },
          { merge: true },
        ),
      ]);
    }
  },
);
