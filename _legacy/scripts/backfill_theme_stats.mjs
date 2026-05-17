// Backfills `entry_count`, `translated_count`, `audio_count`, and `categories`
// onto every theme doc, and writes range-backed Top 5000 lesson docs with enough
// metadata for the client to load them without hardcoded ID/course rules.
//
// Run: node scripts/backfill_theme_stats.mjs

import { FieldValue, Firestore } from "@google-cloud/firestore";

const PROJECT_ID = "didibros-6d3ed";
const DATABASE_ID = "greek-vocab";
const TOP_5000_ID = 13;
const TOP_5000_SUB_BASE = 1300;
const TOP_5000_CHUNK = 250;
const LEGACY_COURSE_ASSIGNMENTS = [
  { name: "Afrodite Lourbakos", ids: (id) => id >= 1 && id <= 12 },
  { name: "3rd Grade A1 Certification", ids: (id) => id >= 14 && id <= 19 },
];

const db = new Firestore({ projectId: PROJECT_ID, databaseId: DATABASE_ID });

function courseIdFromName(name) {
  const base = String(name || "course")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "course";
}

function isTranslated(e) {
  return Boolean(e.english || (Array.isArray(e.english_senses) && e.english_senses.length));
}

console.log("Reading themes…");
const themeSnap = await db.collection("themes").get();
const themes = themeSnap.docs.map((d) => d.data());
console.log(`  ${themes.length} themes`);

console.log("Reading entries…");
const entrySnap = await db.collection("entries").get();
const entries = entrySnap.docs.map((d) => d.data());
console.log(`  ${entries.length} entries`);

// Group entries by theme_id
const byTheme = new Map();
for (const e of entries) {
  const tid = Number(e.theme_id);
  if (!byTheme.has(tid)) byTheme.set(tid, []);
  byTheme.get(tid).push(e);
}

function statsFor(group) {
  const categories = {};
  let translated = 0;
  let audio = 0;
  for (const e of group) {
    if (isTranslated(e)) translated += 1;
    if (e.audio_available) audio += 1;
    const cat = e.category || "Other";
    categories[cat] = (categories[cat] || 0) + 1;
  }
  return {
    entry_count: group.length,
    translated_count: translated,
    audio_count: audio,
    categories,
  };
}

// Build the 20 Top-5000 sub-themes from the raw theme-13 entries
const top5kEntries = entries
  .filter((entry) => entry.entry_source === "top5000" || Number(entry.theme_id) === TOP_5000_ID)
  .slice()
  .sort((a, b) => (Number(a.frequency_rank) || 9999) - (Number(b.frequency_rank) || 9999));

const subThemes = [];
const top5kEntryThemeUpdates = new Map();
const courseRecords = new Map();

function rememberCourse(name) {
  const title = String(name || "").trim();
  if (!title) return "";
  const id = courseIdFromName(title);
  if (!courseRecords.has(id)) {
    courseRecords.set(id, {
      id,
      title,
      updatedAt: Date.now(),
    });
  }
  return id;
}

function legacyCourseName(themeId) {
  return LEGACY_COURSE_ASSIGNMENTS.find((course) => course.ids(themeId))?.name || "";
}

for (let i = 0; i < 20; i++) {
  const chunk = top5kEntries.slice(i * TOP_5000_CHUNK, (i + 1) * TOP_5000_CHUNK);
  if (!chunk.length) continue;
  const rankStart = Number(chunk[0].frequency_rank) || i * TOP_5000_CHUNK + 1;
  const rankEnd = Number(chunk[chunk.length - 1].frequency_rank) || (i + 1) * TOP_5000_CHUNK;
  const course = "Top 5000";
  const subThemeId = TOP_5000_SUB_BASE + i + 1;
  subThemes.push({
    id: subThemeId,
    title: `Words ${rankStart}–${rankEnd}`,
    course,
    courseId: rememberCourse(course),
    displayNumber: i + 1,
    lessonOrder: i + 1,
    metadata: {
      generator: "top5000-rank-split",
      rankStart,
      rankEnd,
    },
    showGroupFilter: true,
    sourceThemeId: FieldValue.delete(),
    entryThemeId: FieldValue.delete(),
    rankStart: FieldValue.delete(),
    rankEnd: FieldValue.delete(),
    ...statsFor(chunk),
  });
  for (const entry of chunk) {
    top5kEntryThemeUpdates.set(String(entry.id), subThemeId);
  }
}

// Write updated stats onto each existing theme doc
console.log("Writing theme stats…");
let batch = db.batch();
let ops = 0;
async function flush() {
  if (ops === 0) return;
  await batch.commit();
  batch = db.batch();
  ops = 0;
}

for (const theme of themes) {
  const group = byTheme.get(Number(theme.id)) || [];
  const stats = statsFor(group);
  const ref = db.collection("themes").doc(String(theme.id));
  const courseName = theme.course || theme.courseName || legacyCourseName(Number(theme.id));
  const courseId = rememberCourse(courseName);
  const payload = {
    ...stats,
    ...(courseId ? { courseId } : {}),
    ...(courseName ? { course: courseName } : {}),
    ...(Number(theme.id) === TOP_5000_ID ? { hidden: true } : {}),
  };
  batch.set(ref, payload, { merge: true });
  ops += 1;
  if (ops >= 400) await flush();
}

for (const sub of subThemes) {
  const ref = db.collection("themes").doc(String(sub.id));
  batch.set(ref, sub, { merge: true });
  ops += 1;
  if (ops >= 400) await flush();
}

for (const [entryId, themeId] of top5kEntryThemeUpdates.entries()) {
  const ref = db.collection("entries").doc(entryId);
  batch.set(ref, { theme_id: themeId, theme: "Top 5000" }, { merge: true });
  ops += 1;
  if (ops >= 400) await flush();
}

for (const course of courseRecords.values()) {
  const ref = db.collection("courses").doc(course.id);
  batch.set(ref, course, { merge: true });
  ops += 1;
  if (ops >= 400) await flush();
}

await flush();

console.log(`  updated ${themes.length} theme docs`);
console.log(`  wrote ${subThemes.length} Top 5000 sub-theme docs (ids ${TOP_5000_SUB_BASE + 1}–${TOP_5000_SUB_BASE + subThemes.length})`);
console.log(`  wrote ${courseRecords.size} course docs`);
console.log("Done.");
