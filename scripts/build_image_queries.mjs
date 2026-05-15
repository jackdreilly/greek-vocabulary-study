import fs from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const DATA_PATH = path.join(ROOT, "public", "data", "lexilogio.json");
const OUT_DIR = path.join(ROOT, "public", "data", "image-queries");

const typeLabels = {
  "Ουσιαστικά": "noun",
  "Επίθετα": "adjective",
  "Ρήματα": "verb",
  "Εκφράσεις": "phrase",
  "Top 5000": "top5000",
};

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

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeCsv(rows) {
  const headers = [
    "entry_id",
    "theme_id",
    "theme",
    "category",
    "type",
    "subsection",
    "lemma",
    "primary_sense",
    "query",
    "query_status",
  ];
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(",")),
  ].join("\n") + "\n";
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

  if (!primary) {
    return { query: "", primarySense: getSenses(entry)[0] ?? "", status: "needs_review" };
  }

  const key = primary.toLowerCase().split(/\s+/)[0];
  if (QUERY_OVERRIDES.has(key)) {
    return { query: QUERY_OVERRIDES.get(key), primarySense: primary, status: "override" };
  }

  if (type === "verb") return { query: `${primary} action photo`, primarySense: primary, status: "generated" };
  if (type === "adjective") return { query: `${primary} example photo`, primarySense: primary, status: "generated" };
  if (type === "phrase") return { query: `${primary} photo`, primarySense: primary, status: "needs_review" };
  return { query: `${primary} photo`, primarySense: primary, status: "generated" };
}

const data = JSON.parse(await fs.readFile(DATA_PATH, "utf8"));
const rows = data.entries.map((entry) => {
  const type = typeLabels[entry.category] ?? "word";
  const { query, primarySense, status } = queryFor(entry, type);
  return {
    entry_id: entry.id,
    theme_id: entry.theme_id,
    theme: entry.theme,
    category: entry.category,
    type,
    subsection: entry.subsection ?? "",
    lemma: entry.lemma,
    primary_sense: primarySense,
    query,
    query_status: entry.english ? status : "no_english",
  };
});

await fs.mkdir(OUT_DIR, { recursive: true });
await fs.writeFile(path.join(OUT_DIR, "all.csv"), writeCsv(rows));

for (const type of [...new Set(rows.map((row) => row.type))].sort()) {
  await fs.writeFile(path.join(OUT_DIR, `${type}.csv`), writeCsv(rows.filter((row) => row.type === type)));
}

for (const themeId of [...new Set(rows.map((row) => row.theme_id))].sort((a, b) => a - b)) {
  const id = String(themeId).padStart(2, "0");
  await fs.writeFile(path.join(OUT_DIR, `lesson-${id}.csv`), writeCsv(rows.filter((row) => row.theme_id === themeId)));
}

const usable = rows.filter((row) => row.query).length;
const review = rows.filter((row) => row.query_status === "needs_review").length;
const noEnglish = rows.filter((row) => row.query_status === "no_english").length;

console.log(`Wrote ${rows.length.toLocaleString()} rows to ${path.relative(ROOT, OUT_DIR)}`);
console.log(`${usable.toLocaleString()} generated queries · ${review.toLocaleString()} need review · ${noEnglish.toLocaleString()} without English`);
