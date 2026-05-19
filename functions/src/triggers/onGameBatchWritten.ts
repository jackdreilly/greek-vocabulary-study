import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { z } from "genkit";
import { getAI, geminiApiKey } from "../ai/genkitClient.js";
import { getDecodingFor, getModelFor } from "../ai/configResolver.js";
import { SKILL_LEVEL_LABELS, SkillLevelSchema, type SkillLevel } from "../schemas/common.js";

function skillLevelLine(level: SkillLevel | undefined): string {
  if (!level) return "Skill level: not specified — default to A1-style content.";
  return `Skill level: ${level} — ${SKILL_LEVEL_LABELS[level]}. Calibrate vocabulary, sentence complexity, and expected answers to this level.`;
}

const GameTypeSchema = z.enum([
  "missing_word",
  "reading_comprehension",
  "story_prompt",
  "sentence_translation",
  "word_translation",
]);

const GeneratedGameSchema = z.object({
  type: GameTypeSchema,
  title: z.string(),
  prompt: z.string(),
  expectedAnswer: z.string().optional(),
  acceptableAnswers: z.array(z.string()),
  requiredWords: z.array(z.string()),
  sourceEntryIds: z.array(z.string()),
  direction: z.enum(["el_to_en", "en_to_el"]).optional(),
  passage: z.string().optional(),
  question: z.string().optional(),
  rubric: z.string().optional(),
});

const PreviousGameSchema = z.object({
  type: z.string(),
  prompt: z.string(),
  expectedAnswer: z.string().optional(),
  requiredWords: z.array(z.string()).optional(),
});

const GenerateGameInputSchema = z.object({
  lessonTitle: z.string(),
  lessonDescription: z.string().optional(),
  skillLevel: SkillLevelSchema.optional(),
  customFocus: z.string().optional().default(""),
  requestedType: z.union([GameTypeSchema, z.literal("mixed")]),
  count: z.number().int().min(10).max(30),
  gameNumber: z.number().int().min(1).max(30),
  entries: z.array(
    z.object({
      id: z.string(),
      lemma: z.string(),
      english: z.string(),
      category: z.string().optional(),
    }),
  ),
  previousGames: z.array(PreviousGameSchema),
});

const generateGameFlow = getAI().defineFlow(
  {
    name: "generateGame",
    inputSchema: GenerateGameInputSchema,
    outputSchema: GeneratedGameSchema,
  },
  async (input) => {
    const model = await getModelFor("lessonGen");
    const decoding = await getDecodingFor("lessonGen");
    const vocabulary = input.entries
      .slice(0, 80)
      .map((entry) => `${entry.id}: ${entry.lemma} = ${entry.english}; ${entry.category ?? ""}`)
      .join("\n");
    const previous = input.previousGames.length
      ? input.previousGames
          .slice(-30)
          .map((game) => `${game.type}: ${game.prompt} -> ${game.expectedAnswer ?? ""}; words: ${(game.requiredWords ?? []).join(", ")}`)
          .join("\n")
      : "(none)";

    const { output } = await getAI().generate({
      model,
      output: { schema: GeneratedGameSchema },
      config: {
        maxOutputTokens: 1600,
        ...decoding,
      },
      system:
        "You create compact Modern Greek practice games as strict JSON. Use only the supplied lesson vocabulary as target vocabulary.",
      prompt: `Generate game ${input.gameNumber} of ${input.count} for this lesson. Return exactly one game object.

Lesson: ${input.lessonTitle}
Lesson description: ${input.lessonDescription ?? ""}
${skillLevelLine(input.skillLevel)}
${input.customFocus ? `Focus / theme requested by user: ${input.customFocus}\nMake sure the generated games concretely reflect this focus.` : ""}
Requested type: ${input.requestedType}

Vocabulary:
${vocabulary}

Previously generated games to avoid duplicating:
${previous}

Game type rules:
- word_translation: translate a single lesson word. Include expectedAnswer and acceptableAnswers.
- sentence_translation: translate one natural sentence using lesson words. Include direction and expectedAnswer.
- missing_word: Greek sentence with "___" replacing one lesson word. expectedAnswer is the missing Greek word.
- reading_comprehension: short Greek passage plus one question. Include rubric and a concise expectedAnswer.
- story_prompt: ask learner to write 2-3 Greek sentences using requiredWords. Include rubric.

Keep prompts short. For mixed batches, choose a type that adds variety against the previous games.
Every game must include acceptableAnswers, requiredWords, and sourceEntryIds arrays. Use [] only when a field is not relevant or no source entry is available.`,
    });

    if (!output) throw new Error("Game generation returned no output.");
    return output;
  },
);

function status(message: string) {
  return { at: Timestamp.now(), message, source: "system" };
}

function generationId(kind: string) {
  return `gen_${kind}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function slug(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

export const onGameBatchWritten = onDocumentWritten(
  {
    document: "courses/{courseId}/lessons/{lessonId}/gameBatches/{batchId}",
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
        statusLog: FieldValue.arrayUnion(status("Game generation claimed.")),
        updatedAt: Timestamp.now(),
      });
      return true;
    });
    if (!claimed) return;

    const genId = generationId("game_batch");
    const genRef = db.doc(`generations/${genId}`);
    const startedAt = Date.now();

    try {
      const [lessonSnap, entrySnap, gameSnap] = await Promise.all([
        lessonRef.get(),
        lessonRef.collection("entries").orderBy("order").get(),
        lessonRef.collection("games").get(),
      ]);
      const lesson = lessonSnap.data() ?? {};
      const requestedType = data.requestedType === "all" ? "mixed" : String(data.requestedType ?? "mixed");
      const count = Math.max(10, Math.min(30, Number(data.count ?? 10)));
      const customFocus = typeof data.customFocus === "string" ? data.customFocus : "";
      const modelUsed = await getModelFor("lessonGen");

      await genRef.set({
        id: genId,
        kind: "game_batch",
        parentDoc: batchRef.path,
        sourcePrompt: requestedType,
        trigger: {
          kind: "user_action",
          description: `Game batch for ${lesson.title ?? lessonId}`,
        },
        status: "streaming",
        statusLog: [status("Game batch generation started.")],
        modelUsed,
        manifest: [],
        createdAt: Timestamp.now(),
      });

      await batchRef.update({
        statusLog: FieldValue.arrayUnion(status("Reading vocabulary and prior games.")),
        generationId: genId,
        updatedAt: Timestamp.now(),
      });

      const entries = entrySnap.docs
        .map((doc) => {
          const entry = doc.data();
          const senses: string[] = Array.isArray(entry.senses) ? entry.senses.map(String) : [];
          return {
            id: doc.id,
            lemma: String(entry.lemma ?? ""),
            english: String(entry.english ?? "") || senses[0] || "",
            senses,
            category: typeof entry.category === "string" ? entry.category : undefined,
          };
        })
        .filter((entry) => entry.lemma && entry.english);

      const previousGames = gameSnap.docs.map((doc) => {
        const game = doc.data();
        return {
          type: String(game.type ?? ""),
          prompt: String(game.prompt ?? ""),
          expectedAnswer: typeof game.expectedAnswer === "string" ? game.expectedAnswer : undefined,
          requiredWords: Array.isArray(game.requiredWords) ? game.requiredWords.map(String) : [],
        };
      });

      const courseSnap = await courseRef.get();
      const courseData = courseSnap.data() ?? {};
      const batchLevelParse = SkillLevelSchema.safeParse(data.skillLevel);
      const lessonLevelParse = SkillLevelSchema.safeParse(lesson.skillLevel);
      const courseLevelParse = SkillLevelSchema.safeParse(courseData.skillLevel);
      const skillLevel: SkillLevel | undefined =
        (batchLevelParse.success ? batchLevelParse.data : undefined) ??
        (lessonLevelParse.success ? lessonLevelParse.data : undefined) ??
        (courseLevelParse.success ? courseLevelParse.data : undefined);

      const createdGameIds: string[] = [];
      const generatedForPrompt = [...previousGames];
      const normalizedRequestedType = GameTypeSchema.safeParse(requestedType).success
        ? requestedType as z.infer<typeof GameTypeSchema>
        : "mixed";

      for (let index = 0; index < count; index += 1) {
        await batchRef.update({
          statusLog: FieldValue.arrayUnion(status(`Asking AI for game ${index + 1} of ${count}.`)),
          updatedAt: Timestamp.now(),
        });

        const game = await generateGameFlow({
          lessonTitle: String(lesson.title ?? lessonId),
          lessonDescription: typeof lesson.description === "string" ? lesson.description : "",
          skillLevel,
          customFocus,
          requestedType: normalizedRequestedType,
          count,
          gameNumber: index + 1,
          entries,
          previousGames: generatedForPrompt,
        });

        const gameId = `${batchId}-${String(index + 1).padStart(2, "0")}-${slug(game.type) || "game"}`;
        const gameRef = lessonRef.collection("games").doc(gameId);
        const manifestEntry = { path: gameRef.path, action: "create" as const };
        createdGameIds.push(gameId);

        await gameRef.set(compact({
          id: gameId,
          courseId,
          lessonId,
          ...game,
          acceptableAnswers: game.acceptableAnswers ?? [],
          requiredWords: game.requiredWords ?? [],
          sourceEntryIds: game.sourceEntryIds ?? [],
          generationId: genId,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        }));

        generatedForPrompt.push({
          type: game.type,
          prompt: game.prompt,
          expectedAnswer: game.expectedAnswer,
          requiredWords: game.requiredWords,
        });

        await Promise.all([
          batchRef.update({
            createdGameIds: FieldValue.arrayUnion(gameId),
            statusLog: FieldValue.arrayUnion(status(`Generated game ${index + 1} of ${count}.`)),
            updatedAt: Timestamp.now(),
          }),
          genRef.update({
            manifest: FieldValue.arrayUnion(manifestEntry),
            statusLog: FieldValue.arrayUnion(status(`Generated game ${index + 1} of ${count}.`)),
          }),
        ]);
      }

      const nextGameCount = gameSnap.docs.length + createdGameIds.length;
      await Promise.all([
        batchRef.update({
          status: "ready",
          createdGameIds,
          statusLog: FieldValue.arrayUnion(status(`Generated ${createdGameIds.length} games.`)),
          updatedAt: Timestamp.now(),
        }),
        lessonRef.update({
          "counts.games": nextGameCount,
          updatedAt: Timestamp.now(),
        }),
        courseRef.update({
          [`lessonSummaries.${lessonId}.gameCount`]: nextGameCount,
          "counts.games": FieldValue.increment(createdGameIds.length),
          updatedAt: Timestamp.now(),
        }),
        genRef.update({
          status: "done",
          completedAt: Timestamp.now(),
          latencyMs: Date.now() - startedAt,
          statusLog: FieldValue.arrayUnion(status("Game batch generation complete.")),
        }),
      ]);
    } catch (err) {
      logger.error("onGameBatchWritten failed", { courseId, lessonId, batchId, err });
      await Promise.all([
        batchRef.update({
          status: "error",
          error: err instanceof Error ? err.message : String(err),
          statusLog: FieldValue.arrayUnion(status("Game generation failed.")),
          updatedAt: Timestamp.now(),
        }),
        genRef.set(
          {
            id: genId,
            kind: "game_batch",
            parentDoc: batchRef.path,
            status: "error",
            error: err instanceof Error ? err.message : String(err),
            statusLog: FieldValue.arrayUnion(status("Game generation failed.")),
            createdAt: Timestamp.now(),
          },
          { merge: true },
        ),
      ]);
    }
  },
);
