import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs } from "firebase/firestore";

const firebaseConfig = {
  projectId: "didibros-6d3ed",
  appId: "1:185254519770:web:344b0741e3508936acd6e3",
  storageBucket: "didibros-6d3ed.firebasestorage.app",
  apiKey: "AIzaSyDua8IVko5N8mcmC_flEG6n8rpXA-68vtM",
  authDomain: "didibros-6d3ed.firebaseapp.com"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app, "greek-vocab");

async function run() {
  const snapshot = await getDocs(collection(db, "entries"));
  let count = 0;
  snapshot.forEach(doc => {
    if (doc.data().image) count++;
  });
  console.log(`Words with images: ${count}`);
  process.exit(0);
}
run();
