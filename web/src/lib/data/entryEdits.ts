import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "../firebase";
import type { EntryDoc } from "./lessons.svelte";

export type PexelsPhoto = {
  id: number;
  alt?: string;
  photographer?: string;
  photographerUrl?: string;
  pexelsUrl?: string;
  src: { small?: string; medium?: string; large?: string };
};

export type EntryImage = NonNullable<EntryDoc["image"]>;

export async function saveEntryEdit(input: {
  courseId: string;
  lessonId: string;
  entryId: string;
  english: string;
  senses: string[];
  image?: EntryDoc["image"];
}) {
  await updateDoc(doc(db, "courses", input.courseId, "lessons", input.lessonId, "entries", input.entryId), {
    english: input.english.trim(),
    senses: input.senses.map((s) => s.trim()).filter(Boolean),
    image: input.image ?? null,
    updatedAt: serverTimestamp(),
  });
}

export async function searchPexelsImages(query: string) {
  const url = `/api/pexels-search?query=${encodeURIComponent(query)}&per_page=6&orientation=landscape`;
  const result = await fetch(url);
  if (!result.ok) throw new Error(`Pexels search failed (${result.status})`);
  const data = await result.json();
  return ((data as { photos?: PexelsPhoto[] }).photos ?? []);
}

export function imageFromPexels(photo: PexelsPhoto): EntryImage {
  return {
    url: photo.src.large ?? photo.src.medium ?? photo.src.small ?? "",
    thumbnail: photo.src.medium ?? photo.src.small,
    position: "center",
    photographer: photo.photographer,
    pexelsUrl: photo.pexelsUrl,
  };
}
