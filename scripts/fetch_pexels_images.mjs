import fs from "node:fs/promises";
import path from "node:path";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";

const ROOT = path.resolve(import.meta.dirname, "..");
const ENV_PATH = path.join(ROOT, ".env");

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
const INPUT_PATH = path.join(ROOT, "public", "data", "word-images.json");
const OUTPUT_DATA_PATH = path.join(ROOT, "public", "data", "pexels-images.json");
const IMAGES_DIR = path.join(ROOT, "public", "images", "pexels");

if (!PEXELS_API_KEY) {
  console.error("Error: PEXELS_API_KEY not found in .env");
  process.exit(1);
}

async function downloadImage(url, destPath) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch image: ${response.statusText}`);
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  const writer = createWriteStream(destPath);
  const stream = response.body;
  await pipeline(stream, writer);
}

async function searchPexels(query) {
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1`;
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
  return data.photos?.[0] ?? null;
}

async function main() {
  const inputData = JSON.parse(await fs.readFile(INPUT_PATH, "utf8"));
  const entries = Object.values(inputData.entries);
  
  console.log(`Processing up to 20 entries from ${INPUT_PATH}...`);
  
  const results = {};
  let count = 0;

  for (const entry of entries) {
    if (count >= 20) break;

    // Remove "photo" suffix (and variants like " action photo", " example photo")
    let query = entry.query;
    query = query.replace(/\s+(action|example)?\s*photo$/i, "").trim();
    
    console.log(`[${count + 1}/20] Querying Pexels for: "${query}" (original: "${entry.query}")`);
    
    try {
      const photo = await searchPexels(query);
      if (photo) {
        // Use 'medium' for low-ish resolution but still clear
        const imageUrl = photo.src.medium;
        const ext = path.extname(new URL(imageUrl).pathname) || ".jpg";
        const filename = `${entry.entry_id}${ext}`;
        const localPath = path.join(IMAGES_DIR, filename);
        const relativePath = path.join("images", "pexels", filename);

        console.log(`  Downloading image to ${relativePath}...`);
        await downloadImage(imageUrl, localPath);

        results[entry.entry_id] = {
          entry_id: entry.entry_id,
          lemma: entry.lemma,
          original_query: entry.query,
          pexels_query: query,
          image_path: relativePath,
          pexels_id: photo.id,
          photographer: photo.photographer,
          photographer_url: photo.photographer_url,
          pexels_url: photo.url,
        };
        count++;
      } else {
        console.warn(`  No results found for "${query}"`);
      }
    } catch (error) {
      console.error(`  Error processing "${query}":`, error.message);
    }

    // Small delay to be polite to API
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  const output = {
    generated_at: new Date().toISOString(),
    provider: "pexels",
    entries: results,
  };

  await fs.writeFile(OUTPUT_DATA_PATH, JSON.stringify(output, null, 2));
  console.log(`\nFinished! Saved ${count} images and metadata to ${OUTPUT_DATA_PATH}`);
}

main().catch(console.error);
