/**
 * Module-level reactive state that tracks the user's current "focal" context
 * inside a lesson tab — the specific word, game, or plan they're looking at.
 *
 * Any tab component writes here when its current item changes.
 * YiayiaPanel reads from here to show word chips and send richer context.
 */

export const yiayiaFocus = $state<{
  /** Greek words currently in focus (e.g. current flashcard lemma, game requiredWords). */
  words: string[];
  /** Human-readable label for the context (e.g. "Flashcard: μπουζούκι"). */
  label: string;
}>({ words: [], label: "" });

export function clearFocus() {
  yiayiaFocus.words = [];
  yiayiaFocus.label = "";
}
