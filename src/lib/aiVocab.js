import { httpsCallable } from "firebase/functions";
import { doc, setDoc } from "firebase/firestore";
import { db, functions } from "./firebase";

function courseIdFromName(name) {
  const base = String(name || "course")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || `course-${Date.now()}`;
}

export async function generateVocabSuggestions({ lesson, entries, prompt }) {
  const callable = httpsCallable(functions, "generateVocabSuggestions");
  const existingLemmas = (entries || []).map((e) => e.lemma).filter(Boolean);
  const result = await callable({
    lessonId: lesson.id,
    lessonTitle: lesson.title,
    courseTitle: lesson.course || lesson.courseRecord?.title || "",
    courseDescription: (lesson.courseRecord?.description || "").slice(0, 5000),
    lessonDescription: (lesson.description || "").slice(0, 8000),
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

export async function generateLessonContent({ prompt, courseName = '', lessonTitles = [], generateCourseName = false }) {
  const callable = httpsCallable(functions, "generateLessonContent");
  const result = await callable({ prompt, courseName, existingLessonTitles: lessonTitles, generateCourseName });
  const data = result.data;
  if (!data?.lessonTitle || !Array.isArray(data?.entries)) throw new Error("Lesson generation returned no content.");
  return data;
}

export async function saveNewLesson({ lessonTitle, courseName, courseId = '', entries, lessonDescription = '', courseDescription = '' }) {
  const themeId = Date.now() * 1000 + Math.floor(Math.random() * 1000);
  const resolvedCourseId = courseId || courseIdFromName(courseName);
  const coursePayload = {
    id: resolvedCourseId,
    title: courseName,
    updatedAt: Date.now(),
  };
  if (courseDescription) coursePayload.description = courseDescription;
  await setDoc(doc(db, "courses", resolvedCourseId), coursePayload, { merge: true });

  const theme = { id: themeId, title: lessonTitle, courseId: resolvedCourseId, course: courseName };
  if (lessonDescription) theme.description = lessonDescription;
  await setDoc(doc(db, "themes", String(themeId)), theme);
  const savedEntries = await Promise.all(entries.map(e => saveNewVocabEntry({ entry: e, lessonId: themeId })));
  return { theme: { ...theme, entry_count: savedEntries.length, translated_count: savedEntries.length, audio_count: 0 }, entries: savedEntries };
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
