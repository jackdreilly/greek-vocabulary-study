import { initializeApp } from "firebase/app";
import {
  initializeFirestore,
  connectFirestoreEmulator,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";

// Public config — these are not secrets. Pulled directly from Firebase Console.
const firebaseConfig = {
  projectId: "fanari-b6bb4",
  apiKey: "AIzaSyBfa-nar-i-b6bb4-placeholder-replace-me",
  authDomain: "fanari-b6bb4.firebaseapp.com",
  storageBucket: "fanari-b6bb4.firebasestorage.app",
};

export const app = initializeApp(firebaseConfig);

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
