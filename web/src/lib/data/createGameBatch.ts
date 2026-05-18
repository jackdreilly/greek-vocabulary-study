import { doc, serverTimestamp, setDoc, Timestamp } from "firebase/firestore";
import { db } from "../firebase";

export async function createGameBatch({
  courseId,
  lessonId,
  requestedType = "mixed",
  count = 5,
}: {
  courseId: string;
  lessonId: string;
  requestedType?: string;
  count?: number;
}) {
  const batchId = `game-batch-${Date.now().toString(36)}`;
  await setDoc(doc(db, "courses", courseId, "lessons", lessonId, "gameBatches", batchId), {
    id: batchId,
    courseId,
    lessonId,
    requestedType,
    count,
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
  });
  return batchId;
}
