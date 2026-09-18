import { doc, serverTimestamp, setDoc, Timestamp } from "firebase/firestore";
import { db } from "../firebase";

export async function createUsageGeneration({
  courseId,
  lessonId,
  entryId,
}: {
  courseId: string;
  lessonId: string;
  entryId: string;
}) {
  await setDoc(
    doc(
      db,
      "courses",
      courseId,
      "lessons",
      lessonId,
      "entries",
      entryId,
      "usageGenerations",
      "current",
    ),
    {
      id: "current",
      courseId,
      lessonId,
      entryId,
      status: "initializing",
      statusLog: [{ at: Timestamp.now(), message: "Sentence usage request received.", source: "system" }],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}
