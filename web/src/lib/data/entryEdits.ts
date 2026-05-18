import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { db, storage } from "../firebase";
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

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

export async function saveEntryEdit(input: {
  courseId: string;
  lessonId: string;
  entryId: string;
  lemma: string;
  english: string;
  senses: string[];
  image?: EntryDoc["image"];
  audio?: EntryDoc["audio"];
}) {
  await updateDoc(doc(db, "courses", input.courseId, "lessons", input.lessonId, "entries", input.entryId), {
    lemma: input.lemma.trim(),
    english: input.english.trim(),
    senses: input.senses.map((s) => s.trim()).filter(Boolean),
    image: input.image ?? null,
    audio: input.audio ?? null,
    updatedAt: serverTimestamp(),
  });
}

export async function uploadAudio(
  courseId: string,
  lessonId: string,
  entryId: string,
  blob: Blob,
): Promise<NonNullable<EntryDoc["audio"]>> {
  const ext = blob.type.includes("ogg") ? "ogg" : "webm";
  const storagePath = `audio/${courseId}/${lessonId}/${entryId}.${ext}`;
  const storageRef = ref(storage, storagePath);
  await uploadBytes(storageRef, blob, { contentType: blob.type });
  const url = await getDownloadURL(storageRef);
  return { url, storagePath };
}

export async function deleteAudio(storagePath: string): Promise<void> {
  await deleteObject(ref(storage, storagePath));
}

export async function searchPexelsImages(query: string) {
  const url = `/api/pexels-search?query=${encodeURIComponent(query)}&per_page=6&orientation=landscape`;
  const result = await fetch(url);
  if (!result.ok) throw new Error(`Pexels search failed (${result.status})`);
  const data = await result.json();
  return ((data as { photos?: PexelsPhoto[] }).photos ?? []);
}

export function imageFromPexels(photo: PexelsPhoto): EntryImage {
  return compact({
    url: photo.src.large ?? photo.src.medium ?? photo.src.small ?? "",
    thumbnail: photo.src.medium ?? photo.src.small,
    position: "center",
    photographer: photo.photographer,
    pexelsUrl: photo.pexelsUrl,
  });
}
