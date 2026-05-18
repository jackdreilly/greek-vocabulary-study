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
  let lesson = $state<LessonDoc | null>(null);
  let loading = $state(true);
  let error = $state<Error | null>(null);

  const unsubscribe = onSnapshot(
    doc(db, "courses", courseId, "lessons", lessonId),
    (snap) => {
      lesson = snap.exists() ? ({ id: snap.id, ...(snap.data() as DocumentData) } as LessonDoc) : null;
      loading = false;
      error = null;
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
      error = null;
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

export function subscribeGames(courseId: string, lessonId: string) {
  let games = $state<GameDoc[]>([]);
  let loading = $state(true);
  let error = $state<Error | null>(null);

  const q = query(
    collection(db, "courses", courseId, "lessons", lessonId, "games"),
    orderBy("type")
  );
  const unsubscribe = onSnapshot(
    q,
    (snap) => {
      games = snap.docs.map((d) => ({ id: d.id, ...(d.data() as DocumentData) } as GameDoc));
      loading = false;
      error = null;
    },
    (err) => {
      error = err;
      loading = false;
    }
  );

  return {
    get games() {
      return games;
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

function subscribeRecentLessonBatches(courseId: string, lessonId: string, collectionName: string) {
  let batches = $state<LessonBatchDoc[]>([]);
  let loading = $state(true);
  let error = $state<Error | null>(null);

  const q = query(
    collection(db, "courses", courseId, "lessons", lessonId, collectionName),
    orderBy("createdAt", "desc"),
    limit(5)
  );
  const unsubscribe = onSnapshot(
    q,
    (snap) => {
      batches = snap.docs.map((d) => ({ id: d.id, ...(d.data() as DocumentData) } as LessonBatchDoc));
      loading = false;
      error = null;
    },
    (err) => {
      error = err;
      loading = false;
    }
  );

  return {
    get batches() {
      return batches;
    },
    get latest() {
      return batches[0] ?? null;
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

export function subscribeLatestVocabBatches(courseId: string, lessonId: string) {
  return subscribeRecentLessonBatches(courseId, lessonId, "vocabBatches");
}

export function subscribeLatestGameBatches(courseId: string, lessonId: string) {
  return subscribeRecentLessonBatches(courseId, lessonId, "gameBatches");
}
