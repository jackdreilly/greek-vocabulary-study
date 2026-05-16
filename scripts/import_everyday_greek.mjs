import { Firestore } from "@google-cloud/firestore";
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const DATA_PATH = path.join(ROOT, "data", "everyday_greek.json");
const PROJECT_ID = "didibros-6d3ed";
const DATABASE_ID = "greek-vocab";

const db = new Firestore({ projectId: PROJECT_ID, databaseId: DATABASE_ID });

const raw = JSON.parse(await fs.readFile(DATA_PATH, "utf8"));
console.log(`Loaded ${raw.themes.length} themes, ${raw.entries.length} entries`);

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

async function writeBatch(docs, collectionName, keyFn) {
  const CHUNK = 400;
  let written = 0;
  for (let i = 0; i < docs.length; i += CHUNK) {
    const batch = db.batch();
    for (const doc of docs.slice(i, i + CHUNK)) {
      batch.set(db.collection(collectionName).doc(String(keyFn(doc))), doc);
    }
    await batch.commit();
    written += Math.min(CHUNK, docs.length - i);
    console.log(`  ${collectionName}: ${written}/${docs.length}`);
  }
}

const courses = new Map();
const themes = raw.themes.map((theme) => {
  const courseTitle = theme.course || theme.courseName || "Other";
  const courseId = theme.courseId || courseIdFromName(courseTitle);
  courses.set(courseId, { id: courseId, title: courseTitle, updatedAt: Date.now() });
  return { ...theme, courseId };
});

console.log("Writing courses...");
await writeBatch([...courses.values()], "courses", (c) => c.id);

console.log("Writing themes...");
await writeBatch(themes, "themes", (t) => t.id);

console.log("Writing entries...");
await writeBatch(raw.entries, "entries", (e) => e.id);

console.log("Done.");
