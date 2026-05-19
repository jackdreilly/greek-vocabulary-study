import { doc, serverTimestamp, setDoc, Timestamp } from "firebase/firestore";
import { db } from "../firebase";
import type { SkillLevel } from "../skillLevel";

export async function createGameBatch({
  courseId,
  lessonId,
  requestedType = "mixed",
  count = 10,
  customFocus,
  skillLevel,
}: {
  courseId: string;
  lessonId: string;
  requestedType?: string;
  count?: number;
  customFocus?: string;
  skillLevel?: SkillLevel;
}) {
  const batchId = `game-batch-${Date.now().toString(36)}`;
  const payload: Record<string, unknown> = {
    id: batchId,
    courseId,
    lessonId,
    requestedType,
    count: Math.max(10, Math.min(30, Math.round(count))),
    status: "initializing",
    statusLog: [
      {
        at: Timestamp.now(),
        message: "Game generation request received.",
        source: "system",
      },
    ],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  if (customFocus && customFocus.trim()) payload.customFocus = customFocus.trim();
  if (skillLevel) payload.skillLevel = skillLevel;
  await setDoc(doc(db, "courses", courseId, "lessons", lessonId, "gameBatches", batchId), payload);
  return batchId;
}
