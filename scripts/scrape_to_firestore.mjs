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
const PIXABAY_API_KEY = envContent.split("\n").find(line => line.startsWith("PIXABAY_API_KEY="))?.split("=")[1];

if (!PIXABAY_API_KEY) {
  console.error("PIXABAY_API_KEY not found in .env");
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

async function searchPixabay(query) {
  const url = `https://pixabay.com/api/?key=${PIXABAY_API_KEY}&q=${encodeURIComponent(query)}&per_page=3`;
  const response = await fetch(url);
  if (!response.ok) return null;
  const data = await response.json();
  return data.hits?.[0] || null;
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
      // Re-upload existing image to Storage from its current URL
      const existingUrl = entry.image.thumbnail || entry.image.url;
      if (!existingUrl) {
        console.log(`[BACKFILL SKIP] ${entry.lemma} — no existing URL to upload.`);
        count++;
        continue;
      }
      console.log(`[BACKFILLING] ${entry.lemma} (ID: ${entry.image.pexels_id})`);
      const filename = `pixabay_${entry.image.pexels_id}.jpg`;
      const storageUrl = await uploadToStorage(existingUrl, filename);
      await doc.ref.update({
        image: {
          ...entry.image,
          url: storageUrl || existingUrl,
          thumbnail: storageUrl || existingUrl,
        }
      });
      console.log(`  Backfilled and uploaded ${entry.image.pexels_id}`);
    } else {
      let rawQuery = entry.english_senses?.[0] || entry.english || entry.lemma;
      let query = rawQuery.replace(/\(.*?\)/g, '').split(',')[0].split(';')[0].trim();
      if (!query) query = entry.lemma;
      console.log(`[${count+1}/${snapshot.size}] Searching Pixabay for "${query}" (${entry.lemma})...`);
      const photo = await searchPixabay(query);

      if (photo) {
        const storageUrl = await uploadToStorage(photo.webformatURL, `pixabay_${photo.id}.jpg`);
        const finalUrl = storageUrl || photo.largeImageURL || photo.webformatURL;
        if (!finalUrl) {
          console.log(`  Skipping — could not resolve URL.`);
        } else {
          await doc.ref.update({
            image: {
              ...entry.image,
              url: finalUrl,
              thumbnail: storageUrl || photo.webformatURL,
              title: entry.lemma,
              creator: photo.user || entry.image?.creator,
              landing_url: photo.pageURL || entry.image?.landing_url,
              source: "pixabay",
              pexels_id: photo.id,
              position: entry.image?.position || "center"
            }
          });
          console.log(`  Updated and uploaded photo ${photo.id}`);
        }
      } else {
        console.log("  No photo found.");
      }
    }

    count++;
    // Pixabay rate limit: 100 req/min (~600ms per request). We use 650ms to be safe.
    await new Promise(r => setTimeout(r, 650));
  }
}

scrape().catch(console.error);
