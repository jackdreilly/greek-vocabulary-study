// Generate starter games for all lessons that have no exercises yet.
// Uses the deployed generateLessonGames Firebase function via REST.
import { Firestore } from "@google-cloud/firestore";
import { GoogleAuth } from "google-auth-library";

const PROJECT_ID = "didibros-6d3ed";
const DATABASE_ID = "greek-vocab";
const FUNCTION_URL = `https://us-central1-${PROJECT_ID}.cloudfunctions.net/generateLessonGames`;
const COUNT_PER_TYPE = 5;
const CONCURRENCY = 2; // generate N lessons at a time to avoid overwhelming the function

const db = new Firestore({ projectId: PROJECT_ID, databaseId: DATABASE_ID });
const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });

async function callGenerateLessonGames(lesson, entries) {
  const client = await auth.getIdTokenClient(FUNCTION_URL);
  const headers = await client.getRequestHeaders();

  const body = JSON.stringify({
    data: {
      lessonId: lesson.id,
      lessonTitle: lesson.title,
      countPerType: COUNT_PER_TYPE,
      previousExerciseDigests: [],
      entries: entries
        .filter((e) => e.lemma && (e.english || e.english_senses?.length))
        .slice(0, 100)
        .map((e) => ({
          id: String(e.id ?? ""),
          lemma: String(e.lemma || ""),
          article: e.article || null,
          english: e.english || "",
          english_senses: e.english_senses || [],
          category: e.category || "",
        })),
      preferences: { responseLanguage: "english", cefrLevel: "A2" },
    },
  });

  const res = await fetch(FUNCTION_URL, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
  }

  const json = await res.json();
  return json.result?.exercises || json.data?.exercises || [];
}

function withDefaults(exercise, lessonId) {
  const id =
    exercise.id || `l${lessonId}-${exercise.type}-${Math.random().toString(36).slice(2, 9)}`;
  const requiredWords = exercise.requiredWords || [];
  return {
    acceptableAnswers: [],
    requiredWords,
    vocabulary: [],
    sourceEntryIds: [],
    coverage: {
      summary: String(exercise.title || exercise.prompt || exercise.type || "").slice(0, 120),
      words: requiredWords.slice(0, 12),
      themes: [exercise.type].filter(Boolean),
      ...(exercise.coverage || {}),
    },
    status: "active",
    lessonId,
    generatedBy: "ai",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...exercise,
    id,
  };
}

async function saveExercises(exercises) {
  const batch = db.batch();
  for (const ex of exercises) {
    batch.set(db.collection("lesson_ai_exercises").doc(String(ex.id)), ex, { merge: true });
  }
  await batch.commit();
}

async function runWithConcurrency(tasks, concurrency) {
  const results = [];
  for (let i = 0; i < tasks.length; i += concurrency) {
    const chunk = tasks.slice(i, i + concurrency);
    const chunkResults = await Promise.allSettled(chunk.map((fn) => fn()));
    results.push(...chunkResults);
  }
  return results;
}

// --- main ---
console.log("Loading themes and entries from Firestore...");
const [themesSnap, entriesSnap, exercisesSnap] = await Promise.all([
  db.collection("themes").get(),
  db.collection("entries").get(),
  db.collection("lesson_ai_exercises").get(),
]);

const themes = themesSnap.docs.map((d) => ({ ...d.data(), id: Number(d.data().id ?? d.id) }));
const allEntries = entriesSnap.docs.map((d) => d.data());

// Which lessons already have at least one active exercise?
const lessonsWithGames = new Set(
  exercisesSnap.docs
    .map((d) => d.data())
    .filter((e) => e.status !== "removed")
    .map((e) => Number(e.lessonId)),
);

const lessonsNeedingGames = themes
  .filter((t) => !lessonsWithGames.has(t.id))
  .sort((a, b) => a.id - b.id);

console.log(`\n${themes.length} lessons total.`);
console.log(`${lessonsWithGames.size} already have games.`);
console.log(`${lessonsNeedingGames.length} need games:\n`);
for (const l of lessonsNeedingGames) {
  console.log(`  Lesson ${l.id}: ${l.title}`);
}

if (lessonsNeedingGames.length === 0) {
  console.log("\nAll lessons already have games. Done.");
  process.exit(0);
}

console.log(`\nGenerating games (${COUNT_PER_TYPE} per type × 5 types = ${COUNT_PER_TYPE * 5} per lesson)...\n`);

let succeeded = 0;
let failed = 0;

const tasks = lessonsNeedingGames.map((lesson) => async () => {
  const lessonEntries = allEntries.filter((e) => Number(e.theme_id) === lesson.id);
  console.log(`[L${lesson.id}] ${lesson.title} (${lessonEntries.length} entries) — generating...`);
  try {
    const exercises = await callGenerateLessonGames(lesson, lessonEntries);
    if (!exercises.length) throw new Error("Function returned 0 exercises");
    const withMeta = exercises.map((ex) => withDefaults(ex, lesson.id));
    await saveExercises(withMeta);
    succeeded++;
    console.log(`[L${lesson.id}] ✓ saved ${withMeta.length} exercises`);
  } catch (err) {
    failed++;
    console.error(`[L${lesson.id}] ✗ FAILED: ${err.message}`);
  }
});

await runWithConcurrency(tasks, CONCURRENCY);

console.log(`\nDone. ${succeeded} lessons generated, ${failed} failed.`);
