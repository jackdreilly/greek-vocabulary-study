import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "genkit";
import { getDecodingFor, getModelFor } from "../ai/configResolver.js";
import { geminiApiKey, getAI } from "../ai/genkitClient.js";

const MessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(6000),
});

const YiayiaInputSchema = z.object({
  courseId: z.string().optional().default(""),
  lessonId: z.string().optional().default(""),
  planId: z.string().optional().default(""),
  tab: z.string().optional().default(""),
  pathname: z.string().optional().default(""),
  messages: z.array(MessageSchema).min(1).max(20),
});

async function readContext(input: z.infer<typeof YiayiaInputSchema>) {
  const db = getFirestore();
  const parts: string[] = [`Current app path: ${input.pathname || "(unknown)"}`];

  if (input.courseId) {
    const courseSnap = await db.doc(`courses/${input.courseId}`).get();
    const course = courseSnap.data();
    if (course) {
      parts.push(`Course: ${course.title ?? input.courseId}\n${course.subtitle ?? ""}\n${String(course.description ?? "").slice(0, 2500)}`);
      const summaries = Object.entries(course.lessonSummaries ?? {})
        .slice(0, 12)
        .map(([id, value]) => {
          const lesson = value as Record<string, unknown>;
          return `- ${id}: ${lesson.title ?? ""} (${lesson.status ?? ""})`;
        })
        .join("\n");
      if (summaries) parts.push(`Course lessons:\n${summaries}`);
    }
  }

  if (input.courseId && input.lessonId) {
    const lessonRef = db.doc(`courses/${input.courseId}/lessons/${input.lessonId}`);
    const [lessonSnap, entrySnap, gameSnap, planSnap] = await Promise.all([
      lessonRef.get(),
      lessonRef.collection("entries").orderBy("order").limit(60).get(),
      lessonRef.collection("games").limit(20).get(),
      lessonRef.collection("plans").orderBy("planNumber").limit(12).get(),
    ]);
    const lesson = lessonSnap.data();
    if (lesson) {
      parts.push(`Current lesson: ${lesson.title ?? input.lessonId}\n${lesson.subtitle ?? ""}\n${String(lesson.description ?? "").slice(0, 2500)}`);
    }
    const entries = entrySnap.docs
      .map((doc) => {
        const entry = doc.data();
        return `${entry.article ? `${entry.article} ` : ""}${entry.lemma} = ${entry.english}`;
      })
      .join("\n");
    if (entries) parts.push(`Current lesson vocabulary:\n${entries}`);

    const games = gameSnap.docs
      .map((doc) => {
        const game = doc.data();
        return `- ${game.type}: ${game.prompt}`;
      })
      .join("\n");
    if (games) parts.push(`Practice games on this lesson:\n${games}`);

    const plans = planSnap.docs
      .map((doc) => {
        const plan = doc.data();
        return `- Plan ${plan.planNumber}: ${plan.title}; concepts: ${(plan.coveredConcepts ?? []).join(", ")}`;
      })
      .join("\n");
    if (plans) parts.push(`Plans on this lesson:\n${plans}`);
  }

  if (input.courseId && input.lessonId && input.planId) {
    const planSnap = await db.doc(`courses/${input.courseId}/lessons/${input.lessonId}/plans/${input.planId}`).get();
    const plan = planSnap.data();
    if (plan) {
      const widgetSummary = (plan.widgets ?? [])
        .slice(0, 10)
        .map((widget: Record<string, unknown>) => `${widget.type}: ${widget.text ?? widget.title ?? widget.markdown ?? ""}`.slice(0, 260))
        .join("\n");
      parts.push(`Current plan: ${plan.title}\n${plan.subtitle ?? ""}\n${widgetSummary}`);
    }
  }

  return parts.filter(Boolean).join("\n\n---\n\n").slice(0, 12000);
}

export const yiayiaChat = onCall({ secrets: [geminiApiKey] }, async (request) => {
  const parsed = YiayiaInputSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", parsed.error.issues.map((issue) => issue.message).join("; "));
  }

  const input = parsed.data;
  const latest = input.messages[input.messages.length - 1];
  if (!latest || latest.role !== "user") {
    throw new HttpsError("invalid-argument", "Last message must be from the user.");
  }

  try {
    const [model, decoding, context] = await Promise.all([
      getModelFor("yiayiaChat"),
      getDecodingFor("yiayiaChat"),
      readContext(input),
    ]);

    const history = input.messages.slice(0, -1).map((message) => ({
      role: message.role === "assistant" ? ("model" as const) : ("user" as const),
      content: [{ text: message.content }],
    }));

    const { text } = await getAI().generate({
      model,
      config: {
        maxOutputTokens: 1800,
        ...decoding,
      },
      system: `You are Yiayia, a warm, precise Modern Greek tutor inside GreekFlash.
Use the provided app context first. Explain Greek clearly, with transliteration only when useful.
For learner questions, give direct help, a short example, and a tiny practice prompt when helpful.
Do not claim a feature is saved or changed unless the user explicitly asks and a tool/function actually did it.

APP CONTEXT:
${context}`,
      messages: history,
      prompt: latest.content,
    });

    return { message: text || "I am here, but I could not form a response." };
  } catch (err) {
    throw new HttpsError("internal", err instanceof Error ? err.message : String(err));
  }
});

