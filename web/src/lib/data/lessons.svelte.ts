/**
 * Reactive subscriptions to a lesson document and its entries.
 */
import { collection, doc, limit, onSnapshot, orderBy, query } from "firebase/firestore";
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
  image?: {
    url: string;
    thumbnail?: string;
    position?: string;
    photographer?: string;
    pexelsUrl?: string;
  } | null;
  audio?: {
    url: string;
    storagePath: string;
  } | null;
  category?: string;
  order: number;
};

export type GameDoc = DocumentData & {
  id: string;
  lessonId: string;
  courseId: string;
  type: string;
  title?: string;
  prompt: string;
  expectedAnswer?: string;
  acceptableAnswers?: string[];
  requiredWords?: string[];
  sourceEntryIds?: string[];
  direction?: string;
  passage?: string;
  question?: string;
  rubric?: string;
  createdAt?: unknown;
};

export type LessonBatchDoc = DocumentData & {
  id: string;
  courseId: string;
  lessonId: string;
  status: "initializing" | "streaming" | "ready" | "done" | "error" | string;
  statusLog?: Array<{ message?: string; source?: string; at?: unknown }>;
  error?: string;
  generationId?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
  completedAt?: { toMillis(): number } | null;
};

export function subscribeLesson(courseId: string, lessonId: string) {
  const state = $state({
    lesson: null as LessonDoc | null,
    loading: true,
    error: null as Error | null,
    stop: () => {},
  });

  const unsubscribe = onSnapshot(
    doc(db, "courses", courseId, "lessons", lessonId),
    (snap) => {
      state.lesson = snap.exists() ? ({ id: snap.id, ...(snap.data() as DocumentData) } as LessonDoc) : null;
      state.loading = false;
    },
    (err) => {
      state.error = err;
      state.loading = false;
    }
  );
  state.stop = unsubscribe;

  return state;
}

export function subscribeEntries(courseId: string, lessonId: string) {
  const state = $state({
    entries: [] as EntryDoc[],
    loading: true,
    error: null as Error | null,
    stop: () => {},
  });

  const q = query(
    collection(db, "courses", courseId, "lessons", lessonId, "entries"),
    orderBy("order")
  );
  const unsubscribe = onSnapshot(
    q,
    (snap) => {
      state.entries = snap.docs.map((d) => ({ id: d.id, ...(d.data() as DocumentData) } as EntryDoc));
      state.loading = false;
    },
    (err) => {
      state.error = err;
      state.loading = false;
    }
  );
  state.stop = unsubscribe;

  return state;
}

export function subscribeGames(courseId: string, lessonId: string) {
  const state = $state({
    games: [] as GameDoc[],
    loading: true,
    error: null as Error | null,
    stop: () => {},
  });

  const q = query(
    collection(db, "courses", courseId, "lessons", lessonId, "games"),
    orderBy("type")
  );
  const unsubscribe = onSnapshot(
    q,
    (snap) => {
      state.games = snap.docs.map((d) => ({ id: d.id, ...(d.data() as DocumentData) } as GameDoc));
      state.loading = false;
    },
    (err) => {
      state.error = err;
      state.loading = false;
    }
  );
  state.stop = unsubscribe;

  return state;
}

function subscribeRecentLessonBatches(courseId: string, lessonId: string, collectionName: string) {
  const state = $state({
    batches: [] as LessonBatchDoc[],
    loading: true,
    error: null as Error | null,
    get latest() {
      return this.batches[0] ?? null;
    },
    stop: () => {},
  });

  const q = query(
    collection(db, "courses", courseId, "lessons", lessonId, collectionName),
    orderBy("createdAt", "desc"),
    limit(5)
  );
  const unsubscribe = onSnapshot(
    q,
    (snap) => {
      state.batches = snap.docs.map((d) => ({ id: d.id, ...(d.data() as DocumentData) } as LessonBatchDoc));
      state.loading = false;
    },
    (err) => {
      state.error = err;
      state.loading = false;
    }
  );
  state.stop = unsubscribe;

  return state;
}

export function subscribeLatestVocabBatches(courseId: string, lessonId: string) {
  return subscribeRecentLessonBatches(courseId, lessonId, "vocabBatches");
}

export function subscribeLatestGameBatches(courseId: string, lessonId: string) {
  return subscribeRecentLessonBatches(courseId, lessonId, "gameBatches");
}
