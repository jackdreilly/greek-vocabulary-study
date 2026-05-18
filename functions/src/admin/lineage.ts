/**
 * Generation lineage helpers for the admin chat.
 *
 * Every admin chat edit opens a `generations/{id}` doc with kind `yiayia_edit`
 * and records each Firestore mutation in its manifest. The doc can then be
 * reverted via the existing `revertGeneration` callable.
 */
import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";

type ManifestAction = "create" | "update" | "arrayUnion";

export type ManifestEntry = {
  path: string;
  action: ManifestAction;
  field?: string;
  before?: unknown;
  addedValue?: unknown;
};

export function newGenerationId(prefix = "yiayia"): string {
  return `gen_${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export class LineageRecorder {
  readonly id: string;
  readonly description: string;
  private startedAt: number;
  private manifest: ManifestEntry[] = [];
  private opened = false;

  constructor(description: string, idPrefix = "yiayia") {
    this.id = newGenerationId(idPrefix);
    this.description = description;
    this.startedAt = Date.now();
  }

  private async ensureOpen() {
    if (this.opened) return;
    this.opened = true;
    await getFirestore().doc(`generations/${this.id}`).set({
      id: this.id,
      kind: "yiayia_edit",
      trigger: { kind: "yiayia_admin", description: this.description },
      status: "streaming",
      statusLog: [
        {
          at: Timestamp.now(),
          message: this.description,
          source: "system",
        },
      ],
      manifest: [],
      createdAt: Timestamp.now(),
    });
  }

  async recordSet(
    path: string,
    data: Record<string, unknown>,
    kind: ManifestAction = "create",
  ): Promise<void> {
    await this.ensureOpen();
    const db = getFirestore();
    const ref = db.doc(path);
    if (kind === "update") {
      // For updates, do NOT overwrite the doc's original generationId — that
      // belongs to whoever created it. Only append to generationHistory so
      // we can find the trail without making the doc look like our own
      // creation (otherwise the revert's orphan-cleanup deletes the doc).
      await ref.set(
        {
          ...data,
          generationHistory: FieldValue.arrayUnion(this.id),
        },
        { merge: true },
      );
    } else {
      await ref.set({ ...data, generationId: this.id });
    }
    this.manifest.push({ path, action: kind });
    await db
      .doc(`generations/${this.id}`)
      .update({ manifest: FieldValue.arrayUnion({ path, action: kind }) });
  }

  async recordUpdate(path: string, data: Record<string, unknown>): Promise<void> {
    await this.recordSet(path, data, "update");
  }

  async recordArrayUnion(
    path: string,
    field: string,
    value: unknown,
  ): Promise<void> {
    await this.ensureOpen();
    const db = getFirestore();
    await db.doc(path).update({
      [field]: FieldValue.arrayUnion(value),
      generationHistory: FieldValue.arrayUnion(this.id),
      updatedAt: Timestamp.now(),
    });
    const entry: ManifestEntry = {
      path,
      action: "arrayUnion",
      field,
      addedValue: value,
    };
    this.manifest.push(entry);
    await db
      .doc(`generations/${this.id}`)
      .update({ manifest: FieldValue.arrayUnion(entry) });
  }

  /**
   * Plain delete — recorded as a "create" inverse for orphan cleanup
   * purposes, but really these can't be undone by revertGeneration alone.
   * (Revert only reverses things we created, not things we deleted.)
   */
  async noteDelete(path: string): Promise<void> {
    await this.ensureOpen();
    const db = getFirestore();
    await db
      .doc(`generations/${this.id}`)
      .update({
        deletedPaths: FieldValue.arrayUnion(path),
        statusLog: FieldValue.arrayUnion({
          at: Timestamp.now(),
          message: `Deleted ${path}`,
          source: "system",
        }),
      });
  }

  async appendLog(message: string): Promise<void> {
    if (!this.opened) return;
    await getFirestore()
      .doc(`generations/${this.id}`)
      .update({
        statusLog: FieldValue.arrayUnion({
          at: Timestamp.now(),
          message,
          source: "system",
        }),
      });
  }

  async close(): Promise<void> {
    if (!this.opened) return;
    await getFirestore()
      .doc(`generations/${this.id}`)
      .update({
        status: "done",
        completedAt: Timestamp.now(),
        latencyMs: Date.now() - this.startedAt,
        statusLog: FieldValue.arrayUnion({
          at: Timestamp.now(),
          message: "Yiayia admin edit complete.",
          source: "system",
        }),
      });
  }

  async fail(message: string): Promise<void> {
    if (!this.opened) return;
    await getFirestore()
      .doc(`generations/${this.id}`)
      .update({
        status: "error",
        completedAt: Timestamp.now(),
        latencyMs: Date.now() - this.startedAt,
        statusLog: FieldValue.arrayUnion({
          at: Timestamp.now(),
          message: `Yiayia admin edit failed: ${message}`,
          source: "system",
        }),
      });
  }

  hasWrites(): boolean {
    return this.manifest.length > 0;
  }

  hasActivity(): boolean {
    return this.opened;
  }

  manifestSummary(): { count: number; sample: string[] } {
    return {
      count: this.manifest.length,
      sample: this.manifest.slice(0, 5).map((m) => `${m.action} ${m.path}`),
    };
  }
}
