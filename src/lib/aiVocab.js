import { httpsCallable } from "firebase/functions";
import { doc, setDoc } from "firebase/firestore";
import { db, functions } from "./firebase";

export async function generateVocabSuggestions({ lesson, entries, prompt }) {
  const callable = httpsCallable(functions, "generateVocabSuggestions");
  const existingLemmas = (entries || []).map((e) => e.lemma).filter(Boolean);
  const result = await callable({
    lessonId: lesson.id,
    lessonTitle: lesson.title,
    prompt,
    existingLemmas,
  });
  const suggestions = result.data?.suggestions;
  if (!Array.isArray(suggestions)) throw new Error("Vocab generation returned no suggestions.");
  return suggestions;
}

export async function aiAssistVocabEntry({ entry, prompt }) {
  const callable = httpsCallable(functions, "aiAssistVocabEntry");
  const result = await callable({
    lemma: entry.lemma,
    article: entry.article || null,
    currentSenses: entry.english_senses || [],
    prompt,
  });
  const senses = result.data?.english_senses;
  if (!Array.isArray(senses)) throw new Error("AI assist returned no definitions.");
  return senses;
}

export async function saveNewVocabEntry({ entry, lessonId }) {
  const id = Date.now() * 1000 + Math.floor(Math.random() * 1000);
  const payload = {
    id,
    lemma: entry.lemma,
    term: entry.lemma,
    article: entry.article || null,
    english: (entry.english_senses || []).join("; "),
    english_senses: entry.english_senses || [],
    category: entry.category || "Ουσιαστικά",
    theme_id: lessonId,
    groupKeys: [],
    audio_available: false,
    createdAt: Date.now(),
    source: "ai",
  };
  await setDoc(doc(db, "entries", String(id)), payload);
  return payload;
}
