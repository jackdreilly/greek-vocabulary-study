import { collection, doc, getDocs, orderBy, query, serverTimestamp, setDoc, Timestamp } from "firebase/firestore";
import { db } from "../firebase";

function nextPlanNumber(existing: Array<{ planNumber?: number }>) {
  return existing.reduce((max, plan) => Math.max(max, Number(plan.planNumber ?? 0)), 0) + 1;
}

export async function createPlanStub({
  courseId,
  lessonId,
  existingPlans,
  customFocus = "",
}: {
  courseId: string;
  lessonId: string;
  existingPlans?: Array<{ planNumber?: number }>;
  customFocus?: string;
}) {
  let plans = existingPlans;
  if (!plans) {
    const snap = await getDocs(query(collection(db, "courses", courseId, "lessons", lessonId, "plans"), orderBy("planNumber")));
    plans = snap.docs.map((item) => item.data() as { planNumber?: number });
  }

  const planNumber = nextPlanNumber(plans);
  const planId = `${lessonId}-plan-${planNumber}`;

  await setDoc(doc(db, "courses", courseId, "lessons", lessonId, "plans", planId), {
    id: planId,
    courseId,
    lessonId,
    planNumber,
    title: `Generating plan ${planNumber}`,
    subtitle: customFocus.trim() || "Choosing a fresh lesson angle.",
    customFocus: customFocus.trim(),
    estimatedMinutes: 8,
    coveredWords: [],
    coveredConcepts: [],
    widgets: [],
    status: "initializing",
    statusLog: [
      {
        at: Timestamp.now(),
        message: "Plan request received.",
        source: "system",
      },
    ],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return planId;
}
