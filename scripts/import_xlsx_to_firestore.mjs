import { Firestore } from "@google-cloud/firestore";
import { Storage } from "@google-cloud/storage";
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const DATA_PATH = path.join(ROOT, "public", "data", "lexilogio.json");
const ENV_PATH = path.join(ROOT, ".env");
const PROJECT_ID = "didibros-6d3ed";
const DATABASE_ID = "greek-vocab";
const BUCKET_NAME = "didibros-6d3ed.firebasestorage.app";
const FIRST_XLSX_THEME_ID = 14;

const args = new Set(process.argv.slice(2));
const fillImages = !args.has("--skip-images");

const envContent = await fs.readFile(ENV_PATH, "utf8").catch(() => "");
const env = Object.fromEntries(
  envContent
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index), line.slice(index + 1)];
    }),
);

const PIXABAY_API_KEY = env.PIXABAY_API_KEY;
if (fillImages && !PIXABAY_API_KEY) {
  console.error("PIXABAY_API_KEY not found in .env");
  process.exit(1);
}

const db = new Firestore({ projectId: PROJECT_ID, databaseId: DATABASE_ID });
const storage = new Storage({ projectId: PROJECT_ID });
const bucket = storage.bucket(BUCKET_NAME);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanSense(value) {
  return String(value ?? "")
    .replace(/\([^)]*\)/g, " ")
    .split(/[;,:]/)[0]
    .replace(/\b(a|an|the|I)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstSense(entry) {
  if (Array.isArray(entry.english_senses) && entry.english_senses.length) {
    return entry.english_senses[0];
  }
  return entry.english ?? entry.lemma;
}

function imageQuery(entry) {
  const sense = cleanSense(firstSense(entry));
  const base = sense || entry.lemma;
  if (entry.category === "Ρήματα") return `${base} action`;
  if (entry.category === "Επίθετα") return `${base} example`;
  return base;
}

async function searchPixabay(query) {
  const url = new URL("https://pixabay.com/api/");
  url.searchParams.set("key", PIXABAY_API_KEY);
  url.searchParams.set("q", query);
  url.searchParams.set("per_page", "3");
  url.searchParams.set("safesearch", "true");
  url.searchParams.set("image_type", "photo");
  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Pixabay ${response.status}: ${body}`);
  }
  const data = await response.json();
  return data.hits?.[0] ?? null;
}

async function uploadToStorage(imageUrl, filename) {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Image download ${response.status} for ${imageUrl}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const file = bucket.file(`images/pexels/${filename}`);
  await file.save(buffer, {
    contentType: response.headers.get("content-type") ?? "image/jpeg",
    public: true,
  });
  return `https://storage.googleapis.com/${bucket.name}/${file.name}`;
}

async function addImage(entry) {
  const query = imageQuery(entry);
  if (!query) return entry;

  const photo = await searchPixabay(query);
  if (!photo) {
    console.log(`  no image: ${entry.lemma} (${query})`);
    return entry;
  }

  const storageUrl = await uploadToStorage(photo.webformatURL, `pixabay_${photo.id}.jpg`);
  console.log(`  image: ${entry.lemma} <- ${query} (${photo.id})`);
  return {
    ...entry,
    image: {
      url: storageUrl,
      thumbnail: storageUrl,
      title: entry.lemma,
      creator: photo.user ?? null,
      landing_url: photo.pageURL ?? null,
      source: "pixabay",
      pexels_id: photo.id,
      position: "center",
    },
  };
}

async function commitDocuments(themes, entries) {
  let batch = db.batch();
  let pending = 0;
  const commit = async () => {
    if (!pending) return;
    await batch.commit();
    batch = db.batch();
    pending = 0;
  };

  for (const theme of themes) {
    batch.set(db.collection("themes").doc(String(theme.id)), theme, { merge: true });
    pending++;
  }

  for (const entry of entries) {
    batch.set(db.collection("entries").doc(String(entry.id)), entry, { merge: true });
    pending++;
    if (pending >= 450) await commit();
  }

  await commit();
}

const data = JSON.parse(await fs.readFile(DATA_PATH, "utf8"));
const entries = data.entries.filter((entry) => entry.entry_source === "xlsx");
const themeIds = new Set(entries.map((entry) => entry.theme_id));
const themes = data.themes.filter(
  (theme) => theme.id >= FIRST_XLSX_THEME_ID && themeIds.has(theme.id),
);

console.log(`Importing ${entries.length} xlsx entries across ${themes.length} themes.`);

const entriesWithImages = [];
for (let index = 0; index < entries.length; index++) {
  const entry = entries[index];
  console.log(`[${index + 1}/${entries.length}] ${entry.lemma}`);
  entriesWithImages.push(fillImages ? await addImage(entry) : entry);
  if (fillImages) await sleep(650);
}

await commitDocuments(themes, entriesWithImages);

const imageCount = entriesWithImages.filter((entry) => entry.image).length;
console.log(`Imported ${entriesWithImages.length} entries and ${imageCount} images.`);
