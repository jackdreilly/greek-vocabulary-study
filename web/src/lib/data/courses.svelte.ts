/**
 * Reactive subscriptions to Firestore courses + course-detail docs.
 * Returns Svelte 5 $state-backed accessors that update as Firestore
 * snapshots arrive.
 */
import { collection, doc, onSnapshot, orderBy, query } from "firebase/firestore";
import type { DocumentData } from "firebase/firestore";
import { db } from "../firebase";

export type CourseDoc = DocumentData & {
  id: string;
  title?: string;
  subtitle?: string;
  description?: string;
  sourcePrompt?: string;
  status?: string;
  statusLog?: Array<{ message: string; source: string; at: unknown }>;
  counts?: { lessons?: number; entries?: number; plans?: number; games?: number };
  lessonSummaries?: Record<
    string,
    {
      title: string;
      subtitle?: string;
      order: number;
      status: string;
      entryCount?: number;
      planCount?: number;
      gameCount?: number;
    }
  >;
};

/** Subscribe to all courses. Returns a reactive list + a stop() function. */
export function subscribeCourses() {
  let courses = $state<CourseDoc[]>([]);
  let loading = $state(true);
  let error = $state<Error | null>(null);

  const q = query(collection(db, "courses"), orderBy("title"));
  const unsubscribe = onSnapshot(
    q,
    (snap) => {
      courses = snap.docs.map((d) => ({ id: d.id, ...(d.data() as DocumentData) }));
      loading = false;
    },
    (err) => {
      error = err;
      loading = false;
    }
  );

  return {
    get courses() {
      return courses;
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

/** Subscribe to a single course document. */
export function subscribeCourse(courseId: string) {
  let course = $state<CourseDoc | null>(null);
  let loading = $state(true);
  let error = $state<Error | null>(null);

  const unsubscribe = onSnapshot(
    doc(db, "courses", courseId),
    (snap) => {
      course = snap.exists() ? ({ id: snap.id, ...(snap.data() as DocumentData) } as CourseDoc) : null;
      loading = false;
    },
    (err) => {
      error = err;
      loading = false;
    }
  );

  return {
    get course() {
      return course;
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
