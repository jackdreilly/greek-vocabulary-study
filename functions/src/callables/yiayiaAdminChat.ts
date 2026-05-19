/**
 * Yiayia admin chat — the AI back-end for the admin drawer.
 *
 * Protocol:
 *   - Streams JSON-encoded event objects, one per chunk:
 *       { type: "text", delta }            ← partial text
 *       { type: "tool_call", id, name, input }
 *       { type: "tool_result", id, name, output }
 *       { type: "status", message }
 *       { type: "done", message, toolCalls[], generationId? }
 *   - Final return value matches the last "done" event.
 *
 * The callable instantiates a `LineageRecorder` per invocation; if any
 * mutating tool runs, the generation doc is left in `done` state so the
 * user can revert from chat or the admin UI.
 */
import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "genkit";
import { getDecodingFor, getModelFor } from "../ai/configResolver.js";
import { geminiApiKey, getAI } from "../ai/genkitClient.js";
import { ALLOWED_ORIGINS } from "../cors.js";
import { LineageRecorder } from "../admin/lineage.js";
import { buildAdminTools } from "../admin/tools.js";

// Firebase callables serialize `undefined` as `null` on the wire — so each
// field must accept null AND undefined, and coerce both to "".
const nullableString = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) => (typeof v === "string" ? v : ""));

const MessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(8000),
});

const IncomingMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: nullableString.transform((value) => value.trim()),
});

const ContextSchema = z
  .object({
    pathname: nullableString,
    courseId: nullableString,
    lessonId: nullableString,
    planId: nullableString,
    tab: nullableString,
  })
  .partial()
  .default({});

const InputSchema = z.object({
  messages: z
    .array(IncomingMessageSchema)
    .min(1)
    .max(60)
    .transform((messages) =>
      messages.filter(
        (message) => message.role !== "assistant" || message.content.length > 0,
      ),
    )
    .pipe(z.array(MessageSchema).min(1).max(40)),
  context: ContextSchema,
  aiModel: z.enum(["lite", "flash"]).optional().default("lite"),
});

// Genkit defaults to 5 turns when this is omitted. Use the largest safe integer
// so Yiayia can keep chaining tools until the model is done or the callable times out.
const ADMIN_MAX_TOOL_TURNS = Number.MAX_SAFE_INTEGER;

type ToolCallRecord = {
  id: string;
  name: string;
  input: unknown;
  output?: unknown;
  status: "running" | "complete" | "error";
  error?: string;
};

async function buildContextBlock(ctx: z.infer<typeof ContextSchema>): Promise<string> {
  const parts: string[] = [];
  parts.push(`Current URL: ${ctx.pathname || "/"}`);
  if (ctx.courseId) parts.push(`Current courseId: ${ctx.courseId}`);
  if (ctx.lessonId) parts.push(`Current lessonId: ${ctx.lessonId}`);
  if (ctx.planId) parts.push(`Current planId: ${ctx.planId}`);
  if (ctx.tab) parts.push(`Active tab: ${ctx.tab}`);

  if (ctx.courseId) {
    try {
      const snap = await getFirestore().doc(`courses/${ctx.courseId}`).get();
      if (snap.exists) {
        const data = snap.data() ?? {};
        parts.push(
          `Course: "${data.title ?? ctx.courseId}" — ${String(data.subtitle ?? "").slice(0, 120)}`,
        );
        parts.push(`Course status: ${data.status ?? "(unknown)"}.`);
        const summaries = Object.entries(data.lessonSummaries ?? {})
          .slice(0, 15)
          .map(([id, value]) => {
            const lesson = value as Record<string, unknown>;
            return `- ${id}: ${lesson.title ?? "(untitled)"} [${lesson.status ?? "?"}]`;
          })
          .join("\n");
        if (summaries) parts.push(`Lessons in this course:\n${summaries}`);
      }
    } catch (err) {
      logger.warn("Context: failed to read course", err);
    }
  }
  if (ctx.courseId && ctx.lessonId) {
    try {
      const snap = await getFirestore()
        .doc(`courses/${ctx.courseId}/lessons/${ctx.lessonId}`)
        .get();
      if (snap.exists) {
        const lesson = snap.data() ?? {};
        parts.push(
          `Lesson: "${lesson.title ?? ctx.lessonId}" — ${String(lesson.subtitle ?? "").slice(0, 120)}`,
        );
        const c = lesson.counts ?? {};
        parts.push(
          `Lesson counts: entries=${c.entries ?? 0}, plans=${c.plans ?? 0}, games=${c.games ?? 0}.`,
        );
      }
    } catch (err) {
      logger.warn("Context: failed to read lesson", err);
    }
  }
  return parts.join("\n");
}

function systemPrompt(contextBlock: string): string {
  return `You are Yiayia, the admin assistant for the GreekFlash content tree.

Your job is to help an admin understand, create, edit, and revert vocabulary courses, lessons, vocabulary entries, plans, and games stored in Firestore. Be terse and decisive — admins are working fast.

OPERATING RULES
- Use the tools whenever they fit. Don't describe what a tool would do — call it.
- Reads are free: use list/get tools before making decisions, especially before edits or deletes.
- For createCourse / createLesson / createPlan: kick off the stub immediately; the tool result includes a "url" field — quote it back to the user as the place to go.
- After a tool runs, briefly summarize what changed and any next step. The UI shows tool cards inline, so you do not need to re-paste tool output.
- When the user gives a fuzzy reference ("this lesson", "the second course", "Tomatoes", "ksipnaw"), resolve it against the current context and/or via a list tool — the listEntries / listCourses query parameter supports Greeklish (e.g. "ksipnaw" matches "ξυπνάω"). Don't ask for an id unless ambiguous.

UNDO STRATEGY — IMPORTANT
- "Undo that" or "revert" does NOT automatically mean call revertGeneration.
- Prefer a direct inverse edit when the previous change is obvious and limited in scope:
  - If you just added a sense to an entry, call updateEntry again with the prior senses list.
  - If you just changed a title, call updateCourse/updateLesson with the prior title.
  - If you just deleted a doc, you can't undo deletes with revert — say so.
- ONLY use revertGeneration for cascading reverts (a whole course generation, lesson generation, plan generation), or when the user explicitly says "revert generation X". For yiayia_edit generations, the inverse edit is almost always cleaner.
- Before any destructive call (deleteCourse, deleteLesson, revertGeneration), call previewGeneration (for reverts) or list/get tools first, then briefly summarize the impact for the user and only proceed after they confirm in chat.
- IDs matter. "generationId" looks like \`gen_yiayia_…\` / \`gen_course_…\`. Don't confuse it with a courseId, lessonId, or planId.

- Greek text in chat uses a serif font and is shown 1-2pt larger; format examples like "**γεια** = hi" so they stand out.

CURRENT CONTEXT
${contextBlock}`;
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export const yiayiaAdminChat = onCall(
  { secrets: [geminiApiKey], cors: ALLOWED_ORIGINS, timeoutSeconds: 240 },
  async (request, response) => {
    const parsed = InputSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError(
        "invalid-argument",
        parsed.error.issues.map((issue) => issue.message).join("; "),
      );
    }
    const { messages, context, aiModel } = parsed.data;
    const latest = messages[messages.length - 1];
    if (!latest || latest.role !== "user") {
      throw new HttpsError("invalid-argument", "Last message must be from the user.");
    }

    const recorder = new LineageRecorder(
      `Yiayia admin chat: "${latest.content.slice(0, 80)}"`,
      "yiayia",
    );

    function emit(event: Record<string, unknown>) {
      response?.sendChunk(safeStringify(event) + "\n");
    }

    try {
      const [configModel, decoding, contextBlock] = await Promise.all([
        getModelFor("yiayiaAdmin"),
        getDecodingFor("yiayiaAdmin"),
        buildContextBlock(context),
      ]);
      const model = aiModel === "flash" ? "googleai/gemini-3-flash-preview" : configModel;

      const tools = buildAdminTools(recorder);

      // Track tool calls by ref so we can pair toolRequest → toolResponse
      // chunks emitted by Genkit during the agentic loop.
      const toolCalls: ToolCallRecord[] = [];
      const callsByRef = new Map<string, ToolCallRecord>();

      const history = messages.slice(0, -1).map((m) => ({
        role: m.role === "assistant" ? ("model" as const) : ("user" as const),
        content: [{ text: m.content }],
      }));

      emit({ type: "status", message: "Thinking…" });

      const { stream, response: finalPromise } = getAI().generateStream({
        model,
        config: { maxOutputTokens: 4000, ...decoding },
        system: systemPrompt(contextBlock),
        messages: history,
        prompt: latest.content,
        tools,
        maxTurns: ADMIN_MAX_TOOL_TURNS,
      });

      let fullText = "";
      for await (const chunk of stream) {
        const text = chunk.text;
        if (text) {
          fullText += text;
          emit({ type: "text", delta: text });
        }
        // Inspect parts for tool round-trips.
        const content = (chunk as { content?: unknown[] }).content;
        if (Array.isArray(content)) {
          for (const part of content) {
            if (!part || typeof part !== "object") continue;
            const req = (part as { toolRequest?: { name?: string; ref?: string; input?: unknown } })
              .toolRequest;
            if (req && req.name) {
              const ref = req.ref ?? `call_${toolCalls.length + 1}`;
              const record: ToolCallRecord = {
                id: ref,
                name: req.name,
                input: req.input,
                status: "running",
              };
              toolCalls.push(record);
              callsByRef.set(ref, record);
              emit({ type: "tool_call", id: ref, name: req.name, input: req.input ?? {} });
            }
            const res = (
              part as { toolResponse?: { name?: string; ref?: string; output?: unknown } }
            ).toolResponse;
            if (res && res.name) {
              const ref = res.ref ?? `call_${toolCalls.length}`;
              const record = callsByRef.get(ref);
              if (record) {
                record.output = res.output;
                record.status = "complete";
              }
              emit({ type: "tool_result", id: ref, name: res.name, output: res.output ?? null });
            }
          }
        }
      }
      const finalResponse = await finalPromise;
      const finalText = finalResponse.text || fullText;

      const generationId = recorder.hasWrites() ? recorder.id : "";
      if (recorder.hasWrites()) {
        await recorder.close();
      }

      const done = {
        type: "done" as const,
        message: finalText || "(no response)",
        toolCalls,
        generationId,
      };
      emit(done);
      return done;
    } catch (err) {
      logger.error("yiayiaAdminChat failed", err);
      const message = err instanceof Error ? err.message : String(err);
      await recorder.fail(message).catch((failErr) => {
        logger.error("Failed to mark Yiayia admin generation as error", failErr);
      });
      const errorEvent = {
        type: "error" as const,
        message,
        generationId: recorder.hasActivity() ? recorder.id : undefined,
      };
      emit(errorEvent);
      throw new HttpsError("internal", message);
    }
  },
);
