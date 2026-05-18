import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";
import type { EntryDoc } from "./lessons.svelte";

export async function aiAssistVocabEntry({
  entry,
  prompt,
  currentSenses,
}: {
  entry: EntryDoc;
  prompt: string;
  currentSenses: string[];
}) {
  const callable = httpsCallable(functions, "aiAssistVocabEntry");
  const result = await callable({
    lemma: entry.lemma,
    article: entry.article ?? "",
    currentSenses,
    prompt,
  });
  const data = result.data as { english_senses?: string[] };
  if (!Array.isArray(data.english_senses)) throw new Error("AI assist returned no definitions.");
  return data.english_senses;
}

