import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { z } from "genkit";
import { getDecodingFor, getModelFor } from "../ai/configResolver.js";
import { geminiApiKey, getAI } from "../ai/genkitClient.js";

type DebugEntry = {
  id: string;
  article?: string;
  lemma: string;
  english: string;
  senses: string[];
  category: string;
};

type DebugLesson = {
  id: string;
  order: number;
  title: string;
  subtitle: string;
  description: string;
  entries: DebugEntry[];
};

const CourseOutlineSchema = z.object({
  title: z.string(),
  subtitle: z.string().optional(),
  description: z.string(),
  lessons: z.array(
    z.object({
      id: z.string().optional(),
      title: z.string(),
      subtitle: z.string().optional(),
      description: z.string(),
      sourcePrompt: z.string(),
      targetEntryCount: z.number().int().min(12).max(60).optional(),
    }),
  ).min(2).max(8),
});

const generateCourseFlow = getAI().defineFlow(
  {
    name: "generateCourseOutline",
    inputSchema: z.object({ sourcePrompt: z.string() }),
    outputSchema: CourseOutlineSchema,
  },
  async ({ sourcePrompt }) => {
    const model = await getModelFor("courseGen");
    const decoding = await getDecodingFor("courseGen");
    const { output } = await getAI().generate({
      model,
      output: { schema: CourseOutlineSchema },
      config: {
        maxOutputTokens: 5000,
        ...decoding,
      },
      system:
        "You are a Modern Greek curriculum designer. Create concise course outlines as strict JSON. Lessons should be specific, practical, and vocabulary-rich.",
      prompt: `Design a Modern Greek vocabulary course from this request:
${sourcePrompt}

Return:
- a clear course title, subtitle, and 250-450 word markdown description
- 3-6 lessons ordered from easier/foundational to richer/contextual
- each lesson needs a focused sourcePrompt that can independently generate vocabulary
- each lesson targetEntryCount should usually be 24-36

Do not include admin notes or implementation details.`,
    });
    if (!output) throw new Error("Course generation returned no output.");
    return output;
  },
);

const DEBUG_LESSONS: DebugLesson[] = [
  {
    id: "debug-market",
    order: 1,
    title: "Market Debugging",
    subtitle: "Food, prices, and polite requests.",
    description:
      "A compact generated lesson for testing vocabulary cards, plan widgets, and short-answer games with everyday market Greek.",
    entries: [
      { id: "e01", article: "η", lemma: "ντομάτα", english: "tomato", senses: ["tomato"], category: "noun_feminine" },
      { id: "e02", article: "το", lemma: "καλάθι", english: "basket", senses: ["basket"], category: "noun_neuter" },
      { id: "e03", article: "ο", lemma: "πάγκος", english: "stall; counter", senses: ["market stall", "counter"], category: "noun_masculine" },
      { id: "e04", lemma: "πόσο κάνει;", english: "how much is it?", senses: ["what does it cost?"], category: "phrase" },
      { id: "e05", lemma: "θα ήθελα", english: "I would like", senses: ["I would want"], category: "phrase" },
      { id: "e06", article: "το", lemma: "κιλό", english: "kilo", senses: ["kilogram"], category: "noun_neuter" },
    ],
  },
  {
    id: "debug-ferry",
    order: 2,
    title: "Ferry Debugging",
    subtitle: "Tickets, decks, and island timing.",
    description:
      "A compact generated lesson for testing transport vocabulary, readings, and generated practice games.",
    entries: [
      { id: "e01", article: "το", lemma: "εισιτήριο", english: "ticket", senses: ["ticket"], category: "noun_neuter" },
      { id: "e02", article: "το", lemma: "λιμάνι", english: "port", senses: ["harbor"], category: "noun_neuter" },
      { id: "e03", article: "το", lemma: "κατάστρωμα", english: "deck", senses: ["ship deck"], category: "noun_neuter" },
      { id: "e04", article: "η", lemma: "αναχώρηση", english: "departure", senses: ["departure"], category: "noun_feminine" },
      { id: "e05", article: "η", lemma: "καθυστέρηση", english: "delay", senses: ["delay"], category: "noun_feminine" },
      { id: "e06", lemma: "με επιστροφή", english: "round-trip", senses: ["with return"], category: "phrase" },
    ],
  },
];

function logEntry(message: string) {
  return { at: Timestamp.now(), message, source: "system" };
}

async function appendStatus(path: string, message: string) {
  await getFirestore().doc(path).update({
    statusLog: FieldValue.arrayUnion(logEntry(message)),
    updatedAt: Timestamp.now(),
  });
}

function isDebugPrompt(prompt: string) {
  return /\b(debug|test|testing)\b/i.test(prompt);
}

function slug(input: string, fallback: string) {
  const value = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return value || fallback;
}

function lessonSummary(lesson: DebugLesson) {
  return {
    title: lesson.title,
    subtitle: lesson.subtitle,
    order: lesson.order,
    status: "ready",
    entryCount: lesson.entries.length,
    planCount: 1,
    gameCount: 3,
  };
}

function planWidgets(lesson: DebugLesson) {
  const [first, second, third] = lesson.entries;
  return [
    { id: "w01", type: "heading", level: 1, text: `${lesson.title}: generated test plan` },
    {
      id: "w02",
      type: "prose",
      markdown: `This plan was generated by the real course endpoint. It uses **${first.lemma}**, **${second.lemma}**, and **${third.lemma}** as deterministic test material.`,
    },
    {
      id: "w03",
      type: "vocab_table",
      rows: lesson.entries.slice(0, 5).map((entry) => ({
        el: entry.lemma,
        en: entry.english,
        example: `Debug example: ${entry.lemma}.`,
      })),
    },
    {
      id: "w04",
      type: "mini_quiz",
      items: [
        {
          q: `What does "${first.lemma}" mean?`,
          options: [first.english, second.english, third.english],
          correctIndex: 0,
          explanation: "This deterministic quiz item proves the plan renderer and interaction path.",
        },
      ],
    },
  ];
}

function gameDocs(courseId: string, lesson: DebugLesson, generationId: string) {
  const [first, second, third] = lesson.entries;
  const createdAt = Timestamp.now();
  return [
    {
      id: "debug-word-translation",
      type: "word_translation",
      title: "Translate the generated word",
      prompt: `Translate: ${first.lemma}`,
      expectedAnswer: first.english,
      acceptableAnswers: [first.english],
      requiredWords: [first.lemma],
      sourceEntryIds: [first.id],
      direction: "el_to_en",
    },
    {
      id: "debug-sentence-translation",
      type: "sentence_translation",
      title: "Translate the generated sentence",
      prompt:
        lesson.id === "debug-market"
          ? "Translate: Θα ήθελα ένα κιλό ντομάτες."
          : "Translate: Το πλοίο έχει καθυστέρηση.",
      expectedAnswer:
        lesson.id === "debug-market"
          ? "I would like a kilo of tomatoes."
          : "The ship is delayed.",
      acceptableAnswers: [],
      requiredWords: [second.lemma, third.lemma],
      sourceEntryIds: [second.id, third.id],
      direction: "el_to_en",
    },
    {
      id: "debug-reading",
      type: "reading_comprehension",
      title: "Read the generated passage",
      passage:
        lesson.id === "debug-market"
          ? "Στον πάγκο, η Μαρία αγοράζει ντομάτες και ζητάει απόδειξη."
          : "Στο λιμάνι, ο Νίκος κοιτάζει το εισιτήριο και περιμένει την αναχώρηση.",
      question: "What is happening?",
      prompt: "Answer in English.",
      rubric: "Accept answers that identify the main action in the passage.",
      sourceEntryIds: [first.id, second.id, third.id],
    },
  ].map((game) => ({
    ...game,
    lessonId: lesson.id,
    courseId,
    generationId,
    createdAt,
  }));
}

async function generateDebugCourse(courseId: string, sourcePrompt: string, eventId: string) {
  const db = getFirestore();
  const coursePath = `courses/${courseId}`;
  const courseRef = db.doc(coursePath);
  const generationId = `gen_debug_course_${courseId}_${Date.now().toString(36)}`;
  const modelUsed = await getModelFor("courseGen");
  const now = Timestamp.now();
  const manifest: Array<{ path: string; action: "create" | "update" }> = [
    { path: coursePath, action: "update" },
  ];

  await db.doc(`generations/${generationId}`).set({
    id: generationId,
    kind: "course",
    parentDoc: coursePath,
    sourcePrompt,
    trigger: {
      kind: "user_action",
      description: `Debug course generation: "${sourcePrompt.slice(0, 80)}"`,
    },
    status: "streaming",
    statusLog: [logEntry("Debug generation started.")],
    modelUsed,
    manifest: [],
    createdAt: now,
  });

  await appendStatus(coursePath, "Drafting debug course metadata.");

  const lessonSummaries = Object.fromEntries(DEBUG_LESSONS.map((lesson) => [lesson.id, lessonSummary(lesson)]));
  const batch = db.batch();

  batch.update(courseRef, {
    title: "Debug Generation Lab",
    subtitle: "Generated through the real course endpoint.",
    description:
      "This course was created by the public Generate flow and filled by `onCourseWritten`. The content is deterministic so the endpoint can be tested without relying on AI credentials.",
    status: "ready",
    statusLog: FieldValue.arrayUnion(logEntry("Debug course generation completed.")),
    generationId,
    generationHistory: FieldValue.arrayUnion(generationId),
    handledEventIds: FieldValue.arrayUnion(eventId),
    lessonSummaries,
    counts: {
      lessons: DEBUG_LESSONS.length,
      entries: DEBUG_LESSONS.reduce((sum, lesson) => sum + lesson.entries.length, 0),
      plans: DEBUG_LESSONS.length,
      games: DEBUG_LESSONS.length * 3,
    },
    updatedAt: Timestamp.now(),
  });

  for (const lesson of DEBUG_LESSONS) {
    const lessonPath = `${coursePath}/lessons/${lesson.id}`;
    manifest.push({ path: lessonPath, action: "create" });
    batch.set(db.doc(lessonPath), {
      id: lesson.id,
      courseId,
      title: lesson.title,
      subtitle: lesson.subtitle,
      description: lesson.description,
      order: lesson.order,
      status: "ready",
      statusLog: [logEntry("Debug lesson generated.")],
      overview: {
        generationId,
        widgets: [
          { id: "overview-heading", type: "heading", level: 1, text: lesson.title },
          { id: "overview-prose", type: "prose", markdown: lesson.description },
        ],
      },
      generationId,
      generationHistory: [generationId],
      counts: { entries: lesson.entries.length, plans: 1, games: 3 },
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });

    lesson.entries.forEach((entry, index) => {
      const entryPath = `${lessonPath}/entries/${entry.id}`;
      manifest.push({ path: entryPath, action: "create" });
      batch.set(db.doc(entryPath), {
        ...entry,
        lessonId: lesson.id,
        courseId,
        order: index + 1,
        examples: [{ el: `Debug: ${entry.lemma}.`, en: `Debug: ${entry.english}.` }],
        generationId,
        createdAt: Timestamp.now(),
      });
    });

    const planPath = `${lessonPath}/plans/${lesson.id}-plan-1`;
    manifest.push({ path: planPath, action: "create" });
    batch.set(db.doc(planPath), {
      id: `${lesson.id}-plan-1`,
      lessonId: lesson.id,
      courseId,
      planNumber: 1,
      title: `${lesson.title}: Debug Plan`,
      subtitle: "A deterministic plan generated by the course trigger.",
      estimatedMinutes: 8,
      coveredWords: lesson.entries.slice(0, 5).map((entry) => entry.lemma),
      coveredConcepts: ["debugging", "endpoint testing", "reactive rendering"],
      status: "ready",
      statusLog: [logEntry("Debug plan generated.")],
      widgets: planWidgets(lesson),
      generationId,
      generationHistory: [generationId],
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });

    for (const game of gameDocs(courseId, lesson, generationId)) {
      const gamePath = `${lessonPath}/games/${game.id}`;
      manifest.push({ path: gamePath, action: "create" });
      batch.set(db.doc(gamePath), game);
    }
  }

  batch.update(db.doc(`generations/${generationId}`), {
    status: "done",
    statusLog: FieldValue.arrayUnion(logEntry("Debug generation completed.")),
    manifest,
    completedAt: Timestamp.now(),
  });

  await batch.commit();
}

async function generateAICourse(courseId: string, sourcePrompt: string, eventId: string) {
  const db = getFirestore();
  const coursePath = `courses/${courseId}`;
  const courseRef = db.doc(coursePath);
  const generationId = `gen_course_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();
  const modelUsed = await getModelFor("courseGen");

  await db.doc(`generations/${generationId}`).set({
    id: generationId,
    kind: "course",
    parentDoc: coursePath,
    sourcePrompt,
    trigger: {
      kind: "user_action",
      description: `Course generation: "${sourcePrompt.slice(0, 80)}"`,
    },
    status: "streaming",
    statusLog: [logEntry("Course generation started.")],
    modelUsed,
    manifest: [{ path: coursePath, action: "update" }],
    createdAt: Timestamp.now(),
  });

  await appendStatus(coursePath, "Designing course outline.");
  const outline = await generateCourseFlow({ sourcePrompt });
  await appendStatus(coursePath, "Writing lesson stubs.");

  const lessonSummaries: Record<string, unknown> = {};
  const batch = db.batch();
  const manifest: Array<{ path: string; action: "create" | "update" }> = [{ path: coursePath, action: "update" }];

  outline.lessons.forEach((lesson, index) => {
    const id = slug(lesson.id || lesson.title, `lesson-${index + 1}`);
    const lessonPath = `${coursePath}/lessons/${id}`;
    manifest.push({ path: lessonPath, action: "create" });
    lessonSummaries[id] = {
      title: lesson.title,
      subtitle: lesson.subtitle ?? "",
      order: index + 1,
      status: "initializing",
      entryCount: 0,
      planCount: 0,
      gameCount: 0,
    };
    batch.set(db.doc(lessonPath), {
      id,
      courseId,
      title: lesson.title,
      subtitle: lesson.subtitle ?? "",
      description: lesson.description,
      sourcePrompt: lesson.sourcePrompt,
      targetEntryCount: lesson.targetEntryCount,
      order: index + 1,
      status: "initializing",
      statusLog: [logEntry("Lesson request received from course generation.")],
      parentGenerationId: generationId,
      counts: { entries: 0, plans: 0, games: 0 },
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
  });

  batch.update(courseRef, {
    title: outline.title,
    subtitle: outline.subtitle ?? "",
    description: outline.description,
    status: "ready",
    statusLog: FieldValue.arrayUnion(logEntry("Course outline complete. Lesson vocabulary is generating.")),
    generationId,
    generationHistory: FieldValue.arrayUnion(generationId),
    handledEventIds: FieldValue.arrayUnion(eventId),
    lessonSummaries,
    counts: { lessons: outline.lessons.length, entries: 0, plans: 0, games: 0 },
    updatedAt: Timestamp.now(),
  });
  batch.update(db.doc(`generations/${generationId}`), {
    status: "done",
    manifest,
    completedAt: Timestamp.now(),
    latencyMs: Date.now() - startedAt,
    statusLog: FieldValue.arrayUnion(logEntry("Course outline generation complete.")),
  });

  await batch.commit();
}

export const onCourseWritten = onDocumentWritten({ document: "courses/{courseId}", secrets: [geminiApiKey] }, async (event) => {
  const after = event.data?.after;
  if (!after?.exists) return;

  const data = after.data();
  if (!data) return;
  const courseId = event.params.courseId;
  const sourcePrompt = String(data.sourcePrompt ?? "");
  const eventId = event.id;
  const courseRef = after.ref;

  if (data.status !== "initializing") return;
  if (Array.isArray(data.handledEventIds) && data.handledEventIds.includes(eventId)) return;

  const claimed = await getFirestore().runTransaction(async (tx) => {
    const snap = await tx.get(courseRef);
    const current = snap.data();
    if (!current || current.status !== "initializing") return false;
    tx.update(courseRef, {
      status: "streaming",
      statusLog: FieldValue.arrayUnion(logEntry("Course generation claimed.")),
      updatedAt: Timestamp.now(),
    });
    return true;
  });

  if (!claimed) return;

  try {
    if (isDebugPrompt(sourcePrompt)) {
      await generateDebugCourse(courseId, sourcePrompt, eventId);
      return;
    }

    await generateAICourse(courseId, sourcePrompt, eventId);
  } catch (err) {
    logger.error("onCourseWritten failed", err);
    await courseRef.update({
      status: "error",
      error: err instanceof Error ? err.message : String(err),
      statusLog: FieldValue.arrayUnion(logEntry("Course generation failed.")),
      handledEventIds: FieldValue.arrayUnion(eventId),
      updatedAt: Timestamp.now(),
    });
  }
});
