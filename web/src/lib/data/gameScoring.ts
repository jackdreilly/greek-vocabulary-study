import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";
import type { GameDoc, LessonDoc } from "./lessons.svelte";

export type GameScoreResult = {
  accepted: boolean;
  score: number;
  verdict: "correct" | "almost" | "incorrect";
  feedback: string;
  betterAnswer: string;
  shortReason: string;
  greekCorrection: null | {
    correctedText: string;
    tips: Array<{
      type: "spelling" | "grammar" | "accent" | "vocabulary" | "word_order";
      original: string;
      corrected: string;
      explanation: string;
    }>;
  };
};

export async function scoreGameAnswer({
  lesson,
  game,
  answer,
}: {
  lesson: LessonDoc | null | undefined;
  game: GameDoc;
  answer: string;
}): Promise<GameScoreResult> {
  const callable = httpsCallable(functions, "scoreGameAnswer");
  const result = await callable({
    lessonId: String(game.lessonId ?? lesson?.id ?? ""),
    lessonTitle: String(lesson?.title ?? game.lessonId ?? "Greek lesson"),
    exercise: {
      id: game.id,
      type: game.type,
      title: game.title ?? "",
      prompt: game.prompt,
      expectedAnswer: game.expectedAnswer ?? "",
      acceptableAnswers: game.acceptableAnswers ?? [],
      requiredWords: game.requiredWords ?? [],
      sourceEntryIds: game.sourceEntryIds ?? [],
      direction: game.direction ?? "",
      passage: game.passage ?? "",
      question: game.question ?? "",
      rubric: game.rubric ?? "",
    },
    answer,
    preferences: { responseLanguage: "english", cefrLevel: "A2" },
  });
  return result.data as GameScoreResult;
}
