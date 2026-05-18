import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { z } from "genkit";
import { getAI, geminiApiKey } from "../ai/genkitClient.js";
import { getDecodingFor, getModelFor } from "../ai/configResolver.js";

const GeneratedPlanSchema = z.object({
  title: z.string(),
  subtitle: z.string().optional(),
  estimatedMinutes: z.number().int().positive(),
  coveredWords: z.array(z.string()).min(3).max(30),
  coveredConcepts: z.array(z.string()).min(2).max(10),
  hookMarkdown: z.string(),
  patternTitle: z.string(),
  patternMarkdown: z.string(),
  vocabRows: z.array(
    z.object({
      el: z.string(),
      en: z.string(),
      article: z.string().optional(),
      example: z.string().optional(),
    }),
  ).min(4).max(12),
  reading: z.object({
    el: z.string(),
    en: z.string(),
    glossary: z.array(z.object({ el: z.string(), en: z.string() })).min(2).max(8),
  }),
  quizItems: z.array(
    z.object({
      q: z.string(),
      options: z.array(z.string()).min(2).max(4),
      correctIndex: z.number().int().nonnegative(),
      explanation: z.string().optional(),
    }),
  ).min(2).max(5),
  blanks: z.array(
    z.object({
      sentence: z.string(),
      answer: z.string(),
      hint: z.string().optional(),
      english: z.string().optional(),
    }),
  ).min(2).max(5),
  wrapUpMarkdown: z.string(),
});

const GeneratePlanInputSchema = z.object({
  courseTitle: z.string(),
  courseDescription: z.string().optional(),
  lessonTitle: z.string(),
  lessonDescription: z.string().optional(),
  planNumber: z.number().int().positive(),
  customFocus: z.string().optional(),
  entries: z.array(
    z.object({
      id: z.string(),
      lemma: z.string(),
      article: z.string().optional(),
      english: z.string(),
      senses: z.array(z.string()).optional(),
      category: z.string().optional(),
    }),
  ),
  previousPlans: z.array(
    z.object({
      planNumber: z.number().int().positive(),
      title: z.string(),
      coveredWords: z.array(z.string()).default([]),
      coveredConcepts: z.array(z.string()).default([]),
    }),
  ),
});

const generatePlanFlow = getAI().defineFlow(
  {
    name: "generatePlan",
    inputSchema: GeneratePlanInputSchema,
    outputSchema: GeneratedPlanSchema,
  },
  async (input) => {
    const model = await getModelFor("planGen");
    const decoding = await getDecodingFor("planGen");
    const previous = input.previousPlans.length
      ? input.previousPlans
          .map(
            (plan) =>
              `Plan ${plan.planNumber}: ${plan.title}; concepts: ${plan.coveredConcepts.join(", ")}; words: ${plan.coveredWords.join(", ")}`,
          )
          .join("\n")
      : "(none)";
    const vocab = input.entries
      .slice(0, 80)
      .map((entry) => `${entry.id}: ${entry.article ? `${entry.article} ` : ""}${entry.lemma} = ${entry.english}; ${entry.category ?? ""}`)
      .join("\n");

    const { output } = await getAI().generate({
      model,
      output: { schema: GeneratedPlanSchema },
      config: {
        maxOutputTokens: 10000,
        ...decoding,
      },
      system:
        "You design polished Modern Greek textbook modules as strict JSON. Use only the provided widget schema. Keep Greek natural, concise, and appropriate for adult learners.",
      prompt: `Create Plan ${input.planNumber} for this Greek lesson.

Course: ${input.courseTitle}
Course description: ${input.courseDescription ?? ""}
Lesson: ${input.lessonTitle}
Lesson description: ${input.lessonDescription ?? ""}
Requested focus: ${input.customFocus?.trim() || "(choose a useful uncovered angle)"}

Previous plans to avoid repeating:
${previous}

Lesson vocabulary:
${vocab}

Plan requirements:
- Pick one coherent angle: semantic field, shared grammar pattern, phrase family, register, or cultural scene.
- Use 8-20 lesson words when possible, but do not invent vocabulary entries not present above.
- Fill every requested field. The app will convert these fields into textbook widgets.
- The reading must be 3-6 short Greek sentences and use the target vocabulary.
- Every blank sentence must contain "___" exactly once.
- Explanatory text should be in English. Greek target text stays Greek.`,
    });

    if (!output) throw new Error("Plan generation returned no output.");
    return output;
  },
);

function status(message: string) {
  return { at: Timestamp.now(), message, source: "system" };
}

function generationId(kind: string) {
  return `gen_${kind}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function prune<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => prune(item)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      out[k] = prune(v);
    }
    return out as T;
  }
  return value;
}

function buildWidgets(plan: z.infer<typeof GeneratedPlanSchema>) {
  const vocabRows = plan.vocabRows.map((row) => {
    const articleOk =
      row.article && !["n/a", "none", "-"].includes(row.article.trim().toLowerCase());
    const { article: _drop, ...rest } = row;
    return articleOk ? { ...rest, article: row.article } : rest;
  });
  return [
    { id: "w01", type: "heading", level: 1, text: plan.title },
    { id: "w02", type: "prose", markdown: plan.hookMarkdown },
    {
      id: "w03",
      type: "callout",
      calloutKind: "pattern",
      title: plan.patternTitle,
      markdown: plan.patternMarkdown,
    },
    { id: "w04", type: "vocab_table", title: "Key vocabulary", rows: vocabRows },
    {
      id: "w05",
      type: "reading_passage",
      title: "In context",
      el: plan.reading.el,
      en: plan.reading.en,
      glossary: plan.reading.glossary,
    },
    {
      id: "w06",
      type: "fill_in_blanks",
      title: "Try the pattern",
      instructions: "Fill each blank with the best Greek form.",
      items: plan.blanks,
    },
    { id: "w07", type: "mini_quiz", title: "Check yourself", items: plan.quizItems },
    { id: "w08", type: "prose", markdown: plan.wrapUpMarkdown },
  ];
}

async function appendStatus(path: string, message: string) {
  await getFirestore().doc(path).update({
    statusLog: FieldValue.arrayUnion(status(message)),
    updatedAt: Timestamp.now(),
  });
}

export const onPlanWritten = onDocumentWritten(
  {
    document: "courses/{courseId}/lessons/{lessonId}/plans/{planId}",
    secrets: [geminiApiKey],
  },
  async (event) => {
    const after = event.data?.after;
    if (!after?.exists) return;

    const data = after.data();
    if (!data || data.status !== "initializing") return;

    const { courseId, lessonId, planId } = event.params;
    const db = getFirestore();
    const planRef = after.ref;
    const planPath = planRef.path;
    const lessonRef = db.doc(`courses/${courseId}/lessons/${lessonId}`);
    const courseRef = db.doc(`courses/${courseId}`);

    const claimed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(planRef);
      const current = snap.data();
      if (!current || current.status !== "initializing") return false;
      tx.update(planRef, {
        status: "streaming",
        statusLog: FieldValue.arrayUnion(status("Plan generation claimed.")),
        updatedAt: Timestamp.now(),
      });
      return true;
    });
    if (!claimed) return;

    const genId = generationId("plan");
    const genRef = db.doc(`generations/${genId}`);
    const startedAt = Date.now();

    try {
      const [courseSnap, lessonSnap, entrySnap, planSnap] = await Promise.all([
        courseRef.get(),
        lessonRef.get(),
        lessonRef.collection("entries").orderBy("order").get(),
        lessonRef.collection("plans").orderBy("planNumber").get(),
      ]);
      const course = courseSnap.data() ?? {};
      const lesson = lessonSnap.data() ?? {};
      const requestedPlanNumber = Number(data.planNumber ?? 1);
      const modelUsed = await getModelFor("planGen");

      await genRef.set({
        id: genId,
        kind: "plan",
        parentDoc: planPath,
        sourcePrompt: typeof data.customFocus === "string" ? data.customFocus : "",
        trigger: {
          kind: "user_action",
          description: `Plan generation for ${lesson.title ?? lessonId}`,
        },
        status: "streaming",
        statusLog: [status("Plan generation started.")],
        modelUsed,
        manifest: [{ path: planPath, action: "update" }],
        createdAt: Timestamp.now(),
      });

      await appendStatus(planPath, "Reading lesson vocabulary and prior plans.");

      const entries = entrySnap.docs.map((doc) => {
        const entry = doc.data();
        return {
          id: doc.id,
          lemma: String(entry.lemma ?? ""),
          article: typeof entry.article === "string" ? entry.article : undefined,
          english: String(entry.english ?? ""),
          senses: Array.isArray(entry.senses) ? entry.senses.map(String) : [],
          category: typeof entry.category === "string" ? entry.category : undefined,
        };
      }).filter((entry) => entry.lemma && entry.english);

      const previousPlans = planSnap.docs
        .filter((doc) => doc.id !== planId)
        .map((doc) => {
          const plan = doc.data();
          return {
            planNumber: Number(plan.planNumber ?? 1),
            title: String(plan.title ?? `Plan ${plan.planNumber ?? ""}`),
            coveredWords: Array.isArray(plan.coveredWords) ? plan.coveredWords.map(String) : [],
            coveredConcepts: Array.isArray(plan.coveredConcepts) ? plan.coveredConcepts.map(String) : [],
          };
        });

      await appendStatus(planPath, "Asking AI for a new lesson angle.");
      const generated = await generatePlanFlow({
        courseTitle: String(course.title ?? "Greek course"),
        courseDescription: typeof course.description === "string" ? course.description : "",
        lessonTitle: String(lesson.title ?? lessonId),
        lessonDescription: typeof lesson.description === "string" ? lesson.description : "",
        planNumber: requestedPlanNumber,
        customFocus: typeof data.customFocus === "string" ? data.customFocus : "",
        entries,
        previousPlans,
      });
      const widgets = buildWidgets(generated);

      await planRef.update({
        title: generated.title,
        subtitle: generated.subtitle ?? "",
        estimatedMinutes: generated.estimatedMinutes,
        coveredWords: generated.coveredWords,
        coveredConcepts: generated.coveredConcepts,
        widgets: [],
        generationId: genId,
        generationHistory: FieldValue.arrayUnion(genId),
        statusLog: FieldValue.arrayUnion(status("Plan metadata written.")),
        updatedAt: Timestamp.now(),
      });

      for (const [index, widget] of widgets.entries()) {
        const widgetWithId = prune({
          ...widget,
          id: widget.id || `w${String(index + 1).padStart(2, "0")}`,
        });
        await planRef.update({
          widgets: FieldValue.arrayUnion(widgetWithId),
          statusLog: FieldValue.arrayUnion(status(`Added section ${index + 1} of ${widgets.length}.`)),
          updatedAt: Timestamp.now(),
        });
        await genRef.update({
          manifest: FieldValue.arrayUnion({
            path: planPath,
            action: "arrayUnion",
            field: "widgets",
            addedValue: widgetWithId,
          }),
        });
      }

      const plansCount = planSnap.docs.length;
      await Promise.all([
        planRef.update({
          status: "ready",
          statusLog: FieldValue.arrayUnion(status("Plan generation complete.")),
          updatedAt: Timestamp.now(),
        }),
        lessonRef.update({
          "counts.plans": plansCount,
          updatedAt: Timestamp.now(),
        }),
        courseRef.update({
          [`lessonSummaries.${lessonId}.planCount`]: plansCount,
          "counts.plans": FieldValue.increment(data.generationId ? 0 : 1),
          updatedAt: Timestamp.now(),
        }).catch(() => undefined),
        genRef.update({
          status: "done",
          completedAt: Timestamp.now(),
          latencyMs: Date.now() - startedAt,
          statusLog: FieldValue.arrayUnion(status("Plan generation complete.")),
        }),
      ]);
    } catch (err) {
      logger.error("onPlanWritten failed", { courseId, lessonId, planId, err });
      await Promise.all([
        planRef.update({
          status: "error",
          error: err instanceof Error ? err.message : String(err),
          statusLog: FieldValue.arrayUnion(status("Plan generation failed.")),
          updatedAt: Timestamp.now(),
        }),
        genRef.set(
          {
            id: genId,
            kind: "plan",
            parentDoc: planPath,
            status: "error",
            error: err instanceof Error ? err.message : String(err),
            statusLog: FieldValue.arrayUnion(status("Plan generation failed.")),
            manifest: [{ path: planPath, action: "update" }],
            createdAt: Timestamp.now(),
          },
          { merge: true },
        ),
      ]);
    }
  },
);
