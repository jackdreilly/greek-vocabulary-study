import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "genkit";
import { getDecodingFor, getModelFor } from "../ai/configResolver.js";
import { geminiApiKey, getAI } from "../ai/genkitClient.js";
import { ALLOWED_ORIGINS } from "../cors.js";
import { SKILL_LEVEL_LABELS, SkillLevelSchema, type SkillLevel } from "../schemas/common.js";

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
  focusedWords: z.array(z.string()).optional().default([]),
});

async function readContext(input: z.infer<typeof YiayiaInputSchema>) {
  const db = getFirestore();
  const parts: string[] = [`Current app path: ${input.pathname || "(unknown)"}`];

  // Focal words — the specific item the user is looking at right now.
  // Must appear before generic lesson vocab so the AI treats it as highest priority.
  if (input.focusedWords && input.focusedWords.length > 0) {
    parts.push(
      `CURRENTLY FOCUSED WORDS (user is actively looking at these right now):\n${input.focusedWords.join(", ")}\n\nWhen answering about a specific word, prioritize these over other lesson vocabulary.`
    );
  }

  let skillLevel: SkillLevel | undefined;

  if (input.courseId) {
    const courseSnap = await db.doc(`courses/${input.courseId}`).get();
    const course = courseSnap.data();
    if (course) {
      const courseLevel = SkillLevelSchema.safeParse(course.skillLevel);
      if (courseLevel.success) skillLevel = courseLevel.data;
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
      const lessonLevel = SkillLevelSchema.safeParse(lesson.skillLevel);
      if (lessonLevel.success) skillLevel = lessonLevel.data;
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

  if (skillLevel) {
    parts.unshift(
      `Learner skill level: ${skillLevel} — ${SKILL_LEVEL_LABELS[skillLevel]}\nCalibrate your explanations, vocabulary, and Greek examples to this exact level. Do not exceed it unless the learner asks.`,
    );
  }

  return parts.filter(Boolean).join("\n\n---\n\n").slice(0, 12000);
}

export const yiayiaChat = onCall({ secrets: [geminiApiKey], cors: ALLOWED_ORIGINS }, async (request, response) => {
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

    const isFirstTurn = history.length === 0;
    const continuityRule = isFirstTurn
      ? "This is the first turn — a brief warm opener is fine, but skip it if the learner asked a direct question."
      : "This is a mid-conversation turn. DO NOT start with greetings, welcomes, or re-introductions (no \"Welcome back\", \"Hello again\", \"Of course!\", \"Great question!\", or similar fresh-start openers). Just continue the conversation naturally — answer as if the previous turn happened seconds ago, because it did. Pick up where you left off; reference earlier turns when relevant.";

    const systemPrompt = `You are Yiayia, a warm, precise Modern Greek tutor inside GreekFlash.
Use the provided app context first. Explain Greek clearly, with transliteration only when useful.
For learner questions, give direct help, a short example, and a tiny practice prompt when helpful.
Do not claim a feature is saved or changed unless the user explicitly asks and a tool/function actually did it.

CONVERSATIONAL CONTINUITY: ${continuityRule}

When the learner writes in Greek, treat it as practice. Acknowledge their intent and answer their question — any grammar / spelling / phrasing corrections are shown to them separately in a structured correction widget, so do NOT duplicate that work in your reply. Keep the tone warm and encouraging.

APP CONTEXT:
${context}`;

    const { stream } = await getAI().generateStream({
      model,
      config: {
        maxOutputTokens: 1800,
        ...decoding,
      },
      system: systemPrompt,
      messages: history,
      prompt: latest.content,
    });

    let fullText = "";
    for await (const chunk of stream) {
      if (chunk.text) {
        fullText += chunk.text;
        response?.sendChunk(chunk.text);
      }
    }

    return { message: fullText || "I am here, but I could not form a response." };
  } catch (err) {
    throw new HttpsError("internal", err instanceof Error ? err.message : String(err));
  }
});

