import fs from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const DATA_PATH = path.join(ROOT, "public", "data", "lexilogio.json");
const OUTPUT_PATH = path.join(ROOT, "public", "data", "word-images.json");
const OPENVERSE_IMAGES_URL = "https://api.openverse.org/v1/images/";

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value = "true"] = arg.replace(/^--/, "").split("=");
    return [key, value];
  }),
);

const limitPerType = Number(args.get("limit-per-type") ?? 10);
const pageSize = Number(args.get("page-size") ?? 8);
const lessonId = Number(args.get("lesson") ?? 12);
const source = args.get("source") ?? "wikimedia";
const outputPath = args.get("output")
  ? path.resolve(ROOT, args.get("output"))
  : OUTPUT_PATH;

const TARGETS = [
  { category: "Ουσιαστικά", type: "noun" },
  { category: "Ρήματα", type: "verb" },
];

const ABSTRACT_TERMS = new Set([
  "ability",
  "action",
  "affection",
  "age",
  "alternative",
  "anger",
  "beginning",
  "birth",
  "cause",
  "condition",
  "education",
  "feeling",
  "form",
  "human",
  "idea",
  "knowledge",
  "love",
  "meaning",
  "process",
  "quality",
  "relationship",
  "state",
  "term",
  "time",
  "use",
  "way",
]);

const QUERY_OVERRIDES = new Map([
  ["amphibian", "amphibian photo"],
  ["bark", "barking dog"],
  ["bite", "animal biting"],
  ["bray", "braying donkey"],
  ["climb", "climbing animal"],
  ["feed", "feeding animals"],
  ["herd", "herd animals"],
  ["insect", "insect photo"],
  ["meow", "meowing cat"],
  ["milk", "cow milking"],
  ["neigh", "neighing horse"],
  ["reptile", "reptile photo"],
  ["seafood", "seafood photo"],
  ["shepherd", "shepherd with sheep"],
  ["swim", "swimming animal"],
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getSenses(entry) {
  if (Array.isArray(entry.english_senses) && entry.english_senses.length) {
    return entry.english_senses;
  }
  return entry.english ? entry.english.split(/\s*;\s*/).filter(Boolean) : [];
}

function cleanSense(value) {
  const raw = String(value ?? "");
  if (/\bvariant of\b/i.test(raw)) return "";
  return raw
    .replace(/\([^)]*\)/g, " ")
    .replace(/\bAlternative form of\b.*$/i, "")
    .replace(/\b(form|inflection) of\b.*$/i, "")
    .split(/[;,:]/)[0]
    .replace(/\b(a|an|the)\b/gi, " ")
    .replace(/^I\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function queryFor(entry, type) {
  const senses = getSenses(entry).map(cleanSense).filter(Boolean);
  const primary = senses.find((sense) => {
    const words = sense.toLowerCase().split(/\s+/);
    return words.some((word) => word.length > 3 && !ABSTRACT_TERMS.has(word));
  });
  if (!primary) return "";
  const key = primary.toLowerCase().split(/\s+/)[0];
  if (QUERY_OVERRIDES.has(key)) return QUERY_OVERRIDES.get(key);
  return type === "verb" ? `${primary} action photo` : `${primary} photo`;
}

function pickEntries(entries, category, type) {
  const seenQueries = new Set();
  const picked = [];

  for (const entry of entries) {
    if (entry.category !== category || !entry.english) continue;
    const query = queryFor(entry, type);
    if (!query || seenQueries.has(query.toLowerCase())) continue;
    seenQueries.add(query.toLowerCase());
    picked.push({ entry, query });
    if (picked.length >= limitPerType) break;
  }

  return picked;
}

async function searchOpenverse(query) {
  const url = new URL(OPENVERSE_IMAGES_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("page_size", String(pageSize));
  url.searchParams.set("source", source);

  const response = await fetch(url, {
    headers: { "User-Agent": "greekflash-image-prototype/0.1" },
  });

  if (!response.ok) {
    throw new Error(`Openverse ${response.status} for "${query}"`);
  }

  const payload = await response.json();
  return payload.results ?? [];
}

function isUsableImage(result) {
  if (!result || result.mature) return false;
  if (!result.thumbnail && !result.url) return false;
  if (result.width && result.width < 220) return false;
  if (result.height && result.height < 180) return false;
  return !String(result.url ?? "").toLowerCase().endsWith(".svg");
}

function compactImage(result) {
  if (!result) return null;
  return {
    title: result.title,
    url: result.url,
    thumbnail: result.url || result.thumbnail,
    landing_url: result.foreign_landing_url,
    creator: result.creator,
    license: result.license,
    license_version: result.license_version,
    license_url: result.license_url,
    source: result.source,
  };
}

const data = JSON.parse(await fs.readFile(DATA_PATH, "utf8"));
const sourceEntries = data.entries.filter((entry) => !lessonId || entry.theme_id === lessonId);
const samples = TARGETS.flatMap(({ category, type }) =>
  pickEntries(sourceEntries, category, type).map(({ entry, query }) => ({
    type,
    entry,
    query,
  })),
);

const records = [];

for (const sample of samples) {
  const candidates = await searchOpenverse(sample.query);
  const image = candidates.find(isUsableImage) ?? candidates[0];
  records.push({
    entry_id: sample.entry.id,
    lemma: sample.entry.lemma,
    type: sample.type,
    query: sample.query,
    image: compactImage(image),
    candidates: candidates.slice(0, 3).map(compactImage).filter(Boolean),
  });
  await sleep(175);
}

const payload = {
  generated_at: new Date().toISOString(),
  provider: "openverse",
  source,
  lesson_id: lessonId || null,
  entries: Object.fromEntries(records.filter((record) => record.image).map((record) => [record.entry_id, record])),
};

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`);

for (const record of records) {
  console.log(`${record.type.padEnd(4)} ${record.lemma} -> ${record.query} -> ${record.image?.title ?? "no result"}`);
}
console.log(`Wrote ${Object.keys(payload.entries).length} image records to ${path.relative(ROOT, outputPath)}`);
