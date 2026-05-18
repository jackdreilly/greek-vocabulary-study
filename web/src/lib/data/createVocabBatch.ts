import { doc, serverTimestamp, setDoc, Timestamp } from "firebase/firestore";
import { db } from "../firebase";

export async function createVocabBatch({
  courseId,
  lessonId,
  prompt,
  count = 20,
}: {
  courseId: string;
  lessonId: string;
  prompt: string;
  count?: number;
}) {
  const trimmed = prompt.trim();
  if (!trimmed) throw new Error("Describe the vocabulary to generate.");
  const batchId = `vocab-batch-${Date.now().toString(36)}`;
  await setDoc(doc(db, "courses", courseId, "lessons", lessonId, "vocabBatches", batchId), {
    id: batchId,
    courseId,
    lessonId,
    prompt: trimmed,
    count,
    status: "initializing",
    statusLog: [
      {
        at: Timestamp.now(),
        message: "Vocabulary request received.",
        source: "system",
      },
    ],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return batchId;
}

