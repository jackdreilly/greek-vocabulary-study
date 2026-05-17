/**
 * Reactive subscriptions to a lesson document and its entries.
 */
import { collection, doc, onSnapshot, orderBy, query } from "firebase/firestore";
import type { DocumentData } from "firebase/firestore";
import { db } from "../firebase";

export type LessonDoc = DocumentData & {
  id: string;
  courseId: string;
  title: string;
  subtitle?: string;
  description?: string;
  order: number;
  status: string;
  counts?: { entries?: number; plans?: number; games?: number };
};

export type EntryDoc = DocumentData & {
  id: string;
  lessonId: string;
  courseId: string;
  lemma: string;
  article?: string;
  english: string;
  senses?: string[];
  category?: string;
  order: number;
};

export function subscribeLesson(courseId: string, lessonId: string) {
  let lesson = $state<LessonDoc | null>(null);
  let loading = $state(true);
  let error = $state<Error | null>(null);

  const unsubscribe = onSnapshot(
    doc(db, "courses", courseId, "lessons", lessonId),
    (snap) => {
      lesson = snap.exists() ? ({ id: snap.id, ...(snap.data() as DocumentData) } as LessonDoc) : null;
      loading = false;
    },
    (err) => {
      error = err;
      loading = false;
    }
  );

  return {
    get lesson() {
      return lesson;
    },
    get loading() {
      return loading;
    },
    get error() {
      return error;
    },
    stop: unsubscribe,
  };
}

export function subscribeEntries(courseId: string, lessonId: string) {
  let entries = $state<EntryDoc[]>([]);
  let loading = $state(true);
  let error = $state<Error | null>(null);

  const q = query(
    collection(db, "courses", courseId, "lessons", lessonId, "entries"),
    orderBy("order")
  );
  const unsubscribe = onSnapshot(
    q,
    (snap) => {
      entries = snap.docs.map((d) => ({ id: d.id, ...(d.data() as DocumentData) } as EntryDoc));
      loading = false;
    },
    (err) => {
      error = err;
      loading = false;
    }
  );

  return {
    get entries() {
      return entries;
    },
    get loading() {
      return loading;
    },
    get error() {
      return error;
    },
    stop: unsubscribe,
  };
}
