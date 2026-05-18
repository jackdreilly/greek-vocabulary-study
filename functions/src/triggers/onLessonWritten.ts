import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { z } from "genkit";
import { geminiApiKey, getAI } from "../ai/genkitClient.js";
import { buildVocabPrompt, generateVocabFlow, normalizeArticle, primaryEnglish } from "../ai/vocabGeneration.js";
import { getModelFor, getDecodingFor } from "../ai/configResolver.js";

const LessonOverviewSchema = z.object({
  overviewMarkdown: z.string(),
});

const LessonTitleSchema = z.object({
  title: z.string().min(3).max(90),
  subtitle: z.string().max(120).optional(),
});

function buildLessonTitlePrompt(input: {
  courseTitle: string;
  courseDescription?: string;
  courseSourcePrompt?: string;
  currentTitle: string;
  lessonSourcePrompt?: string;
}) {
  return `Name this lesson inside a Modern Greek vocabulary course.

Original course request:
${input.courseSourcePrompt ?? ""}

Course: ${input.courseTitle}
Course description: ${input.courseDescription ?? ""}
Current draft title: ${input.currentTitle}
Original lesson focus request: ${input.lessonSourcePrompt ?? input.currentTitle}

Requirements:
- title must be concise, representative, and in English title case
- do not leave the user's raw prompt as the title
- omit trailing punctuation
- prefer a concrete situation, theme, or skill over a generic label
- subtitle should be sentence case and describe the learner-facing focus in a few words`;
}

function buildLessonOverviewPrompt(input: {
  courseTitle: string;
  courseDescription?: string;
  courseSourcePrompt?: string;
  lessonTitle: string;
  lessonSubtitle?: string;
  lessonSourcePrompt?: string;
}) {
  const previousTurn = {
    lessonTitle: input.lessonTitle,
    lessonSubtitle: input.lessonSubtitle ?? "",
  };
  return `Write a lesson overview in markdown for this Greek vocabulary lesson.

Original course request:
${input.courseSourcePrompt ?? ""}

Original lesson focus request:
${input.lessonSourcePrompt ?? input.lessonTitle}

Use this previously generated lesson-title result as binding context:
${JSON.stringify(previousTurn, null, 2)}

Course: ${input.courseTitle}
Course description: ${input.courseDescription ?? ""}

Requirements:
- Write an engaging markdown overview with 4-7 substantial paragraphs.
- Use ## section headers, occasional **bold** emphasis, and a short bullet list only where it helps scanning.
- Include what the learner will learn, what situations the vocabulary supports, and why this lesson fits the course arc.
- Make it feel like a thoughtful textbook introduction, not a status blurb or admin summary.
- Write in English. Do not include the lesson title as a heading (it's already shown above the overview).`;
}

const generateLessonTitleFlow = getAI().defineFlow(
  {
    name: "generateLessonTitle",
    inputSchema: z.object({
      courseTitle: z.string(),
      courseDescription: z.string().optional(),
      courseSourcePrompt: z.string().optional(),
      currentTitle: z.string(),
      lessonSourcePrompt: z.string().optional(),
    }),
    outputSchema: LessonTitleSchema,
  },
  async (input) => {
    const model = await getModelFor("lessonGen");
    const decoding = await getDecodingFor("lessonGen");
    const { output } = await getAI().generate({
      model,
      output: { schema: LessonTitleSchema },
      config: { maxOutputTokens: 500, ...decoding },
      system:
        "You name Modern Greek vocabulary lessons. Return strict JSON with a polished, representative lesson title and optional subtitle.",
      prompt: buildLessonTitlePrompt(input),
    });
    if (!output) throw new Error("Lesson title generation returned no output.");
    return output;
  },
);

const generateLessonOverviewFlow = getAI().defineFlow(
  {
    name: "generateLessonOverview",
    inputSchema: z.object({
      courseTitle: z.string(),
      courseDescription: z.string().optional(),
      courseSourcePrompt: z.string().optional(),
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
      prompt: buildLessonOverviewPrompt(input),
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

function persistable(value: unknown) {
  return JSON.parse(JSON.stringify(value));
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
      const currentTitle = String(data.title ?? lessonId);
      const courseSourcePrompt =
        typeof course.sourcePrompt === "string"
          ? course.sourcePrompt
          : typeof data.courseSourcePrompt === "string"
            ? data.courseSourcePrompt
            : "";
      const lessonSourcePrompt = typeof data.sourcePrompt === "string" ? data.sourcePrompt : "";

      await genRef.set({
        id: genId,
        kind: "lesson",
        parentDoc: lessonRef.path,
        parentGenerationId: data.parentGenerationId ?? course.generationId ?? "",
        sourcePrompt: lessonSourcePrompt || courseSourcePrompt,
        prompts: {
          originalCourse: courseSourcePrompt,
          originalLesson: lessonSourcePrompt,
        },
        trigger: { kind: "cascade", description: `Lesson generation for ${currentTitle}` },
        status: "streaming",
        statusLog: [status("Lesson generation started.")],
        modelUsed,
        manifest: [{ path: lessonRef.path, action: "update" }],
        createdAt: Timestamp.now(),
      });

      const generatedTitle = await generateLessonTitleFlow({
        courseTitle: String(course.title ?? "Greek course"),
        courseDescription: typeof course.description === "string" ? course.description : "",
        courseSourcePrompt,
        currentTitle,
        lessonSourcePrompt,
      });
      await genRef.update({
        "trigger.description": `Lesson generation for ${generatedTitle.title}`,
        "prompts.lessonTitle": buildLessonTitlePrompt({
          courseTitle: String(course.title ?? "Greek course"),
          courseDescription: typeof course.description === "string" ? course.description : "",
          courseSourcePrompt,
          currentTitle,
          lessonSourcePrompt,
        }),
        "stepOutputs.lessonTitle": persistable(generatedTitle),
      });

      await Promise.all([
        lessonRef.update({
          title: generatedTitle.title,
          subtitle: generatedTitle.subtitle ?? "",
          statusLog: FieldValue.arrayUnion(status("Lesson title ready."), status("Generating overview.")),
          generationId: genId,
          generationHistory: FieldValue.arrayUnion(genId),
          updatedAt: Timestamp.now(),
        }),
        courseRef.update({
          [`lessonSummaries.${lessonId}`]: {
            title: generatedTitle.title,
            subtitle: generatedTitle.subtitle ?? "",
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
        courseSourcePrompt,
        lessonTitle: generatedTitle.title,
        lessonSubtitle: generatedTitle.subtitle ?? "",
        lessonSourcePrompt,
      });
      await genRef.update({
        "prompts.lessonOverview": buildLessonOverviewPrompt({
          courseTitle: String(course.title ?? "Greek course"),
          courseDescription: typeof course.description === "string" ? course.description : "",
          courseSourcePrompt,
          lessonTitle: generatedTitle.title,
          lessonSubtitle: generatedTitle.subtitle ?? "",
          lessonSourcePrompt,
        }),
        "stepOutputs.lessonOverview": persistable(generatedOverview),
      });

      await lessonRef.update({
        description: generatedOverview.overviewMarkdown,
        overview: {
          generationId: genId,
          widgets: [
            { id: "overview-heading", type: "heading", level: 1, text: generatedTitle.title },
            { id: "overview-prose", type: "markdown", markdown: generatedOverview.overviewMarkdown },
          ],
        },
        statusLog: FieldValue.arrayUnion(status("Overview ready. Generating vocabulary.")),
        updatedAt: Timestamp.now(),
      });

      const vocabInput = {
        courseTitle: String(course.title ?? "Greek course"),
        courseDescription: typeof course.description === "string" ? course.description : "",
        courseSourcePrompt,
        lessonTitle: generatedTitle.title,
        lessonDescription: generatedOverview.overviewMarkdown,
        lessonSourcePrompt,
        prompt: lessonSourcePrompt || generatedTitle.title,
        count: Number(data.targetEntryCount ?? 30),
        existingLemmas: [],
        chainContext: JSON.stringify({
          courseTitle: String(course.title ?? "Greek course"),
          courseDescription: typeof course.description === "string" ? course.description : "",
          generatedLessonTitle: generatedTitle,
          generatedLessonOverview: generatedOverview,
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
