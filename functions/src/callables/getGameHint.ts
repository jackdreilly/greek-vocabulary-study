import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "genkit";
import { geminiApiKey, getAI } from "../ai/genkitClient.js";
import { getModelFor } from "../ai/configResolver.js";
import { ALLOWED_ORIGINS } from "../cors.js";

const InputSchema = z.object({
  courseId: z.string(),
  lessonId: z.string(),
  gameId: z.string(),
});

const HintsSchema = z.object({
  hints: z.array(z.string()).length(3),
});

const getHintsFlow = getAI().defineFlow(
  { name: "getGameHint", inputSchema: z.any(), outputSchema: HintsSchema },
  async (game: Record<string, unknown>) => {
    const model = await getModelFor("gameScoring");
    const { output } = await getAI().generate({
      model,
      output: { schema: HintsSchema },
      system:
        "You are a helpful Greek language tutor. Generate hints that progressively reveal the answer without giving it away too quickly.",
      prompt: `Generate exactly 3 hints for this Greek learning exercise, from least to most revealing.

Exercise type: ${game.type ?? ""}
Prompt: ${game.prompt ?? ""}
${game.passage ? `Passage: ${game.passage}` : ""}
${game.question ? `Question: ${game.question}` : ""}
Expected answer: ${game.expectedAnswer ?? ""}
${game.requiredWords?.length ? `Target words: ${(game.requiredWords as string[]).join(", ")}` : ""}
${game.rubric ? `Rubric: ${game.rubric}` : ""}

Rules:
- Hint 1: A gentle nudge — mention the general concept or topic without specifics.
- Hint 2: More direct — point toward the answer structure, form, or key word.
- Hint 3: Nearly explicit — almost give it away but make the learner still type it.
- Keep hints in English unless the exercise itself is in Greek.
- Each hint ≤ 30 words.`,
    });
    if (!output) throw new Error("AI returned no hints.");
    return output;
  },
);

export const getGameHint = onCall(
  { cors: ALLOWED_ORIGINS, secrets: [geminiApiKey] },
  async (request) => {
    const parsed = InputSchema.safeParse(request.data);
    if (!parsed.success) throw new HttpsError("invalid-argument", "Missing courseId, lessonId, or gameId.");

    const { courseId, lessonId, gameId } = parsed.data;
    const db = getFirestore();
    const ref = db
      .collection("courses").doc(courseId)
      .collection("lessons").doc(lessonId)
      .collection("games").doc(gameId);

    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError("not-found", "Game not found.");

    const game = snap.data()!;
    if (Array.isArray(game.hints) && game.hints.length === 3) {
      return { hints: game.hints as string[] };
    }

    const result = await getHintsFlow(game);
    await ref.update({ hints: result.hints });
    return result;
  },
);
