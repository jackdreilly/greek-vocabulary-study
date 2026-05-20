#!/usr/bin/env node
/**
 * Migrate content from legacy didibros-6d3ed → fanari-b6bb4:(default)
 * under the new subcollection schema.
 *
 * See docs/vision.md.
 *
 * Usage:
 *   node scripts/migrate_to_fanari.mjs                  # dry run (inventory only)
 *   node scripts/migrate_to_fanari.mjs --execute        # actually write
 *   node scripts/migrate_to_fanari.mjs --execute --resume
 *     # resume from .migration-progress.json (skip already-written docs)
 *   node scripts/migrate_to_fanari.mjs --execute --course-id=everyday-greek
 *     # limit to one course (handy for incremental testing)
 *   node scripts/migrate_to_fanari.mjs --execute --target-emulator
 *     # write to local Firestore emulator instead of production fanari-b6bb4
 */

import { Firestore, FieldValue } from "@google-cloud/firestore";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import {
  legacyLessonId,
  mapCourse,
  mapEntry,
  mapGame,
  mapLesson,
  mapPlan,
} from "./lib/legacyMappers.mjs";

const SRC_PROJECT = "didibros-6d3ed";
// Despite the original architecture intending a split, all greekflash
// collections (content + AI-generated) live in the `greek-vocab` named DB.
// The `(default)` DB on didibros-6d3ed is reserved for the fanariotes app.
const SRC_DB_VOCAB = "greek-vocab";

const DST_PROJECT = "fanari-b6bb4";
const DST_DB = "(default)";

const PROGRESS_FILE = ".migration-progress.json";

const argv = parseArgs(process.argv.slice(2));
const dryRun = !argv.execute;
const resume = argv.resume;
const courseFilter = argv["course-id"];
const targetEmulator = argv["target-emulator"];

function parseArgs(args) {
  const out = {};
  for (const a of args) {
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq > 0) out[a.slice(2, eq)] = a.slice(eq + 1);
      else out[a.slice(2)] = true;
    }
  }
  return out;
}

async function loadProgress() {
  if (!resume || !existsSync(PROGRESS_FILE)) return { writtenDocs: {} };
  return JSON.parse(await readFile(PROGRESS_FILE, "utf8"));
}

async function saveProgress(progress) {
  await writeFile(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

function fmt(n) {
  return n.toString().padStart(5);
}

async function main() {
  const mode = dryRun ? "DRY RUN (inventory only)" : "EXECUTE";
  console.log(`\n[migrate] mode: ${mode}`);
  console.log(`[migrate] source: ${SRC_PROJECT}:${SRC_DB_VOCAB}`);
  const emulatorHost = targetEmulator ? process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080" : null;
  if (emulatorHost) {
    console.log(`[migrate] target: EMULATOR @ ${emulatorHost}`);
  } else {
    console.log(`[migrate] target: ${DST_PROJECT}:${DST_DB}`);
  }
  if (courseFilter) console.log(`[migrate] courseFilter: ${courseFilter}`);
  if (resume) console.log(`[migrate] resuming from ${PROGRESS_FILE}`);
  console.log("");

  // Order matters: construct the source FIRST without FIRESTORE_EMULATOR_HOST,
  // then set the env var only for the destination so the source still talks
  // to real Cloud Firestore.
  delete process.env.FIRESTORE_EMULATOR_HOST;
  const src = new Firestore({ projectId: SRC_PROJECT, databaseId: SRC_DB_VOCAB });
  if (emulatorHost) process.env.FIRESTORE_EMULATOR_HOST = emulatorHost;
  const dst = new Firestore({
    projectId: DST_PROJECT,
    databaseId: DST_DB,
    ignoreUndefinedProperties: true,
  });

  console.log("[migrate] fetching source data…");
  const [coursesSnap, themesSnap, entriesSnap, plansSnap, gamesSnap] = await Promise.all([
    src.collection("courses").get(),
    src.collection("themes").get(),
    src.collection("entries").get(),
    src.collection("lesson_ai_plans").get(),
    src.collection("lesson_ai_exercises").get(),
  ]);

  const courses = coursesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const themes = themesSnap.docs.map((d) => ({ id: Number(d.id), ...d.data() }));
  const entries = entriesSnap.docs.map((d) => ({ id: Number(d.id), ...d.data() }));
  const plans = plansSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const games = gamesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  console.log("[migrate] source inventory:");
  console.log(`  courses              : ${fmt(courses.length)}`);
  console.log(`  themes (lessons)     : ${fmt(themes.length)}`);
  console.log(`  entries              : ${fmt(entries.length)}`);
  console.log(`  lesson_ai_plans      : ${fmt(plans.length)}`);
  console.log(`  lesson_ai_exercises  : ${fmt(games.length)}`);

  if (courseFilter) {
    const before = courses.length;
    const filtered = courses.filter((c) => c.id === courseFilter);
    if (filtered.length === 0) {
      console.error(`[migrate] ERROR: --course-id="${courseFilter}" not found in source.`);
      process.exit(2);
    }
    courses.length = 0;
    courses.push(...filtered);
    console.log(`[migrate] filter narrowed ${before} courses -> ${courses.length}`);
  }

  if (dryRun) {
    // Show planned write counts grouped by course.
    console.log("\n[migrate] planned writes per course:");
    for (const c of courses) {
      const lessonsForCourse = themes.filter(
        (t) => t.courseId === c.id || t.course === c.id
      );
      const lessonIds = new Set(lessonsForCourse.map((t) => t.id));
      const entriesForCourse = entries.filter((e) => lessonIds.has(Number(e.theme_id)));
      const plansForCourse = plans.filter((p) =>
        lessonIds.has(Number((p.lessonId ?? "").toString().replace(/^l/, "")))
      );
      const gamesForCourse = games.filter((g) =>
        lessonIds.has(Number((g.lessonId ?? "").toString().replace(/^l/, "")))
      );
      console.log(
        `  ${c.id.padEnd(28)} lessons=${fmt(lessonsForCourse.length)} ` +
          `entries=${fmt(entriesForCourse.length)} ` +
          `plans=${fmt(plansForCourse.length)} ` +
          `games=${fmt(gamesForCourse.length)}`
      );
    }
    console.log("\n[migrate] dry run only — no writes. Re-run with --execute to migrate.");
    return;
  }

  // EXECUTE path.
  const progress = await loadProgress();
  const written = new Set(Object.keys(progress.writtenDocs ?? {}));
  const generationId = progress.generationId ?? `legacy-import-${new Date().toISOString()}`;
  progress.generationId = generationId;
  progress.writtenDocs ??= {};

  console.log(`[migrate] generationId: ${generationId}`);

  const now = new Date();
  const bulk = dst.bulkWriter();
  bulk.onWriteError((err) => err.failedAttempts < 5);

  let createdCount = 0;
  function record(path, data) {
    if (written.has(path)) return false;
    bulk.set(dst.doc(path), { ...data, generationHistory: FieldValue.arrayUnion(generationId) });
    progress.writtenDocs[path] = true;
    createdCount += 1;
    return true;
  }

  // 1) Seed the generations/{id} manifest stub.
  const genRef = dst.doc(`generations/${generationId}`);
  if (!written.has(genRef.path)) {
    bulk.set(genRef, {
      id: generationId,
      kind: "legacy_import",
      trigger: {
        kind: "migration",
        description: `Legacy import from ${SRC_PROJECT}:${SRC_DB_VOCAB}`,
      },
      status: "streaming",
      statusLog: [{ at: now, message: "Migration started", source: "system" }],
      manifest: [],
      createdAt: now,
    });
    progress.writtenDocs[genRef.path] = true;
  }

  // 2) Build courseId -> array of lessons, lessonId -> arrays for children.
  const themesByCourse = new Map();
  for (const c of courses) themesByCourse.set(c.id, []);
  for (const t of themes) {
    // courseId is the slug; t.course is the display name (e.g. "Afrodite Lourbakos").
    const cid = t.courseId ?? t.course;
    if (!cid || !themesByCourse.has(cid)) continue;
    themesByCourse.get(cid).push(t);
  }
  for (const arr of themesByCourse.values()) arr.sort((a, b) => (a.lessonOrder ?? 999) - (b.lessonOrder ?? 999));

  const entriesByTheme = new Map();
  for (const e of entries) {
    const tid = Number(e.theme_id);
    if (!entriesByTheme.has(tid)) entriesByTheme.set(tid, []);
    entriesByTheme.get(tid).push(e);
  }

  const plansByLessonNum = new Map();
  for (const p of plans) {
    const num = Number((p.lessonId ?? "").toString().replace(/^l/, ""));
    if (!plansByLessonNum.has(num)) plansByLessonNum.set(num, []);
    plansByLessonNum.get(num).push(p);
  }

  const gamesByLessonNum = new Map();
  for (const g of games) {
    const num = Number((g.lessonId ?? "").toString().replace(/^l/, ""));
    if (!gamesByLessonNum.has(num)) gamesByLessonNum.set(num, []);
    gamesByLessonNum.get(num).push(g);
  }

  // 3) Walk the tree, writing as we go.
  for (const c of courses) {
    const lessonsForCourse = themesByCourse.get(c.id) ?? [];
    const lessonSummaries = {};

    const courseMap = mapCourse(c, { generationId, now });
    let courseEntryCount = 0;
    let coursePlanCount = 0;
    let courseGameCount = 0;

    for (let li = 0; li < lessonsForCourse.length; li++) {
      const t = lessonsForCourse[li];
      const lessonMap = mapLesson(t, c.id, {
        generationId,
        now,
        fallbackOrder: li + 1,
      });

      const themeEntries = entriesByTheme.get(t.id) ?? [];
      const themePlans = plansByLessonNum.get(t.id) ?? [];
      const themeGames = gamesByLessonNum.get(t.id) ?? [];

      lessonMap.data.counts = {
        entries: themeEntries.length,
        plans: themePlans.length,
        games: themeGames.length,
      };

      record(`courses/${c.id}/lessons/${lessonMap.id}`, lessonMap.data);

      for (let ei = 0; ei < themeEntries.length; ei++) {
        const entryMap = mapEntry(themeEntries[ei], c.id, lessonMap.id, ei, {
          generationId,
          now,
        });
        record(
          `courses/${c.id}/lessons/${lessonMap.id}/entries/${entryMap.id}`,
          entryMap.data
        );
      }
      for (const p of themePlans) {
        const planMap = mapPlan(p, c.id, lessonMap.id, { generationId, now });
        record(`courses/${c.id}/lessons/${lessonMap.id}/plans/${planMap.id}`, planMap.data);
      }
      for (const g of themeGames) {
        const gameMap = mapGame(g, c.id, lessonMap.id, { generationId, now });
        record(`courses/${c.id}/lessons/${lessonMap.id}/games/${gameMap.id}`, gameMap.data);
      }

      courseEntryCount += themeEntries.length;
      coursePlanCount += themePlans.length;
      courseGameCount += themeGames.length;

      lessonSummaries[lessonMap.id] = {
        title: lessonMap.data.title,
        subtitle: lessonMap.data.subtitle,
        order: lessonMap.data.order,
        status: lessonMap.data.status,
        entryCount: themeEntries.length,
        planCount: themePlans.length,
        gameCount: themeGames.length,
      };
    }

    courseMap.data.lessonSummaries = lessonSummaries;
    courseMap.data.counts = {
      lessons: lessonsForCourse.length,
      entries: courseEntryCount,
      plans: coursePlanCount,
      games: courseGameCount,
    };
    record(`courses/${c.id}`, courseMap.data);

    console.log(
      `[migrate] queued course="${c.id}" lessons=${lessonsForCourse.length} ` +
        `entries=${courseEntryCount} plans=${coursePlanCount} games=${courseGameCount}`
    );
  }

  console.log(`[migrate] flushing ${createdCount} writes…`);
  await bulk.close();

  // Finalize the generation doc.
  await genRef.set(
    {
      status: "done",
      completedAt: new Date(),
      statusLog: FieldValue.arrayUnion({
        at: new Date(),
        message: `Migration complete — ${createdCount} docs written`,
        source: "system",
      }),
    },
    { merge: true }
  );

  await ensureDir(dirname(PROGRESS_FILE));
  await saveProgress(progress);
  console.log(`[migrate] done. ${createdCount} new docs written.`);
  console.log(`[migrate] progress file: ${PROGRESS_FILE}`);
  console.log(`[migrate] generation:    generations/${generationId}`);
}

async function ensureDir(path) {
  if (!path || path === ".") return;
  await mkdir(path, { recursive: true });
}

main().catch((err) => {
  console.error("[migrate] FATAL", err);
  process.exit(1);
});
