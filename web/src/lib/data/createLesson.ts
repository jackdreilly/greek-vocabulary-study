import { doc, serverTimestamp, setDoc, Timestamp } from "firebase/firestore";
import { db } from "../firebase";
import type { SkillLevel } from "../skillLevel";

function slugify(input: string) {
  const slug = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "lesson";
}

function titleFromPrompt(prompt: string) {
  const normalized = prompt.trim().replace(/\s+/g, " ");
  if (normalized.length <= 64) return normalized;
  return `${normalized.slice(0, 61).trim()}...`;
}

export async function createLessonStub({
  courseId,
  prompt,
  order,
  targetEntryCount = 24,
  skillLevel,
}: {
  courseId: string;
  prompt: string;
  order: number;
  targetEntryCount?: number;
  skillLevel?: SkillLevel;
}) {
  const trimmed = prompt.trim();
  if (!trimmed) throw new Error("Describe the lesson first.");

  const lessonId = `${slugify(trimmed)}-${Date.now().toString(36)}`;
  const title = titleFromPrompt(trimmed);

  const payload: Record<string, unknown> = {
    id: lessonId,
    courseId,
    title,
    subtitle: "Generating vocabulary.",
    description: trimmed,
    sourcePrompt: trimmed,
    targetEntryCount,
    order,
    status: "initializing",
    statusLog: [
      {
        at: Timestamp.now(),
        message: "Lesson request received.",
        source: "system",
      },
    ],
    counts: { entries: 0, plans: 0, games: 0 },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  if (skillLevel) payload.skillLevel = skillLevel;

  await setDoc(doc(db, "courses", courseId, "lessons", lessonId), payload);

  return lessonId;
}

