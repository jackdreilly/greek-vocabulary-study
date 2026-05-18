/**
 * Cascade-deletion helpers — used by the admin chat tools.
 *
 * Deletes don't go through `recordedSet`; they are emitted directly with
 * admin-SDK calls and the affected paths are logged on the generation doc
 * (see lineage.noteDelete). Counts on parent docs are recomputed at the end.
 */
import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";

export type CascadeCounts = {
  courses: number;
  lessons: number;
  entries: number;
  plans: number;
  games: number;
};

function emptyCounts(): CascadeCounts {
  return { courses: 0, lessons: 0, entries: 0, plans: 0, games: 0 };
}

async function deleteSubcollection(ref: FirebaseFirestore.CollectionReference): Promise<number> {
  const db = getFirestore();
  let removed = 0;
  let snapshot = await ref.limit(400).get();
  while (!snapshot.empty) {
    const batch = db.batch();
    for (const doc of snapshot.docs) batch.delete(doc.ref);
    await batch.commit();
    removed += snapshot.size;
    if (snapshot.size < 400) break;
    snapshot = await ref.limit(400).get();
  }
  return removed;
}

export async function deleteEntryDoc(
  courseId: string,
  lessonId: string,
  entryId: string,
): Promise<CascadeCounts> {
  const counts = emptyCounts();
  const ref = getFirestore().doc(`courses/${courseId}/lessons/${lessonId}/entries/${entryId}`);
  const snap = await ref.get();
  if (snap.exists) {
    await ref.delete();
    counts.entries = 1;
  }
  return counts;
}

export async function deleteGameDoc(
  courseId: string,
  lessonId: string,
  gameId: string,
): Promise<CascadeCounts> {
  const counts = emptyCounts();
  const ref = getFirestore().doc(`courses/${courseId}/lessons/${lessonId}/games/${gameId}`);
  const snap = await ref.get();
  if (snap.exists) {
    await ref.delete();
    counts.games = 1;
  }
  return counts;
}

export async function deletePlanDoc(
  courseId: string,
  lessonId: string,
  planId: string,
): Promise<CascadeCounts> {
  const counts = emptyCounts();
  const ref = getFirestore().doc(`courses/${courseId}/lessons/${lessonId}/plans/${planId}`);
  const snap = await ref.get();
  if (snap.exists) {
    await ref.delete();
    counts.plans = 1;
  }
  return counts;
}

export async function deleteLessonCascade(
  courseId: string,
  lessonId: string,
): Promise<CascadeCounts> {
  const counts = emptyCounts();
  const lessonRef = getFirestore().doc(`courses/${courseId}/lessons/${lessonId}`);
  const lessonSnap = await lessonRef.get();
  if (!lessonSnap.exists) return counts;

  counts.entries += await deleteSubcollection(lessonRef.collection("entries"));
  counts.plans += await deleteSubcollection(lessonRef.collection("plans"));
  counts.games += await deleteSubcollection(lessonRef.collection("games"));
  counts.lessons += await deleteSubcollection(lessonRef.collection("vocabBatches"));
  counts.lessons += await deleteSubcollection(lessonRef.collection("gameBatches"));

  await lessonRef.delete();
  counts.lessons += 1;
  return counts;
}

export async function deleteCourseCascade(courseId: string): Promise<CascadeCounts> {
  const counts = emptyCounts();
  const courseRef = getFirestore().doc(`courses/${courseId}`);
  const courseSnap = await courseRef.get();
  if (!courseSnap.exists) return counts;

  const lessonsSnap = await courseRef.collection("lessons").get();
  for (const lessonDoc of lessonsSnap.docs) {
    const lessonCounts = await deleteLessonCascade(courseId, lessonDoc.id);
    counts.entries += lessonCounts.entries;
    counts.plans += lessonCounts.plans;
    counts.games += lessonCounts.games;
    counts.lessons += lessonCounts.lessons;
  }

  await courseRef.delete();
  counts.courses = 1;
  return counts;
}

export async function rebuildLessonCounts(courseId: string, lessonId: string) {
  const db = getFirestore();
  const lessonRef = db.doc(`courses/${courseId}/lessons/${lessonId}`);
  const snap = await lessonRef.get();
  if (!snap.exists) return;
  const [entries, plans, games] = await Promise.all([
    lessonRef.collection("entries").count().get(),
    lessonRef.collection("plans").count().get(),
    lessonRef.collection("games").count().get(),
  ]);
  await lessonRef.update({
    counts: {
      entries: entries.data().count,
      plans: plans.data().count,
      games: games.data().count,
    },
    updatedAt: Timestamp.now(),
  });
}

export async function rebuildCourseCounts(courseId: string) {
  const db = getFirestore();
  const courseRef = db.doc(`courses/${courseId}`);
  const courseSnap = await courseRef.get();
  if (!courseSnap.exists) return;
  const data = courseSnap.data() ?? {};
  const lessonsSnap = await courseRef.collection("lessons").get();
  const summaries: Record<string, Record<string, unknown>> = {};
  let entries = 0;
  let plans = 0;
  let games = 0;
  for (const doc of lessonsSnap.docs) {
    const lessonData = doc.data();
    const c = lessonData.counts ?? {};
    entries += Number(c.entries ?? 0);
    plans += Number(c.plans ?? 0);
    games += Number(c.games ?? 0);
    const prior = (data.lessonSummaries ?? {})[doc.id] ?? {};
    summaries[doc.id] = {
      ...prior,
      title: lessonData.title ?? prior.title ?? doc.id,
      subtitle: lessonData.subtitle ?? prior.subtitle ?? "",
      order: Number(lessonData.order ?? prior.order ?? 999),
      status: lessonData.status ?? prior.status ?? "ready",
      entryCount: Number(c.entries ?? 0),
      planCount: Number(c.plans ?? 0),
      gameCount: Number(c.games ?? 0),
    };
  }
  await courseRef.update({
    lessonSummaries: summaries,
    counts: { lessons: lessonsSnap.size, entries, plans, games },
    updatedAt: Timestamp.now(),
  });
}

export function removeLessonSummary(courseId: string, lessonId: string) {
  return getFirestore()
    .doc(`courses/${courseId}`)
    .update({
      [`lessonSummaries.${lessonId}`]: FieldValue.delete(),
      updatedAt: Timestamp.now(),
    });
}
