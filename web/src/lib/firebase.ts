import { initializeApp, getApps, getApp } from "firebase/app";
import {
  initializeFirestore,
  connectFirestoreEmulator,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";

// Public config — these are not secrets. Pulled directly from
// Firebase Console > Project Settings > General > Your apps.
const firebaseConfig = {
  apiKey: "AIzaSyAGMVfXYL9UaWTJjXi563Ntr3yA8QZMXrI",
  authDomain: "fanari-b6bb4.firebaseapp.com",
  projectId: "fanari-b6bb4",
  storageBucket: "fanari-b6bb4.firebasestorage.app",
  messagingSenderId: "899460998724",
  appId: "1:899460998724:web:9e9fabe68affee29fa3e11",
  measurementId: "G-L0YSQ8NVQY",
};

// Idempotent init — Vite HMR may re-execute this module.
export const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

export const functions = getFunctions(app, "us-central1");

export function isEmulator(): boolean {
  return (
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
  );
}

if (isEmulator()) {
  try {
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
    connectFunctionsEmulator(functions, "127.0.0.1", 5001);
    console.info("[firebase] Connected to local emulators.");
  } catch (err) {
    console.warn("[firebase] Emulator connection failed:", err);
  }
}
