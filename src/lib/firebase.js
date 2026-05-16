import { initializeApp } from "firebase/app";
import { initializeFirestore, persistentLocalCache, persistentSingleTabManager } from "firebase/firestore";
import { getFunctions } from "firebase/functions";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  projectId: "didibros-6d3ed",
  appId: "1:185254519770:web:344b0741e3508936acd6e3",
  storageBucket: "didibros-6d3ed.firebasestorage.app",
  apiKey: "AIzaSyDua8IVko5N8mcmC_flEG6n8rpXA-68vtM",
  authDomain: "didibros-6d3ed.firebaseapp.com",
  messagingSenderId: "185254519770",
  measurementId: "G-V3NVQH0FQS"
};

const app = initializeApp(firebaseConfig);
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentSingleTabManager() })
}, "greek-vocab");

export const storage = getStorage(app);
export const functions = getFunctions(app, "us-central1");
