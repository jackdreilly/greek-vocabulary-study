import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";

export type YiayiaMessage = {
  role: "user" | "assistant";
  content: string;
};

type YiayiaInput = {
  courseId?: string;
  lessonId?: string;
  planId?: string;
  tab?: string;
  pathname: string;
  messages: YiayiaMessage[];
  /** Greek words currently in focus in the UI (current card, game required words, plan vocab). */
  focusedWords?: string[];
};

type StreamResult = {
  stream: AsyncIterable<unknown> | undefined;
  data: Promise<unknown>;
};

type StreamableCallable = ReturnType<typeof httpsCallable> & {
  stream: (data: unknown) => Promise<StreamResult>;
};

function shouldAttemptStreaming(): boolean {
  const userAgent = globalThis.navigator?.userAgent ?? "";
  const isSafari = /\bSafari\//.test(userAgent) && !/\b(?:Chrome|Chromium|CriOS|FxiOS|Edg)\//.test(userAgent);
  return !isSafari;
}

export async function streamYiayia(
  input: YiayiaInput,
  onChunk: (accumulated: string) => void,
): Promise<string> {
  const payload = {
    courseId: input.courseId ?? "",
    lessonId: input.lessonId ?? "",
    planId: input.planId ?? "",
    tab: input.tab ?? "",
    pathname: input.pathname,
    messages: input.messages,
    focusedWords: input.focusedWords ?? [],
  };

  const callable = httpsCallable(functions, "yiayiaChat") as StreamableCallable;

  if (shouldAttemptStreaming() && typeof callable.stream === "function") {
    try {
      // callable.stream() returns a Promise — must await before accessing .stream
      const result = await callable.stream(payload);
      const asyncStream = result?.stream;
      if (
        asyncStream != null &&
        typeof (asyncStream as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === "function"
      ) {
        let accumulated = "";
        for await (const chunk of asyncStream) {
          const text = typeof chunk === "string" ? chunk : "";
          if (text) {
            accumulated += text;
            onChunk(accumulated);
          }
        }
        await result.data;
        return accumulated || "I am here, but I could not form a response.";
      }
    } catch {
      // Streaming not supported in this environment (e.g. local emulator) — fall through
    }
  }

  // Fallback for environments where streaming isn't available
  const result = await callable(payload);
  const data = result.data as { message?: string };
  const text = data.message ?? "";
  onChunk(text);
  return text;
}
