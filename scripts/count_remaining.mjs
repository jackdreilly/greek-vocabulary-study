import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, query, where } from "firebase/firestore";

const firebaseConfig = { projectId: "didibros-6d3ed", appId: "1:185254519770:web:344b0741e3508936acd6e3", storageBucket: "didibros-6d3ed.firebasestorage.app", apiKey: "AIzaSyDua8IVko5N8mcmC_flEG6n8rpXA-68vtM", authDomain: "didibros-6d3ed.firebaseapp.com" };
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, "greek-vocab");

async function run() {
  const q = query(collection(db, "entries"), where("category", "in", ["Ουσιαστικά", "Ρήματα", "Top 5000"]));
  const snapshot = await getDocs(q);
  
  let totalCandidates = 0;
  let remaining = 0;
  
  snapshot.forEach(doc => {
    const entry = doc.data();
    if (entry.category === "Top 5000") {
      const sub = entry.subsection?.toLowerCase() || "";
      const isNounOrVerb = /\b(n|v)(\.|\/|\b)/.test(sub);
      if (!isNounOrVerb) return;
    }
    
    totalCandidates++;
    
    // Check if it already has a storage URL
    if (entry.image?.source === "pexels" && entry.image.url?.includes("storage.googleapis.com")) {
      return;
    }
    
    remaining++;
  });
  
  console.log(`Total Candidates: ${totalCandidates}`);
  console.log(`Remaining to scrape: ${remaining}`);
  process.exit(0);
}
run();
