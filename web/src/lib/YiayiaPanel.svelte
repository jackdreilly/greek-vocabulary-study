<script lang="ts">
  import { tick } from "svelte";
  import { streamYiayia, type YiayiaMessage } from "./data/yiayia";
  import { yiayiaFocus } from "./data/yiayiaFocus.svelte";
  import { renderMarkdown } from "./markdown";
  import { BotMessageSquare, BookOpen, ChevronDown, Send, Sparkles, Trash2, Type, X } from "lucide-svelte";

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
  let streamingText = $state("");
  let messagesEl = $state<HTMLElement | null>(null);

  // --- template prompt system ---
  type PendingTemplate = { label: string; prompt: string };
  let pendingTemplate = $state<PendingTemplate | null>(null);
  let modeMenuOpen = $state(false);
  let wordMode = $state(false);
  let wordInput = $state("");

  const yiayiaModes = [
    {
      id: "explore",
      label: "Explore",
      prompt: () =>
        [
          "Explore the current lesson context.",
          "Explain useful Greek patterns and give one or two nearby examples from the lesson area.",
          "Keep it concise and learner-facing.",
        ].join("\n\n"),
    },
    {
      id: "word",
      label: "Word",
      prompt: (word: string) =>
        [
          `Word Architect: **${word}**`,
          "Act as a linguistic archaeologist. Break down this Greek word with roots, etymology, English cognates, related Greek word families, root-language memory connections, modern usage, and a quick conjugation or declension table.",
          "Structure the answer with: **Core Concept**, **The English Connection**, **Greek Relatives**, **Memory Network**, **Practical Usage**, and **Essential Forms**.",
          "Keep it lively and learner-facing. Prefer durable root connections over fake-sound mnemonics or silly wordplay.",
        ].join("\n\n"),
    },
    {
      id: "drill",
      label: "Drill",
      prompt: () =>
        [
          "Create a quick active-recall drill from the current lesson vocabulary.",
          "Include 4 short prompts mixing fill-in-the-blank, translate a chunk, and word recognition. Put answers under a clear **Answer Key** heading.",
        ].join("\n\n"),
    },
  ];

  function selectMode(modeId: string) {
    modeMenuOpen = false;
    if (modeId === "word") {
      wordMode = true;
      wordInput = "";
      return;
    }
    const mode = yiayiaModes.find((m) => m.id === modeId);
    if (!mode) return;
    pendingTemplate = { label: mode.label, prompt: mode.prompt("") };
  }

  function submitWordMode(word = wordInput) {
    const trimmed = word.trim();
    if (!trimmed) return;
    const mode = yiayiaModes.find((m) => m.id === "word")!;
    wordMode = false;
    wordInput = "";
    pendingTemplate = { label: `Word: ${trimmed}`, prompt: mode.prompt(trimmed) };
  }

  // --- scroll ---
  function scrollToBottom() {
    if (!messagesEl) return;
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // --- send ---
  async function send() {
    const userContent = draft.trim();
    if ((!userContent && !pendingTemplate) || sending) return;

    const requestContent = [pendingTemplate?.prompt, userContent].filter(Boolean).join("\n\n");
    const displayContent = userContent || pendingTemplate!.label;
    const templateLabel = pendingTemplate?.label ?? "";

    const nextMessages: (YiayiaMessage & { templateLabel?: string })[] = [
      ...messages,
      { role: "user", content: displayContent, templateLabel },
    ];
    messages = nextMessages;
    draft = "";
    pendingTemplate = null;
    sending = true;
    error = "";
    streamingText = "";
    await tick();
    scrollToBottom();

    try {
      const reply = await streamYiayia(
        {
          courseId,
          lessonId,
          planId,
          tab,
          pathname,
          focusedWords: yiayiaFocus.words.length ? yiayiaFocus.words : undefined,
          messages: nextMessages.map((m) => ({
            role: m.role,
            content: (m as { requestContent?: string }).requestContent ?? m.content,
          })),
        },
        async (accumulated) => {
          streamingText = accumulated;
          await tick();
          scrollToBottom();
        },
      );
      // Replace with actual request content for future turns
      const withRequest = [...nextMessages];
      const last = { ...withRequest[withRequest.length - 1], requestContent };
      withRequest[withRequest.length - 1] = last;
      messages = [...withRequest, { role: "assistant", content: reply }];
      streamingText = "";
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      streamingText = "";
    } finally {
      sending = false;
      await tick();
      scrollToBottom();
    }
  }

  function clearChat() {
    messages = [];
    streamingText = "";
    error = "";
    pendingTemplate = null;
    wordMode = false;
  }
</script>

{#if open}
  <div class="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-3xl sm:inset-x-auto sm:right-6 sm:w-[26rem]">
    <section class="flex flex-col overflow-hidden rounded-lg border border-(--color-border) bg-(--color-bg) shadow-2xl" style="height: 520px; max-height: calc(100vh - 2rem)">

      <!-- Header -->
      <header class="flex flex-shrink-0 items-center justify-between gap-3 border-b border-(--color-border) px-4 py-2.5">
        <div class="flex min-w-0 items-center gap-2">
          <BotMessageSquare size={18} aria-hidden="true" class="flex-shrink-0 text-(--color-accent)" />
          <h2 class="flex-shrink-0 text-sm font-bold tracking-tight">Yiayia</h2>
          {#if yiayiaFocus.label}
            <span class="truncate rounded bg-(--color-surface-muted) px-2 py-0.5 text-[10px] font-bold text-(--color-muted)">
              {yiayiaFocus.label}
            </span>
          {/if}
        </div>
        <div class="flex items-center gap-1">
          {#if messages.length > 0}
            <button
              type="button"
              onclick={clearChat}
              class="grid h-7 w-7 place-items-center rounded text-(--color-muted) hover:bg-(--color-surface-muted) hover:text-(--color-text)"
              title="Clear chat"
            >
              <Trash2 size={14} aria-hidden="true" />
            </button>
          {/if}
          <button
            type="button"
            onclick={onClose}
            class="grid h-7 w-7 place-items-center rounded text-(--color-muted) hover:bg-(--color-surface-muted) hover:text-(--color-text)"
            title="Close"
          >
            <X size={15} aria-hidden="true" />
          </button>
        </div>
      </header>

      <!-- Messages -->
      <div
        bind:this={messagesEl}
        class="flex flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-3"
      >
        {#if messages.length === 0 && !sending}
          <p class="rounded-lg border border-(--color-border) bg-(--color-surface-muted) px-4 py-3 text-sm text-(--color-muted)">
            Ask about the current lesson, or use <strong>Explore</strong>, <strong>Word</strong>, or <strong>Drill</strong> to get started.
          </p>
        {/if}

        {#each messages as message}
          {#if message.role === "user"}
            <div class="ml-8 self-end rounded-xl rounded-br-sm bg-(--color-accent) px-3 py-2 text-sm text-white">
              {#if (message as { templateLabel?: string }).templateLabel}
                <span class="mb-1 block rounded bg-white/15 px-1.5 py-0.5 text-[10px] font-bold">{(message as { templateLabel?: string }).templateLabel}</span>
              {/if}
              {#if message.content !== (message as { templateLabel?: string }).templateLabel}
                <p class="whitespace-pre-wrap">{message.content}</p>
              {/if}
            </div>
          {:else}
            <div class="yiayia-assistant mr-8 self-start rounded-xl rounded-bl-sm border border-(--color-border) bg-(--color-surface-muted) px-3 py-2 text-sm text-(--color-text)">
              <!-- eslint-disable-next-line svelte/no-at-html-tags -->
              {@html renderMarkdown(message.content)}
            </div>
          {/if}
        {/each}

        {#if sending && streamingText}
          <div class="yiayia-assistant mr-8 self-start rounded-xl rounded-bl-sm border border-(--color-border) bg-(--color-surface-muted) px-3 py-2 text-sm text-(--color-text)">
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            {@html renderMarkdown(streamingText)}<span class="animate-pulse">▍</span>
          </div>
        {:else if sending}
          <div class="mr-8 self-start rounded-xl rounded-bl-sm border border-(--color-border) bg-(--color-surface-muted) px-3 py-2 text-sm text-(--color-muted)">
            Yiayia is thinking<span class="animate-pulse">…</span>
          </div>
        {/if}

        {#if error}
          <p class="rounded-md bg-[#fef2f2] px-3 py-2 text-sm text-(--color-danger)">{error}</p>
        {/if}
      </div>

      <!-- Input area -->
      <div class="flex-shrink-0 border-t border-(--color-border) px-3 py-2.5">

        <!-- Word mode -->
        {#if wordMode}
          <div class="mb-2 rounded-lg border border-(--color-border) bg-(--color-surface) p-2.5">
            <div class="mb-2 flex items-center justify-between text-xs font-bold text-(--color-muted)">
              <span>Word Architect</span>
              <button type="button" onclick={() => (wordMode = false)} class="text-(--color-text) hover:underline">Cancel</button>
            </div>
            {#if yiayiaFocus.words.length > 0}
              <div class="mb-2 flex flex-wrap gap-1.5">
                {#each yiayiaFocus.words as word}
                  <button
                    type="button"
                    onclick={() => submitWordMode(word)}
                    class="rounded-md border border-(--color-border) bg-(--color-surface-muted) px-2.5 py-1 text-sm font-semibold text-(--color-accent) hover:border-(--color-accent) hover:bg-(--color-accent)/8"
                  >{word}</button>
                {/each}
              </div>
            {/if}
            <div class="flex gap-2">
              <input
                type="text"
                bind:value={wordInput}
                placeholder="Or type any Greek word…"
                class="min-w-0 flex-1 rounded border border-(--color-border) bg-(--color-bg) px-2.5 py-1.5 text-sm focus:border-(--color-accent) focus:outline-none"
                onkeydown={(e) => e.key === "Enter" && submitWordMode()}
              />
              <button
                type="button"
                disabled={!wordInput.trim()}
                onclick={() => submitWordMode()}
                class="rounded bg-(--color-accent) px-3 py-1.5 text-sm font-bold text-white hover:bg-(--color-accent-hover) disabled:opacity-40"
              >Go</button>
            </div>
          </div>

        {:else}
          <!-- Mode buttons row -->
          <div class="relative mb-2">
            <button
              type="button"
              onclick={() => (modeMenuOpen = !modeMenuOpen)}
              class="inline-flex h-7 items-center gap-1.5 rounded-md border border-(--color-border) px-2.5 text-xs font-bold text-(--color-text) hover:border-(--color-accent) hover:text-(--color-accent)"
            >
              <Sparkles size={11} aria-hidden="true" />
              Explore
              <ChevronDown size={10} aria-hidden="true" />
            </button>

            {#if modeMenuOpen}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="absolute bottom-9 left-0 z-10 w-40 overflow-hidden rounded-lg border border-(--color-border) bg-(--color-bg) shadow-lg"
                onmouseleave={() => (modeMenuOpen = false)}
              >
                <button
                  type="button"
                  onclick={() => selectMode("explore")}
                  class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-bold hover:bg-(--color-surface-muted)"
                >
                  <Sparkles size={13} aria-hidden="true" class="text-(--color-muted)" />
                  Explore
                </button>
                <button
                  type="button"
                  onclick={() => selectMode("word")}
                  class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-bold hover:bg-(--color-surface-muted)"
                >
                  <BookOpen size={13} aria-hidden="true" class="text-(--color-muted)" />
                  Word
                </button>
                <button
                  type="button"
                  onclick={() => selectMode("drill")}
                  class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-bold hover:bg-(--color-surface-muted)"
                >
                  <Type size={13} aria-hidden="true" class="text-(--color-muted)" />
                  Drill
                </button>
              </div>
            {/if}
          </div>
        {/if}

        <!-- Pending template chip -->
        {#if pendingTemplate && !wordMode}
          <div class="mb-2 inline-flex items-center gap-1.5 rounded-md border border-(--color-accent)/30 bg-(--color-accent)/8 px-2 py-1 text-xs font-bold text-(--color-accent)">
            <Sparkles size={10} aria-hidden="true" />
            {pendingTemplate.label}
            <button
              type="button"
              onclick={() => (pendingTemplate = null)}
              class="ml-0.5 opacity-60 hover:opacity-100"
              aria-label="Remove"
            >×</button>
          </div>
        {/if}

        <!-- Compose row -->
        <div class="flex gap-2">
          <input
            type="text"
            bind:value={draft}
            placeholder={pendingTemplate ? "Add a note, or just send…" : "Ask Yiayia…"}
            class="min-w-0 flex-1 rounded-md border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm focus:border-(--color-accent) focus:outline-none focus:ring-1 focus:ring-(--color-accent)"
            onkeydown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); }
            }}
          />
          <button
            type="button"
            onclick={() => void send()}
            disabled={sending || (draft.trim().length === 0 && !pendingTemplate)}
            class="grid h-9 w-9 flex-shrink-0 place-items-center rounded-md bg-(--color-accent) text-white hover:bg-(--color-accent-hover) disabled:opacity-40"
            title="Send"
          >
            <Send size={14} aria-hidden="true" />
          </button>
        </div>
      </div>

    </section>
  </div>
{/if}

<style>
  .yiayia-assistant :global(p) { margin: 0; }
  .yiayia-assistant :global(p + p) { margin-top: 0.4rem; }
  .yiayia-assistant :global(ul),
  .yiayia-assistant :global(ol) { margin: 0.25rem 0; padding-left: 1.2rem; }
  .yiayia-assistant :global(li + li) { margin-top: 0.15rem; }
  .yiayia-assistant :global(h1),
  .yiayia-assistant :global(h2),
  .yiayia-assistant :global(h3) { margin: 0.3rem 0 0.1rem; font-size: 0.82rem; font-weight: 700; }
  .yiayia-assistant :global(table) { width: 100%; border-collapse: collapse; font-size: 0.78rem; margin: 0.3rem 0; }
  .yiayia-assistant :global(th),
  .yiayia-assistant :global(td) { border: 1px solid var(--color-border); padding: 0.25rem 0.4rem; text-align: left; }
  .yiayia-assistant :global(code) { border-radius: 0.2rem; background: var(--color-surface-muted); padding: 0.05rem 0.2rem; font-size: 0.85em; }
  .yiayia-assistant :global(strong) { font-weight: 700; }
</style>
