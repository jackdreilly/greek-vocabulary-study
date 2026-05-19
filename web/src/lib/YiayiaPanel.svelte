<script lang="ts">
  import { tick } from "svelte";
  import {
    correctGreekText,
    hasGreek,
    streamYiayia,
    type GreekCorrection,
    type YiayiaMessage,
  } from "./data/yiayia";
  import { yiayiaFocus } from "./data/yiayiaFocus.svelte";
  import { renderMarkdown } from "./markdown";
  import GreekCorrectionCard from "./ui/GreekCorrectionCard.svelte";
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

  type DisplayMessage = YiayiaMessage & {
    requestContent?: string;
    templateLabel?: string;
    greekUserText?: string;
    greekCorrection?: GreekCorrection | null;
  };

  let aiModel = $state<"lite" | "flash">(
    (localStorage.getItem("greekflash:ai-model") as "lite" | "flash") ?? "lite",
  );
  $effect(() => { localStorage.setItem("greekflash:ai-model", aiModel); });

  let messages = $state<DisplayMessage[]>([]);
  let draft = $state("");
  let sending = $state(false);
  let error = $state("");
  let streamingText = $state("");
  let streamingGreekUserText = $state("");
  let streamingCorrection = $state<GreekCorrection | null>(null);
  let correctionPending = $state(false);
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
          "Act as a linguistic archaeologist for this Greek word. The answer is INCOMPLETE unless it covers all four of the following — treat them as required sections, not optional flourishes:",
          [
            "1. **English cognates** — REQUIRED. List 3-6 inherited English words (technical, literary, scientific, or everyday) that share this Greek root. Show the shared root form (e.g. -graph-, -phon-, -log-) and give a one-line meaning bridge for each. If you cannot find at least three, explicitly say so and explain why the root is rare in English — do not pad with weak guesses.",
            "2. **Fun etymology** — REQUIRED. A short, vivid origin story: where the root came from (Ancient Greek, Proto-Indo-European, Byzantine, Turkish, Italian, Slavic — whatever applies), what it originally meant, how the meaning drifted to today's sense. Include the surprising or memorable detail (a metaphor, a historical scene, a meaning shift) — make it actually fun, not a dry timeline.",
            "3. **Grounded memory tricks** — REQUIRED. Concrete ways to remember the word that are anchored in real linguistic structure: the shared Greek root, sibling Greek words built from it (prefixes, suffixes, compounds), and the English cognates from section 1. STRICTLY FORBIDDEN: silly fake-sound mnemonics (\"sounds like…\"), pun-style hooks, invented backstories, or any trick that relies on accidental phonetic resemblance rather than real etymology.",
            "4. **Conjugation or declension table** — REQUIRED. ALWAYS include a real morphology table, never just \"this is a regular verb\" or a one-line summary. Pick the form that fits the word: verbs → a present-tense paradigm across all six persons (εγώ, εσύ, αυτός/αυτή/αυτό, εμείς, εσείς, αυτοί/ές/ά), plus the simple-past (αόριστος) 1st-person singular and the simple-future 1st-person singular for orientation. Nouns → full singular and plural across nominative, genitive, and accusative (and vocative if it's commonly used). Adjectives → masculine/feminine/neuter singular AND plural in nominative + accusative. Show the table inline as a markdown table with clear headers; do not omit columns to save space.",
          ].join("\n"),
          "Structure the answer as: **Core Concept**, **English Cognates**, **Fun Etymology**, **Greek Relatives** (sibling words from the same root), **Memory Anchors** (the grounded tricks from §3), **Practical Usage** (1 example sentence + a common idiom or phrase), **Forms** (the full table from §4).",
          "Keep it lively and learner-facing. Every memory hook must trace back to a real root connection — if you can't ground it, leave it out. Never skip the morphology table.",
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
    const shouldCheckGreek = hasGreek(userContent);

    const nextMessages: DisplayMessage[] = [
      ...messages,
      {
        role: "user",
        content: displayContent,
        templateLabel,
        greekUserText: shouldCheckGreek ? userContent : undefined,
      },
    ];
    messages = nextMessages;
    draft = "";
    pendingTemplate = null;
    sending = true;
    error = "";
    streamingText = "";
    streamingGreekUserText = shouldCheckGreek ? userContent : "";
    streamingCorrection = null;
    correctionPending = shouldCheckGreek;
    await tick();
    scrollToBottom();

    // Fire correction call in parallel with the streamed assistant reply.
    const correctionPromise = shouldCheckGreek
      ? correctGreekText({ courseId, lessonId, text: userContent })
          .catch(() => null)
          .finally(() => {
            correctionPending = false;
          })
      : Promise.resolve<GreekCorrection | null>(null);
    correctionPromise.then((result) => {
      streamingCorrection = result;
    });

    try {
      const reply = await streamYiayia(
        {
          courseId,
          lessonId,
          planId,
          tab,
          pathname,
          focusedWords: yiayiaFocus.words.length ? yiayiaFocus.words : undefined,
          focus: yiayiaFocus.item,
          messages: nextMessages.map((m) => ({
            role: m.role,
            content: m.requestContent ?? m.content,
          })),
          aiModel,
        },
        async (accumulated) => {
          streamingText = accumulated;
          await tick();
          scrollToBottom();
        },
      );

      const correction = await correctionPromise;

      // Replace with actual request content for future turns
      const withRequest = [...nextMessages];
      const last = { ...withRequest[withRequest.length - 1], requestContent };
      withRequest[withRequest.length - 1] = last;
      messages = [
        ...withRequest,
        {
          role: "assistant",
          content: reply,
          greekUserText: shouldCheckGreek ? userContent : undefined,
          greekCorrection: correction,
        },
      ];
      streamingText = "";
      streamingCorrection = null;
      streamingGreekUserText = "";
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      streamingText = "";
      streamingCorrection = null;
      streamingGreekUserText = "";
      correctionPending = false;
    } finally {
      sending = false;
      await tick();
      scrollToBottom();
    }
  }

  function clearChat() {
    messages = [];
    streamingText = "";
    streamingGreekUserText = "";
    streamingCorrection = null;
    correctionPending = false;
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
          <button
            type="button"
            onclick={() => (aiModel = aiModel === "lite" ? "flash" : "lite")}
            class="grid h-7 w-7 place-items-center rounded border text-xs transition-colors"
            class:border-transparent={aiModel === "lite"}
            class:text-(--color-muted)={aiModel === "lite"}
            class:hover:border-(--color-border)={aiModel === "lite"}
            class:border-amber-400={aiModel === "flash"}
            class:text-amber-600={aiModel === "flash"}
            class:bg-amber-50={aiModel === "flash"}
            title={aiModel === "flash" ? "Using Flash — click for Lite" : "Using Lite — click for Flash"}
          >{aiModel === "flash" ? "⚡" : "·"}</button>
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
              {#if message.templateLabel}
                <span class="mb-1 block rounded bg-white/15 px-1.5 py-0.5 text-[10px] font-bold">{message.templateLabel}</span>
              {/if}
              {#if message.content !== message.templateLabel}
                <p class="whitespace-pre-wrap">{message.content}</p>
              {/if}
            </div>
          {:else}
            <div class="yiayia-assistant mr-8 self-start rounded-xl rounded-bl-sm border border-(--color-border) bg-(--color-surface-muted) px-3 py-2 text-sm text-(--color-text)">
              {#if message.greekCorrection || message.greekUserText}
                <GreekCorrectionCard
                  correction={message.greekCorrection ?? null}
                  userText={message.greekUserText ?? ""}
                />
              {/if}
              <!-- eslint-disable-next-line svelte/no-at-html-tags -->
              {@html renderMarkdown(message.content)}
            </div>
          {/if}
        {/each}

        {#if sending && (streamingText || correctionPending || streamingCorrection)}
          <div class="yiayia-assistant mr-8 self-start rounded-xl rounded-bl-sm border border-(--color-border) bg-(--color-surface-muted) px-3 py-2 text-sm text-(--color-text)">
            {#if correctionPending || streamingCorrection}
              <GreekCorrectionCard
                correction={streamingCorrection}
                pending={correctionPending}
                userText={streamingGreekUserText}
              />
            {/if}
            {#if streamingText}
              <!-- eslint-disable-next-line svelte/no-at-html-tags -->
              {@html renderMarkdown(streamingText)}<span class="animate-pulse">▍</span>
            {:else}
              <span class="text-(--color-muted)">Yiayia is thinking<span class="animate-pulse">…</span></span>
            {/if}
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
