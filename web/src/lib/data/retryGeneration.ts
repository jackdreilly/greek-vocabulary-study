import { arrayUnion, doc, serverTimestamp, Timestamp, updateDoc } from "firebase/firestore";
import { db } from "../firebase";

function retryPayload(message: string) {
  return {
    status: "initializing",
    error: null,
    statusLog: arrayUnion({
      at: Timestamp.now(),
      message,
      source: "user",
    }),
    updatedAt: serverTimestamp(),
  };
}

export async function retryCourseGeneration(courseId: string) {
  await updateDoc(doc(db, "courses", courseId), retryPayload("Retry requested."));
}

export async function retryLessonGeneration(courseId: string, lessonId: string) {
  await updateDoc(doc(db, "courses", courseId, "lessons", lessonId), retryPayload("Retry requested."));
}

export async function retryPlanGeneration(courseId: string, lessonId: string, planId: string) {
  await updateDoc(
    doc(db, "courses", courseId, "lessons", lessonId, "plans", planId),
    retryPayload("Retry requested.")
  );
}

export async function retryVocabBatchGeneration(courseId: string, lessonId: string, batchId: string) {
  await updateDoc(
    doc(db, "courses", courseId, "lessons", lessonId, "vocabBatches", batchId),
    retryPayload("Retry requested.")
  );
}

export async function retryGameBatchGeneration(courseId: string, lessonId: string, batchId: string) {
  await updateDoc(
    doc(db, "courses", courseId, "lessons", lessonId, "gameBatches", batchId),
    retryPayload("Retry requested.")
  );
}
