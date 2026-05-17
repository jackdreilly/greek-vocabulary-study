import { httpsCallable } from "firebase/functions";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  setDoc,
  where,
} from "firebase/firestore";
import { db, functions } from "./firebase";
import { entriesForAI } from "./aiGames";

const PLANS_COLLECTION = "lesson_ai_plans";

export async function loadLessonPlans(lessonId) {
  const q = query(collection(db, PLANS_COLLECTION), where("lessonId", "==", Number(lessonId)));
  const snapshot = await Promise.race([
    getDocs(q),
    new Promise((_, reject) => setTimeout(() => reject(new Error("Saved plans are still loading. Try again in a moment.")), 15000)),
  ]);
  return snapshot.docs
    .map((item) => item.data())
    .filter((item) => item.status !== "removed")
    .sort((a, b) => (Number(a.planNumber) || 0) - (Number(b.planNumber) || 0));
}

export async function saveLessonPlan(plan) {
  const payload = { ...plan, status: plan.status || "active", updatedAt: Date.now() };
  await setDoc(doc(db, PLANS_COLLECTION, String(payload.id)), payload, { merge: true });
  return payload;
}

export async function removeLessonPlan(plan) {
  await deleteDoc(doc(db, PLANS_COLLECTION, String(plan.id)));
}

export function planSummary(plan) {
  return {
    planNumber: plan.planNumber,
    title: plan.title,
    subtitle: plan.subtitle || "",
    coveredWords: (plan.coveredWords || []).slice(0, 30),
    coveredConcepts: (plan.coveredConcepts || []).slice(0, 12),
  };
}

export async function generateLessonPlan({ lesson, entries, previousPlans = [], preferences, customFocus = '' }) {
  const callable = httpsCallable(functions, "generateLessonPlan");
  const planNumber = (previousPlans.reduce((max, p) => Math.max(max, p.planNumber || 0), 0) || 0) + 1;
  const result = await callable({
    lessonId: lesson.id,
    lessonTitle: lesson.title,
    courseTitle: lesson.course || lesson.courseRecord?.title || '',
    courseDescription: (lesson.courseRecord?.description || '').slice(0, 5000),
    courseSourcePrompt: (lesson.courseRecord?.sourcePrompt || '').slice(0, 1200),
    lessonDescription: (lesson.description || '').slice(0, 8000),
    lessonSourcePrompt: (lesson.sourcePrompt || '').slice(0, 1200),
    planNumber,
    previousPlans: previousPlans.map(planSummary),
    entries: entriesForAI(entries).slice(0, 140),
    preferences,
    customFocus: customFocus || '',
  });
  const plan = result.data?.plan;
  if (!plan) throw new Error("Plan generation returned no plan.");
  return {
    ...plan,
    lessonId: lesson.id,
    planNumber,
    status: "active",
    generatedBy: "ai",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}
