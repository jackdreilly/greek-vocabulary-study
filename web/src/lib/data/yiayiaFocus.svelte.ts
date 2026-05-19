/**
 * Module-level reactive state that tracks the user's current "focal" context
 * inside a lesson tab — the exact word, flashcard, game, or plan they're
 * looking at or have selected.
 *
 * Any tab component writes here when its current item changes.
 * Both Yiayia chat panels read from here and send the structured payload to
 * their callables.
 */

export type YiayiaFocusKind = "vocab" | "flashcard" | "game" | "plan";

export type YiayiaFocusItem = {
  kind: YiayiaFocusKind;
  label: string;
  courseId: string;
  lessonId: string;
  tab?: string;
  words?: string[];
  entryId?: string;
  gameId?: string;
  planId?: string;
  type?: string;
  title?: string;
  prompt?: string;
  summary?: string;
  expectedAnswer?: string;
  index?: number;
  total?: number;
};

export const yiayiaFocus = $state<{
  /** Greek words currently in focus (e.g. current flashcard lemma, game requiredWords). */
  words: string[];
  /** Human-readable label for the context (e.g. "Flashcard: μπουζούκι"). */
  label: string;
  /** Structured version of the current UI focus for the chat callables. */
  item: YiayiaFocusItem | null;
}>({ words: [], label: "", item: null });

export function setFocus(item: YiayiaFocusItem) {
  const words = item.words?.filter(Boolean) ?? [];
  yiayiaFocus.words = words;
  yiayiaFocus.label = item.label;
  yiayiaFocus.item = {
    ...item,
    words,
  };
}

export function clearFocus() {
  yiayiaFocus.words = [];
  yiayiaFocus.label = "";
  yiayiaFocus.item = null;
}
