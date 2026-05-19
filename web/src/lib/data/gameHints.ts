import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";

export async function getGameHint(courseId: string, lessonId: string, gameId: string): Promise<string[]> {
  const callable = httpsCallable<
    { courseId: string; lessonId: string; gameId: string },
    { hints: string[] }
  >(functions, "getGameHint");
  const result = await callable({ courseId, lessonId, gameId });
  return result.data.hints;
}
