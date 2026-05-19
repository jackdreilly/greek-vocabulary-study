import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";
import type { GreekCorrection } from "./yiayia";
import type { GameDoc, LessonDoc } from "./lessons.svelte";

export type GameScoreResult = {
  accepted: boolean;
  score: number;
  verdict: "correct" | "almost" | "incorrect";
  feedback: string;
  betterAnswer: string;
  shortReason: string;
  greekCorrection: GreekCorrection | null;
};

export async function scoreGameAnswer({
  lesson,
  game,
  answer,
  courseId,
}: {
  lesson: LessonDoc | null | undefined;
  game: GameDoc;
  answer: string;
  courseId?: string;
}): Promise<GameScoreResult> {
  const callable = httpsCallable(functions, "scoreGameAnswer");
  const result = await callable({
    courseId: courseId ?? String(game.courseId ?? ""),
    lessonId: String(game.lessonId ?? lesson?.id ?? ""),
    lessonTitle: String(lesson?.title ?? game.lessonId ?? "Greek lesson"),
    exercise: {
      id: String(game.id ?? ""),
      type: String(game.type ?? "practice"),
      title: game.title ?? "",
      prompt: String(game.prompt ?? ""),
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
