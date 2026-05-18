<script lang="ts">
  import { askYiayia, type YiayiaMessage } from "./data/yiayia";
  import { BotMessageSquare, Send, X } from "lucide-svelte";

  let {
    open,
    courseId = "",
    lessonId = "",
    planId = "",
    tab = "",
    pathname = "",
    onClose,
  }: {
    open: boolean;
    courseId?: string;
    lessonId?: string;
    planId?: string;
    tab?: string;
    pathname?: string;
    onClose: () => void;
  } = $props();

  let messages = $state<YiayiaMessage[]>([]);
  let draft = $state("");
  let sending = $state(false);
  let error = $state("");

  async function send() {
    const content = draft.trim();
    if (!content || sending) return;
    const nextMessages: YiayiaMessage[] = [...messages, { role: "user", content }];
    messages = nextMessages;
    draft = "";
    sending = true;
    error = "";
    try {
      const reply = await askYiayia({
        courseId,
        lessonId,
        planId,
        tab,
        pathname,
        messages: nextMessages,
      });
      messages = [...nextMessages, { role: "assistant", content: reply }];
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      sending = false;
    }
  }
</script>

{#if open}
  <div class="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-3xl sm:inset-x-auto sm:right-6 sm:w-[26rem]">
    <section class="overflow-hidden rounded-lg border border-(--color-border) bg-(--color-bg) shadow-2xl">
      <header class="flex items-center justify-between gap-3 border-b border-(--color-border) px-4 py-3">
        <div class="flex items-center gap-2.5">
          <BotMessageSquare size={20} aria-hidden="true" class="text-(--color-accent)" />
          <div>
            <h2 class="text-sm font-semibold tracking-tight">Yiayia</h2>
            <p class="text-xs text-(--color-muted)">Context-aware Greek help</p>
          </div>
        </div>
        <button
          type="button"
          onclick={onClose}
          class="inline-flex items-center justify-center rounded-md p-1 text-(--color-muted) hover:text-(--color-text) hover:bg-(--color-surface-muted)"
          title="Close"
          aria-label="Close"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </header>

      <div class="max-h-[24rem] space-y-3 overflow-y-auto px-4 py-3">
        {#if messages.length === 0}
          <p class="text-sm text-(--color-muted)">
            Ask about the current course, lesson vocabulary, games, or plan.
          </p>
        {/if}
        {#each messages as message}
          <div class="rounded-md px-3 py-2 text-sm {message.role === 'user' ? 'ml-8 bg-(--color-accent) text-white' : 'mr-8 bg-(--color-surface-muted) text-(--color-text)'}">
            <p class="whitespace-pre-wrap">{message.content}</p>
          </div>
        {/each}
        {#if sending}
          <p class="text-sm text-(--color-muted)">Yiayia is thinking...</p>
        {/if}
        {#if error}
          <p class="rounded-md bg-[#fef2f2] px-3 py-2 text-sm text-(--color-danger)">{error}</p>
        {/if}
      </div>

      <form
        class="border-t border-(--color-border) p-3"
        onsubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <div class="flex gap-2">
          <input
            type="text"
            bind:value={draft}
            placeholder="Ask Yiayia..."
            class="min-w-0 flex-1 rounded-md border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm focus:outline-none focus:border-(--color-accent) focus:ring-1 focus:ring-(--color-accent)"
          />
          <button
            type="submit"
            disabled={sending || draft.trim().length === 0}
            class="inline-flex items-center justify-center gap-1.5 rounded-md bg-(--color-accent) px-3 py-2 text-sm font-medium text-white hover:bg-(--color-accent-hover) disabled:opacity-50"
            title="Send"
          >
            <Send size={14} aria-hidden="true" />
            Send
          </button>
        </div>
      </form>
    </section>
  </div>
{/if}

