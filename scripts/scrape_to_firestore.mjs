import { Firestore } from "@google-cloud/firestore";
import { Storage } from "@google-cloud/storage";
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SERVICE_ACCOUNT_PATH = path.join(ROOT, "service-account-key.json");
const DOTENV_PATH = path.join(ROOT, ".env");

const db = new Firestore({
  projectId: "didibros-6d3ed",
  databaseId: "greek-vocab"
});

const storage = new Storage({
  projectId: "didibros-6d3ed"
});

const bucket = storage.bucket("didibros-6d3ed.firebasestorage.app");

const envContent = await fs.readFile(DOTENV_PATH, "utf8");
const PEXELS_API_KEY = envContent.split("\n").find(line => line.startsWith("PEXELS_API_KEY="))?.split("=")[1];

if (!PEXELS_API_KEY) {
  console.error("PEXELS_API_KEY not found in .env");
  process.exit(1);
}

async function uploadToStorage(imageUrl, filename) {
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    const file = bucket.file(`images/pexels/${filename}`);
    await file.save(buffer, {
      contentType: "image/jpeg",
      public: true
    });
    return `https://storage.googleapis.com/${bucket.name}/${file.name}`;
  } catch (err) {
    console.error("Upload error:", err);
    return null;
  }
}

async function searchPexels(query) {
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1`;
  const response = await fetch(url, {
    headers: { Authorization: PEXELS_API_KEY }
  });
  if (!response.ok) return null;
  const data = await response.json();
  return data.photos?.[0] || null;
}

async function scrape() {
  const snapshot = await db.collection("entries")
    .where("category", "in", ["Ουσιαστικά", "Ρήματα", "Top 5000"])
    .get();

  console.log(`Found ${snapshot.size} candidate entries.`);
  
  let count = 0;
  for (const doc of snapshot.docs) {
    const entry = doc.data();
    
    // For Top 5000, only include if it's a noun or verb via subsection
    if (entry.category === "Top 5000") {
      const sub = entry.subsection?.toLowerCase() || "";
      const isNounOrVerb = /\b(n|v)(\.|\/|\b)/.test(sub);
      if (!isNounOrVerb) continue;
    }
    
    // Skip if already has a pexels image that is already hosted in Storage
    if (entry.image?.source === "pexels" && entry.image.url?.includes("storage.googleapis.com")) {
        console.log(`[SKIPPING] ${entry.lemma} already hosted in Storage.`);
        continue;
    }

    let photo = null;
    const isBackfill = entry.image?.source === "pexels" && !entry.image.url?.includes("storage.googleapis.com");

    if (isBackfill) {
      console.log(`[BACKFILLING] ${entry.lemma} (Pexels ID: ${entry.image.pexels_id})`);
      // Use existing metadata for backfill
      photo = {
        id: entry.image.pexels_id,
        src: { medium: entry.image.thumbnail || entry.image.url },
        photographer: entry.image.creator,
        url: entry.image.landing_url
      };
    } else {
      const query = entry.english_senses?.[0] || entry.english || entry.lemma;
      console.log(`[${count+1}/${snapshot.size}] Searching Pexels for "${query}" (${entry.lemma})...`);
      photo = await searchPexels(query);
    }

    if (photo) {
      const storageUrl = await uploadToStorage(photo.src.medium, `${photo.id}.jpg`);
      
      await doc.ref.update({
        image: {
          ...entry.image,
          url: storageUrl || photo.src.original || photo.src.medium,
          thumbnail: storageUrl || photo.src.medium,
          title: entry.lemma,
          creator: photo.photographer || entry.image?.creator,
          landing_url: photo.url || entry.image?.landing_url,
          source: "pexels",
          pexels_id: photo.id,
          position: entry.image?.position || "center"
        }
      });
      console.log(`  ${isBackfill ? "Backfilled" : "Updated"} and uploaded photo ${photo.id}`);
    } else {
      console.log("  No photo found.");
    }

    count++;
    
    // Delay to stay within Pexels rate limit (200 req/hr = ~18s delay)
    await new Promise(r => setTimeout(r, 20000));
  }
}

scrape().catch(console.error);
