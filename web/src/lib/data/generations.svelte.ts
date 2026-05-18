/**
 * Reactive subscriptions for the generation lineage admin surface.
 */
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  type DocumentData,
  type QueryConstraint,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../firebase";

export type GenerationManifestEntry = {
  path: string;
  action: "create" | "update" | "arrayUnion";
  field?: string;
  addedValue?: unknown;
  before?: unknown;
};

export type GenerationDoc = DocumentData & {
  id: string;
  kind?: string;
  parentDoc?: string;
  parentGenerationId?: string;
  sourcePrompt?: string;
  status?: string;
  statusLog?: Array<{ at?: unknown; message?: string; source?: string }>;
  modelUsed?: string;
  manifest?: GenerationManifestEntry[];
  createdAt?: unknown;
  completedAt?: unknown;
  revertedAt?: unknown;
  revertedBy?: string;
  trigger?: { kind?: string; description?: string };
  error?: string;
};

export function subscribeRecentGenerations(opts: { kind?: string; status?: string; limitCount?: number } = {}) {
  let generations = $state<GenerationDoc[]>([]);
  let loading = $state(true);
  let error = $state<Error | null>(null);

  const constraints: QueryConstraint[] = [];
  if (opts.kind) constraints.push(where("kind", "==", opts.kind));
  if (opts.status) constraints.push(where("status", "==", opts.status));
  constraints.push(orderBy("createdAt", "desc"));
  constraints.push(limit(opts.limitCount ?? 80));

  const unsubscribe = onSnapshot(
    query(collection(db, "generations"), ...constraints),
    (snap) => {
      generations = snap.docs.map(
        (d) => ({ id: d.id, ...(d.data() as DocumentData) } as GenerationDoc),
      );
      loading = false;
      error = null;
    },
    (err) => {
      error = err;
      loading = false;
    },
  );

  return {
    get generations() {
      return generations;
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

export function subscribeGeneration(generationId: string) {
  let generation = $state<GenerationDoc | null>(null);
  let loading = $state(true);
  let error = $state<Error | null>(null);

  const unsubscribe = onSnapshot(
    doc(db, "generations", generationId),
    (snap) => {
      generation = snap.exists()
        ? ({ id: snap.id, ...(snap.data() as DocumentData) } as GenerationDoc)
        : null;
      loading = false;
      error = null;
    },
    (err) => {
      error = err;
      loading = false;
    },
  );

  return {
    get generation() {
      return generation;
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

export async function revertGeneration(generationId: string) {
  const callable = httpsCallable(functions, "revertGeneration");
  const result = await callable({ generationId, confirm: true, revertedBy: "admin-ui" });
  return result.data as {
    ok: boolean;
    alreadyReverted?: boolean;
    deletes?: number;
    arrayRemoves?: number;
    updates?: number;
    orphans?: number;
  };
}
