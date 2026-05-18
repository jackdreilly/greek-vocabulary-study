import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { z } from "genkit";
import { ALLOWED_ORIGINS } from "../cors.js";

const RevertInputSchema = z.object({
  generationId: z.string().min(3).max(120),
  confirm: z.literal(true),
  revertedBy: z.string().optional().default("admin-ui"),
});

type ManifestEntry = {
  path: string;
  action: "create" | "update" | "arrayUnion";
  field?: string;
  before?: unknown;
  addedValue?: unknown;
};

const CHILD_COLLECTIONS = ["lessons", "entries", "plans", "games", "vocabBatches", "gameBatches"];

function collectAffectedDocs(manifest: ManifestEntry[]) {
  const lessons = new Set<string>(); // "courseId/lessonId"
  const courses = new Set<string>();
  for (const item of manifest) {
    const parts = item.path.split("/");
    // courses/{courseId}/lessons/{lessonId}/...
    if (parts[0] === "courses" && parts[1]) {
      courses.add(parts[1]);
      if (parts[2] === "lessons" && parts[3]) {
        lessons.add(`${parts[1]}/${parts[3]}`);
      }
    }
  }
  return { lessons, courses };
}

async function rebuildLessonCounts(courseId: string, lessonId: string) {
  const db = getFirestore();
  const lessonRef = db.doc(`courses/${courseId}/lessons/${lessonId}`);
  const lessonSnap = await lessonRef.get();
  if (!lessonSnap.exists) return null;
  const [entries, plans, games] = await Promise.all([
    lessonRef.collection("entries").count().get(),
    lessonRef.collection("plans").count().get(),
    lessonRef.collection("games").count().get(),
  ]);
  const counts = {
    entries: entries.data().count,
    plans: plans.data().count,
    games: games.data().count,
  };
  await lessonRef.update({ counts, updatedAt: Timestamp.now() });
  return counts;
}

async function rebuildCourseCounts(courseId: string) {
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

export const revertGeneration = onCall({ cors: ALLOWED_ORIGINS }, async (request) => {
  const parsed = RevertInputSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError(
      "invalid-argument",
      parsed.error.issues.map((issue) => issue.message).join("; "),
    );
  }
  const { generationId, revertedBy } = parsed.data;
  const db = getFirestore();
  const genRef = db.doc(`generations/${generationId}`);

  const claimed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(genRef);
    if (!snap.exists) throw new HttpsError("not-found", `Generation ${generationId} not found`);
    const data = snap.data() ?? {};
    if (data.status === "reverted") return { reverted: true, manifest: data.manifest ?? [] };
    if (data.status === "reverting") return { reverted: false, manifest: data.manifest ?? [] };
    tx.update(genRef, {
      status: "reverting",
      statusLog: FieldValue.arrayUnion({
        at: Timestamp.now(),
        message: `Revert started by ${revertedBy}.`,
        source: "system",
      }),
    });
    return { reverted: false, manifest: (data.manifest ?? []) as ManifestEntry[] };
  });

  if (claimed.reverted) {
    return { ok: true, alreadyReverted: true };
  }

  const manifest: ManifestEntry[] = Array.isArray(claimed.manifest) ? [...claimed.manifest] : [];
  // Process in reverse: children before parents.
  manifest.reverse();

  let deletes = 0;
  let arrayRemoves = 0;
  let updates = 0;
  try {
    for (const item of manifest) {
      const ref = db.doc(item.path);
      try {
        if (item.action === "create") {
          await ref.delete();
          deletes++;
        } else if (item.action === "arrayUnion" && item.field && item.addedValue !== undefined) {
          await ref.update({ [item.field]: FieldValue.arrayRemove(item.addedValue) });
          arrayRemoves++;
        } else if (item.action === "update") {
          // Best-effort: clear generation marker but leave fields. Manifest does not carry full before-state.
          await ref.update({
            generationHistory: FieldValue.arrayRemove(generationId),
            generationId: FieldValue.delete(),
            updatedAt: Timestamp.now(),
          }).catch(() => undefined);
          updates++;
        }
      } catch (err) {
        logger.warn("revertGeneration: manifest entry failed", {
          generationId,
          item,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Belt-and-braces: collection-group queries to clean up orphans.
    let orphans = 0;
    for (const collection of CHILD_COLLECTIONS) {
      try {
        const snap = await db
          .collectionGroup(collection)
          .where("generationId", "==", generationId)
          .limit(500)
          .get();
        for (const doc of snap.docs) {
          await doc.ref.delete();
          orphans++;
        }
      } catch (err) {
        logger.warn("revertGeneration: collection-group cleanup failed", {
          collection,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Rebuild counts on every course/lesson the manifest touched. Belt-and-braces
    // because deletes don't fire the generation triggers that maintain counts.
    const { lessons: affectedLessons, courses: affectedCourses } = collectAffectedDocs(manifest);
    for (const lessonKey of affectedLessons) {
      const [courseId, lessonId] = lessonKey.split("/");
      try {
        await rebuildLessonCounts(courseId, lessonId);
      } catch (err) {
        logger.warn("rebuildLessonCounts failed", { courseId, lessonId, err });
      }
    }
    for (const courseId of affectedCourses) {
      try {
        await rebuildCourseCounts(courseId);
      } catch (err) {
        logger.warn("rebuildCourseCounts failed", { courseId, err });
      }
    }

    await genRef.update({
      status: "reverted",
      revertedAt: Timestamp.now(),
      revertedBy,
      statusLog: FieldValue.arrayUnion({
        at: Timestamp.now(),
        message: `Revert complete. Deletes=${deletes}, arrayRemoves=${arrayRemoves}, updates=${updates}, orphans=${orphans}.`,
        source: "system",
      }),
    });

    return { ok: true, deletes, arrayRemoves, updates, orphans };
  } catch (err) {
    logger.error("revertGeneration failed", err);
    await genRef.update({
      status: "error",
      statusLog: FieldValue.arrayUnion({
        at: Timestamp.now(),
        message: `Revert failed: ${err instanceof Error ? err.message : String(err)}`,
        source: "system",
      }),
    }).catch(() => undefined);
    throw new HttpsError("internal", err instanceof Error ? err.message : String(err));
  }
});
