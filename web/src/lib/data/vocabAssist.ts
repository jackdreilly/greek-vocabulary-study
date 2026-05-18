import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";
import type { EntryDoc } from "./lessons.svelte";

export async function aiAssistVocabEntry({
  entry,
  prompt,
  currentLemma,
  currentSenses,
}: {
  entry: EntryDoc;
  prompt: string;
  currentLemma: string;
  currentSenses: string[];
}) {
  const callable = httpsCallable(functions, "aiAssistVocabEntry");
  const result = await callable({
    lemma: currentLemma,
    article: entry.article ?? "",
    currentSenses,
    prompt,
  });
  const data = result.data as { lemma?: string; english_senses?: string[] };
  if (!Array.isArray(data.english_senses)) throw new Error("AI assist returned no definitions.");
  return {
    lemma: typeof data.lemma === "string" && data.lemma.trim() ? data.lemma.trim() : currentLemma,
    englishSenses: data.english_senses,
  };
}
