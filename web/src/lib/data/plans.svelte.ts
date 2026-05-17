/**
 * Reactive subscriptions to a lesson's plans.
 * Plans live at courses/{cid}/lessons/{lid}/plans/{pid}.
 */
import { collection, doc, onSnapshot, orderBy, query } from "firebase/firestore";
import type { DocumentData } from "firebase/firestore";
import { db } from "../firebase";

export type Widget =
  | { id?: string; type: "heading"; level: 1 | 2 | 3; text: string }
  | { id?: string; type: "prose"; markdown: string }
  | {
      id?: string;
      type: "callout";
      calloutKind: "pattern" | "history" | "etymology" | "tip" | "cultural" | "mnemonic";
      title?: string;
      markdown: string;
    }
  | {
      id?: string;
      type: "vocab_table";
      rows: Array<{ el: string; en: string; example?: string }>;
    }
  | {
      id?: string;
      type: "conjugation_table";
      headers: string[];
      rows: Array<{ form: string; cells: string[] }>;
      interactivePractice?: boolean;
    }
  | { id?: string; type: "comparison_table"; headers: string[]; rows: string[][] }
  | {
      id?: string;
      type: "reading_passage";
      el: string;
      en: string;
      glossary?: Array<{ el: string; en: string }>;
    }
  | {
      id?: string;
      type: "dialogue";
      lines: Array<{ speaker: string; el: string; en: string }>;
    }
  | {
      id?: string;
      type: "mini_quiz";
      items: Array<{ q: string; options: string[]; correctIndex: number; explanation?: string }>;
    }
  | {
      id?: string;
      type: "fill_in_blanks";
      items: Array<{ sentence: string; answer: string; hint?: string }>;
    }
  | {
      id?: string;
      type: "word_tree";
      root: { el: string; en: string };
      branches: Array<{ el: string; en: string; relation: string }>;
    };

export type PlanDoc = DocumentData & {
  id: string;
  lessonId: string;
  courseId: string;
  planNumber: number;
  title: string;
  subtitle?: string;
  estimatedMinutes?: number;
  coveredWords?: string[];
  coveredConcepts?: string[];
  status: string;
  widgets?: Widget[];
};

export function subscribePlans(courseId: string, lessonId: string) {
  let plans = $state<PlanDoc[]>([]);
  let loading = $state(true);
  let error = $state<Error | null>(null);

  const q = query(
    collection(db, "courses", courseId, "lessons", lessonId, "plans"),
    orderBy("planNumber")
  );
  const unsubscribe = onSnapshot(
    q,
    (snap) => {
      plans = snap.docs.map((d) => ({ id: d.id, ...(d.data() as DocumentData) } as PlanDoc));
      loading = false;
    },
    (err) => {
      error = err;
      loading = false;
    }
  );

  return {
    get plans() {
      return plans;
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

export function subscribePlan(courseId: string, lessonId: string, planId: string) {
  let plan = $state<PlanDoc | null>(null);
  let loading = $state(true);
  let error = $state<Error | null>(null);

  const unsubscribe = onSnapshot(
    doc(db, "courses", courseId, "lessons", lessonId, "plans", planId),
    (snap) => {
      plan = snap.exists() ? ({ id: snap.id, ...(snap.data() as DocumentData) } as PlanDoc) : null;
      loading = false;
    },
    (err) => {
      error = err;
      loading = false;
    }
  );

  return {
    get plan() {
      return plan;
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
