/**
 * Normalizes vocabulary entry documents on every write.
 *
 * Ensures `english` and `senses` are always consistent:
 *   - If `english` is blank but `senses[0]` exists → backfill `english`
 *   - If `senses` is empty but `english` exists → backfill `senses`
 *
 * This runs after any write (AI tools, vocab generation, manual edits) so the
 * rest of the app can rely on at least one of these fields being populated.
 */
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { onDocumentWritten } from "firebase-functions/v2/firestore";

export const onEntryWritten = onDocumentWritten(
  "courses/{courseId}/lessons/{lessonId}/entries/{entryId}",
  async (event) => {
    const after = event.data?.after;
    if (!after?.exists) return; // deletion — nothing to normalize

    const data = after.data() as Record<string, unknown>;
    const english = typeof data.english === "string" ? data.english.trim() : "";
    const senses: string[] = Array.isArray(data.senses)
      ? (data.senses as unknown[]).map((s) => String(s).trim()).filter(Boolean)
      : [];

    const patch: Record<string, unknown> = {};

    if (!english && senses.length > 0) {
      patch.english = senses[0];
    }

    if (senses.length === 0 && english) {
      patch.senses = [english];
    }

    if (Object.keys(patch).length === 0) return; // already consistent

    patch.updatedAt = Timestamp.now();
    await getFirestore()
      .doc(`courses/${event.params.courseId}/lessons/${event.params.lessonId}/entries/${event.params.entryId}`)
      .update(patch);
  },
);
