import fs from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const ENV_PATH = path.join(ROOT, ".env");
const LEXILOGIO_PATH = path.join(ROOT, "public", "data", "lexilogio.json");
const OUTPUT_DATA_PATH = path.join(ROOT, "public", "data", "pexels-candidates.json");

// Manual .env parsing
const envContent = await fs.readFile(ENV_PATH, "utf8").catch(() => "");
const env = Object.fromEntries(
  envContent
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index), line.slice(index + 1)];
    })
);

const PEXELS_API_KEY = env.PEXELS_API_KEY;

if (!PEXELS_API_KEY) {
  console.error("Error: PEXELS_API_KEY not found in .env");
  process.exit(1);
}

async function searchPexels(query, perPage = 5) {
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${perPage}`;
  const response = await fetch(url, {
    headers: {
      Authorization: PEXELS_API_KEY,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Pexels API error: ${response.status} ${errorBody}`);
  }

  const data = await response.json();
  return data.photos ?? [];
}

const ABSTRACT_TERMS = new Set([
  "ability", "action", "affection", "age", "alternative", "anger", "beginning", "birth", "cause", "condition", "education", "feeling", "form", "human", "idea", "knowledge", "love", "meaning", "process", "quality", "relationship", "state", "term", "time", "use", "way"
]);

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

function queryFor(entry) {
  const senses = getSenses(entry).map(cleanSense).filter(Boolean);
  const primary = senses.find((sense) => {
    const words = sense.toLowerCase().split(/\s+/);
    return words.some((word) => word.length > 3 && !ABSTRACT_TERMS.has(word));
  });
  return primary ?? senses[0] ?? "";
}

async function main() {
  const data = JSON.parse(await fs.readFile(LEXILOGIO_PATH, "utf8"));
  // Pick 100 entries that have english translations and are likely to have good images
  // We'll prioritize nouns (Ουσιαστικά) and verbs (Ρήματα)
  const candidates = data.entries
    .filter(entry => entry.english && (entry.category === "Ουσιαστικά" || entry.category === "Ρήματα"))
    .slice(0, 100);

  console.log(`Processing ${candidates.length} entries...`);
  
  const results = {};
  let count = 0;

  for (const entry of candidates) {
    const query = queryFor(entry);
    if (!query) continue;

    console.log(`[${count + 1}/${candidates.length}] Querying Pexels for: "${query}"`);
    
    try {
      const photos = await searchPexels(query, 5);
      if (photos.length > 0) {
        results[entry.id] = {
          entry_id: entry.id,
          lemma: entry.lemma,
          query,
          candidates: photos.map(p => ({
            id: p.id,
            url: p.url,
            src: p.src.medium, // low-ish res for display
            thumbnail: p.src.small,
            photographer: p.photographer,
            photographer_url: p.photographer_url
          }))
        };
        count++;
      } else {
        console.warn(`  No results found for "${query}"`);
      }
    } catch (error) {
      console.error(`  Error processing "${query}":`, error.message);
    }

    // Small delay to be polite to API and stay under rate limits
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  const output = {
    generated_at: new Date().toISOString(),
    provider: "pexels",
    entries: results,
  };

  await fs.writeFile(OUTPUT_DATA_PATH, JSON.stringify(output, null, 2));
  console.log(`\nFinished! Saved candidates for ${count} entries to ${OUTPUT_DATA_PATH}`);
}

main().catch(console.error);
