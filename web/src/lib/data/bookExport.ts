/**
 * EPUB export jobs. The client writes a pending job into `book_exports`; the
 * `exportBook` Cloud Function builds the book, uploads it to Storage, and
 * writes a `downloadUrl` back. We subscribe until the job completes/fails.
 */
import { addDoc, collection, doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";

export type BookExportScope =
  | { type: "course"; courseId: string }
  | { type: "lesson"; courseId: string; lessonId: string };

export type BookExportJob = {
  id: string;
  scope: "course" | "lesson";
  status: "pending" | "in_progress" | "completed" | "failed";
  downloadUrl?: string;
  fileName?: string;
  error?: string;
};

export async function createBookExportJob(scope: BookExportScope): Promise<string> {
  const payload = {
    ...scope,
    scope: scope.type,
    status: "pending" as const,
    requestedAt: Date.now(),
    downloadUrl: "",
    storagePath: "",
    error: "",
  };
  const ref = await addDoc(collection(db, "book_exports"), payload);
  return ref.id;
}

export function subscribeBookExportJob(
  jobId: string,
  callback: (job: BookExportJob | null) => void,
): () => void {
  return onSnapshot(doc(db, "book_exports", jobId), (snap) => {
    if (!snap.exists()) {
      callback(null);
      return;
    }
    callback({ id: snap.id, ...(snap.data() as Omit<BookExportJob, "id">) });
  });
}

/** Trigger a browser download for a completed export URL. */
export function downloadFile(url: string, fileName: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
