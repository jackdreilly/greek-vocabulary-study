import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";

export type AdminChatMessage = {
  role: "user" | "assistant";
  content: string;
  toolCalls?: AdminToolCall[];
  generationId?: string;
  error?: string;
};

export type AdminToolCall = {
  id: string;
  name: string;
  input: unknown;
  output?: unknown;
  status: "running" | "complete" | "error";
  error?: string;
};

export type AdminChatContext = {
  pathname?: string;
  courseId?: string;
  lessonId?: string;
  planId?: string;
  tab?: string;
};

export type AdminChatEvent =
  | { type: "text"; delta: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; name: string; output?: unknown; error?: string }
  | { type: "status"; message: string }
  | { type: "error"; message: string; generationId?: string }
  | {
      type: "done";
      message: string;
      toolCalls: AdminToolCall[];
      generationId?: string;
    };

type StreamableCallable = ReturnType<typeof httpsCallable> & {
  stream: (data: unknown) => Promise<{
    stream: AsyncIterable<unknown> | undefined;
    data: Promise<unknown>;
  }>;
};

function parseChunk(raw: unknown): AdminChatEvent[] {
  if (typeof raw !== "string") return [];
  const events: AdminChatEvent[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && typeof parsed.type === "string") {
        events.push(parsed as AdminChatEvent);
      }
    } catch {
      // ignore non-JSON debris
    }
  }
  return events;
}

export async function streamAdminChat(
  input: {
    messages: { role: "user" | "assistant"; content: string }[];
    context: AdminChatContext;
    aiModel?: "lite" | "flash";
  },
  onEvent: (event: AdminChatEvent) => void,
): Promise<{ message: string; toolCalls: AdminToolCall[]; generationId?: string }> {
  const callable = httpsCallable(functions, "yiayiaAdminChat") as StreamableCallable;
  const payload = {
    messages: input.messages,
    context: input.context,
    aiModel: input.aiModel ?? "lite",
  };

  let lastDone: { message: string; toolCalls: AdminToolCall[]; generationId?: string } | null =
    null;

  if (typeof callable.stream === "function") {
    try {
      const result = await callable.stream(payload);
      const asyncStream = result?.stream;
      if (
        asyncStream != null &&
        typeof (asyncStream as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] ===
          "function"
      ) {
        for await (const chunk of asyncStream) {
          for (const event of parseChunk(chunk)) {
            onEvent(event);
            if (event.type === "done") {
              lastDone = {
                message: event.message,
                toolCalls: event.toolCalls,
                generationId: event.generationId,
              };
            }
            if (event.type === "error") {
              throw new Error(event.message);
            }
          }
        }
        // Drain the final settled response.
        const finalData = (await result.data) as
          | { message?: string; toolCalls?: AdminToolCall[]; generationId?: string }
          | undefined;
        if (!lastDone && finalData?.message) {
          lastDone = {
            message: finalData.message,
            toolCalls: finalData.toolCalls ?? [],
            generationId: finalData.generationId,
          };
        }
        if (lastDone) return lastDone;
      }
    } catch (err) {
      // If streaming failed mid-flight, surface a sensible error.
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  // Fallback for environments where streaming isn't available.
  const result = await callable(payload);
  const data = result.data as
    | { message?: string; toolCalls?: AdminToolCall[]; generationId?: string }
    | undefined;
  const message = data?.message ?? "";
  onEvent({
    type: "done",
    message,
    toolCalls: data?.toolCalls ?? [],
    generationId: data?.generationId,
  });
  return {
    message,
    toolCalls: data?.toolCalls ?? [],
    generationId: data?.generationId,
  };
}
