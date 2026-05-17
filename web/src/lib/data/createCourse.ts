import { doc, serverTimestamp, setDoc, Timestamp } from "firebase/firestore";
import { db } from "../firebase";

function slugify(input: string) {
  const slug = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "course";
}

function titleFromPrompt(prompt: string) {
  const normalized = prompt.trim().replace(/\s+/g, " ");
  if (normalized.length <= 72) return normalized;
  return `${normalized.slice(0, 69).trim()}...`;
}

export async function createCourseStub(sourcePrompt: string) {
  const trimmed = sourcePrompt.trim();
  if (!trimmed) throw new Error("Describe the course first.");

  const suffix = Date.now().toString(36);
  const courseId = `${slugify(trimmed)}-${suffix}`;

  await setDoc(doc(db, "courses", courseId), {
    id: courseId,
    title: titleFromPrompt(trimmed),
    sourcePrompt: trimmed,
    language: { source: "en", target: "el" },
    status: "initializing",
    statusLog: [
      {
        at: Timestamp.now(),
        message: "Course request received.",
        source: "system",
      },
    ],
    lessonSummaries: {},
    counts: { lessons: 0, entries: 0, plans: 0, games: 0 },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return courseId;
}
