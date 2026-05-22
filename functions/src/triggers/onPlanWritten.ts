import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { z } from "genkit";
import { getAI, geminiApiKey } from "../ai/genkitClient.js";
import { getDecodingFor, getModelFor } from "../ai/configResolver.js";
import { SKILL_LEVEL_LABELS, SkillLevelSchema, type SkillLevel } from "../schemas/common.js";

function skillLevelLine(level: SkillLevel | undefined): string {
  if (!level) return "Skill level: not specified — default to A1-style content.";
  return `Skill level: ${level} — ${SKILL_LEVEL_LABELS[level]}. Calibrate every word, sentence, and explanation to this level; do not introduce content above it.`;
}

// Flat widget schema for generation.
// Rules for Gemini legacyResponseSchema compatibility:
//   - z.string().optional() is fine (cleanSchema converts type:["string","null"] → "string")
//   - z.array().optional() / z.object().optional() generate anyOf which Gemini rejects → use required arrays
//   - z.array(z.array(...)) (2D arrays) not supported → excluded
//   - conjugation_table / comparison_table excluded (nested complexity); keep in Firestore schema only
const GeneratableWidgetSchema = z.object({
  type: z.enum([
    "heading", "markdown", "callout", "vocab_table", "reading_passage",
    "dialogue", "mini_quiz", "fill_in_blanks", "word_tree",
  ]),
  // heading
  level: z.number().int().min(1).max(3).optional(),
  text: z.string().optional(),
  // markdown / callout
  markdown: z.string().optional(),
  title: z.string().optional(),
  calloutKind: z.enum(["pattern", "history", "etymology", "tip", "cultural", "mnemonic"]).optional(),
  // vocab_table
  rows: z.array(z.object({
    el: z.string(),
    en: z.string(),
    article: z.string().optional(),
    example: z.string().optional(),
  })),
  // reading_passage
  el: z.string().optional(),
  en: z.string().optional(),
  glossary: z.array(z.object({ el: z.string(), en: z.string() })),
  // dialogue
  lines: z.array(z.object({ speaker: z.string(), el: z.string(), en: z.string() })),
  // fill_in_blanks / mini_quiz (renamed from "items" to avoid JSON Schema keyword collision)
  instructions: z.string().optional(),
  exerciseItems: z.array(z.object({
    sentence: z.string().optional(),
    answer: z.string(),
    hint: z.string().optional(),
    english: z.string().optional(),
    q: z.string().optional(),
    options: z.array(z.string()),
    correctIndex: z.number().int().nonnegative().optional(),
    explanation: z.string().optional(),
  })),
  // word_tree
  rootEl: z.string().optional(),
  rootEn: z.string().optional(),
  branches: z.array(z.object({ el: z.string(), en: z.string(), relation: z.string() })),
});

const GeneratedPlanSchema = z.object({
  title: z.string(),
  subtitle: z.string().optional(),
  estimatedMinutes: z.number().int().min(1),
  coveredWords: z.array(z.string()).min(3).max(30),
  coveredConcepts: z.array(z.string()).min(2).max(10),
  widgets: z.array(GeneratableWidgetSchema),
});

const GeneratePlanInputSchema = z.object({
  courseTitle: z.string(),
  courseDescription: z.string().optional(),
  courseSourcePrompt: z.string().optional(),
  lessonTitle: z.string(),
  lessonDescription: z.string().optional(),
  lessonSourcePrompt: z.string().optional(),
  skillLevel: SkillLevelSchema.optional(),
  planNumber: z.number().int().min(1),
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
      planNumber: z.number().int().min(1),
      title: z.string(),
      coveredWords: z.array(z.string()).default([]),
      coveredConcepts: z.array(z.string()).default([]),
    }),
  ),
});

type GeneratePlanInput = z.infer<typeof GeneratePlanInputSchema>;

function buildPlanPrompt(input: GeneratePlanInput) {
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
    .map((entry) => `${entry.id}: ${entry.article ? `${entry.article} ` : ""}${entry.lemma} = ${entry.english || entry.senses?.[0] || ""}; ${entry.category ?? ""}`)
    .join("\n");

  return `Create Plan ${input.planNumber} for this Greek lesson.

Original course request:
${input.courseSourcePrompt ?? ""}

Original lesson request:
${input.lessonSourcePrompt ?? ""}

${skillLevelLine(input.skillLevel)}

Course: ${input.courseTitle}
Course overview:
${input.courseDescription ?? ""}

Lesson: ${input.lessonTitle}
Lesson overview:
${input.lessonDescription ?? ""}

Requested plan focus:
${input.customFocus?.trim() || "(choose a useful uncovered angle)"}

Previous plans to avoid repeating:
${previous}

Lesson vocabulary:
${vocab}

OUTPUT: a JSON object with title, subtitle, estimatedMinutes, coveredWords, coveredConcepts, and a "widgets" array.

Widget types you may use (discriminated by "type"):
  heading       — { type, level: 1|2|3, text }
  markdown      — { type, title?, markdown }  ← free-form; use any markdown structure
  callout       — { type, calloutKind: "pattern"|"history"|"etymology"|"tip"|"cultural"|"mnemonic", title?, markdown }
  vocab_table   — { type, title?, rows: [{el, en, article?, example?}] }
  reading_passage — { type, title?, el, en, glossary?: [{el,en}] }
  dialogue      — { type, title?, lines: [{speaker, el, en}] }
  fill_in_blanks — { type, title?, instructions?, exerciseItems: [{sentence (contains ___), answer, hint?, english?}] }
  mini_quiz     — { type, title?, exerciseItems: [{q, options[], correctIndex, answer, explanation?}] }
  word_tree     — { type, root:{el,en}, branches:[{el,en,relation}] }
  conjugation_table — { type, title?, headers[], rows:[{form, cells[]}], interactivePractice? }
  comparison_table  — { type, title?, headers[], rows:[[...]] }

Composition rules:
- THE REQUESTED PLAN FOCUS DRIVES THE SHAPE OF THE PLAN. Read it literally and build exactly what it asks for. The defaults below are only for when the focus is open-ended.
- Treat the original course request, original lesson request, lesson overview, and previous plans as prior chat turns. Build on them rather than starting fresh.
- Default to ~8 widgets when the focus is open-ended. Add more (up to 20) when the focus calls for it. A plan does NOT need to be balanced: if the focus asks for "a bunch of long reading examples" or "just reading practice", it is correct to make the plan mostly (or entirely) reading_passage widgets — several of them, each as long as requested. Likewise honour any other lopsided request (all dialogue, all quizzes, etc.).
- reading_passage text should be as long as the focus implies. When the user wants extended reading, write multiple full paragraphs of natural Greek (separate paragraphs with blank lines) — do not shorten it to a few sentences.
- Always open with a heading (level 1) and close with a markdown or callout wrap-up, unless the focus explicitly wants nothing but the requested content.
- Pick one coherent angle; use lesson words where they fit; do not invent vocabulary.
- If the focus requests a specific count (of examples, passages, questions, etc.), honour it exactly — either as repeated widgets or as items inside a widget, whichever the request implies.
- Every exerciseItems entry must include an answer string. For fill_in_blanks, answer is the exact missing Greek word or phrase that replaces ___. For mini_quiz, answer is the correct option text matching correctIndex.
- Use markdown widgets for free-form content (cultural notes, extended phrase lists, grammar asides) that doesn't map cleanly to a structured widget.
- Explanatory text in English; Greek target text stays Greek.`;
}

const generatePlanFlow = getAI().defineFlow(
  {
    name: "generatePlan",
    inputSchema: GeneratePlanInputSchema,
    outputSchema: GeneratedPlanSchema,
  },
  async (input) => {
    const model = await getModelFor("planGen");
    const decoding = await getDecodingFor("planGen");

    const { output } = await getAI().generate({
      model,
      output: { schema: GeneratedPlanSchema },
      config: {
        maxOutputTokens: 20000,
        ...decoding,
      },
      system:
        "You design polished Modern Greek textbook modules as strict JSON. Compose a widgets array — each widget is a typed object. Keep Greek natural, concise, and appropriate for adult learners.",
      prompt: buildPlanPrompt(input),
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

function persistable(value: unknown) {
  return JSON.parse(JSON.stringify(value));
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
        prompts: {
          originalCourse: typeof course.sourcePrompt === "string" ? course.sourcePrompt : "",
          originalLesson: typeof lesson.sourcePrompt === "string" ? lesson.sourcePrompt : "",
          originalPlan: typeof data.customFocus === "string" ? data.customFocus : "",
        },
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
        const senses: string[] = Array.isArray(entry.senses) ? entry.senses.map(String) : [];
        const english = String(entry.english ?? "") || senses[0] || "";
        return {
          id: doc.id,
          lemma: String(entry.lemma ?? ""),
          article: typeof entry.article === "string" ? entry.article : undefined,
          english,
          senses,
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
      const planLevelParse = SkillLevelSchema.safeParse(data.skillLevel);
      const lessonLevelParse = SkillLevelSchema.safeParse(lesson.skillLevel);
      const courseLevelParse = SkillLevelSchema.safeParse(course.skillLevel);
      const skillLevel: SkillLevel | undefined =
        (planLevelParse.success ? planLevelParse.data : undefined) ??
        (lessonLevelParse.success ? lessonLevelParse.data : undefined) ??
        (courseLevelParse.success ? courseLevelParse.data : undefined);
      const planInput = {
        courseTitle: String(course.title ?? "Greek course"),
        courseDescription: typeof course.description === "string" ? course.description : "",
        courseSourcePrompt: typeof course.sourcePrompt === "string" ? course.sourcePrompt : "",
        lessonTitle: String(lesson.title ?? lessonId),
        lessonDescription: typeof lesson.description === "string" ? lesson.description : "",
        lessonSourcePrompt: typeof lesson.sourcePrompt === "string" ? lesson.sourcePrompt : "",
        skillLevel,
        planNumber: requestedPlanNumber,
        customFocus: typeof data.customFocus === "string" ? data.customFocus : "",
        entries,
        previousPlans,
      };
      await genRef.update({
        "prompts.plan": buildPlanPrompt(planInput),
      });
      const generated = await generatePlanFlow(planInput);
      await genRef.update({
        "stepOutputs.plan": persistable({
          title: generated.title,
          subtitle: generated.subtitle ?? "",
          coveredWords: generated.coveredWords,
          coveredConcepts: generated.coveredConcepts,
          widgetCount: generated.widgets.length,
        }),
      });
      const widgets = generated.widgets.map((w, i) => {
        const { exerciseItems, rootEl, rootEn, ...rest } = w;
        return prune({
          ...rest,
          id: `w${String(i + 1).padStart(2, "0")}`,
          items: exerciseItems,
          ...(rootEl || rootEn ? { root: { el: rootEl ?? "", en: rootEn ?? "" } } : {}),
        });
      });

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
