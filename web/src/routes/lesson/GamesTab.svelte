<script lang="ts">
  import { createGameBatch } from "../../lib/data/createGameBatch";
  import { scoreGameAnswer, type GameScoreResult } from "../../lib/data/gameScoring";
  import { retryGameBatchGeneration } from "../../lib/data/retryGeneration";
  import { subscribeGames, subscribeLatestGameBatches, subscribeLesson } from "../../lib/data/lessons.svelte";
  import { Check, ChevronLeft, ChevronRight, RefreshCw, Shuffle, Sparkles, X } from "lucide-svelte";
  import { yiayiaFocus, clearFocus } from "../../lib/data/yiayiaFocus.svelte";

  let { courseId, lessonId }: { courseId: string; lessonId: string } = $props();

  // --- banner dismiss logic ---
  const DISMISS_KEY = "greekflash:dismissed-batches";
  const AUTO_HIDE_MS = 60_000; // hide terminal banners after 60 s

  function loadDismissed(): Set<string> {
    try {
      return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) ?? "[]") as string[]);
    } catch {
      return new Set();
    }
  }

  function saveDismissed(ids: Set<string>) {
    // Keep at most 50 entries so localStorage doesn't grow unbounded
    const arr = [...ids].slice(-50);
    localStorage.setItem(DISMISS_KEY, JSON.stringify(arr));
  }

  let dismissed = $state<Set<string>>(loadDismissed());

  function dismissBatch(id: string) {
    dismissed = new Set([...dismissed, id]);
    saveDismissed(dismissed);
  }

  function isBannerVisible(batch: typeof latestBatch): boolean {
    if (!batch) return false;
    if (dismissed.has(batch.id)) return false;
    const terminal = batch.status === "done" || batch.status === "ready";
    if (terminal && batch.completedAt) {
      if (Date.now() - batch.completedAt.toMillis() > AUTO_HIDE_MS) return false;
    }
    return true;
  }

  let sub = $state<ReturnType<typeof subscribeGames>>();
  let lessonSub = $state<ReturnType<typeof subscribeLesson>>();
  let batchSub = $state<ReturnType<typeof subscribeLatestGameBatches>>();
  let index = $state(0);
  let answer = $state("");
  let checked = $state(false);
  let grading = $state(false);
  let gradeResult = $state<GameScoreResult | null>(null);
  let gradeError = $state("");
  let typeFilter = $state("all");
  let generatingGames = $state(false);
  let generateError = $state("");
  let submissionId = 0;

  $effect(() => {
    const next = subscribeGames(courseId, lessonId);
    const nextLesson = subscribeLesson(courseId, lessonId);
    const nextBatch = subscribeLatestGameBatches(courseId, lessonId);
    sub = next;
    lessonSub = nextLesson;
    batchSub = nextBatch;
    index = 0;
    answer = "";
    checked = false;
    grading = false;
    gradeResult = null;
    gradeError = "";
    generatingGames = false;
    generateError = "";
    return () => {
      next.stop();
      nextLesson.stop();
      nextBatch.stop();
      clearFocus();
    };
  });

  // Keep yiayiaFocus in sync with the current game's target words.
  $effect(() => {
    if (current) {
      const words = current.requiredWords?.length
        ? current.requiredWords
        : current.prompt
          ? [current.prompt]
          : [];
      yiayiaFocus.words = words;
      yiayiaFocus.label = `Game: ${label(current.type)}`;
    } else {
      clearFocus();
    }
  });

  const allGames = $derived(sub?.games ?? []);
  const gameTypes = $derived([...new Set(allGames.map((g) => g.type))]);
  const games = $derived(typeFilter === "all" ? allGames : allGames.filter((g) => g.type === typeFilter));
  const current = $derived(games[index]);
  const hasAnswer = $derived(answer.trim().length > 0);
  const latestBatch = $derived(batchSub?.latest ?? null);
  const batchRunning = $derived(latestBatch?.status === "initializing" || latestBatch?.status === "streaming");

  function label(type: string) {
    return type.split("_").map((p) => p[0]?.toUpperCase() + p.slice(1)).join(" ");
  }

  function shortLabel(type: string) {
    const map: Record<string, string> = {
      missing_word: "Fill",
      reading_comprehension: "Read",
      story_prompt: "Story",
      sentence_translation: "Translate",
      word_translation: "Word",
    };
    return map[type] ?? label(type);
  }

  function resetAnswerState() {
    submissionId += 1;
    answer = "";
    checked = false;
    grading = false;
    gradeResult = null;
    gradeError = "";
  }

  function move(delta: number) {
    if (games.length === 0) return;
    index = (index + delta + games.length) % games.length;
    resetAnswerState();
  }

  function shuffleOrder() {
    // Jump to a random card
    if (games.length > 1) {
      const next = Math.floor(Math.random() * (games.length - 1));
      index = next >= index ? next + 1 : next;
    }
    resetAnswerState();
  }

  async function checkAnswer() {
    if (!current || !hasAnswer || grading) return;
    const activeSubmission = ++submissionId;
    grading = true;
    checked = false;
    gradeResult = null;
    gradeError = "";
    try {
      const result = await scoreGameAnswer({
        lesson: lessonSub?.lesson,
        game: current,
        answer: answer.trim(),
      });
      if (activeSubmission !== submissionId) return;
      gradeResult = result;
      checked = true;
    } catch (err) {
      if (activeSubmission !== submissionId) return;
      gradeError = err instanceof Error ? err.message : String(err);
    } finally {
      if (activeSubmission === submissionId) grading = false;
    }
  }

  async function generateGames() {
    if (generatingGames) return;
    generatingGames = true;
    generateError = "";
    try {
      await createGameBatch({
        courseId,
        lessonId,
        requestedType: typeFilter === "all" ? "mixed" : typeFilter,
        count: typeFilter === "all" ? 5 : 3,
      });
    } catch (err) {
      generateError = err instanceof Error ? err.message : String(err);
    } finally {
      generatingGames = false;
    }
  }
</script>

<!-- Full-height flex column matching legacy layout -->
<div class="flex flex-col" style="min-height: 520px;">

  <!-- Generation status banner — auto-hides 60 s after completion, or on X -->
  {#if isBannerVisible(latestBatch)}
    {@const batch = latestBatch!}
    <div class="mb-3 flex-shrink-0 rounded-md border px-3 py-2 text-sm
      {batch.status === 'error'
        ? 'border-[#fecaca] bg-[#fef2f2] text-(--color-danger)'
        : batchRunning
          ? 'border-[#bfdbfe] bg-[#eff6ff] text-[#1d4ed8]'
          : 'border-[#bbf7d0] bg-[#f0fdf4] text-[#15803d]'}">
      <div class="flex items-center justify-between gap-2">
        <span class="font-medium">
          {batch.status === "error" ? "Generation failed" : batchRunning ? "Generating games…" : "Generation complete"}
        </span>
        <div class="flex items-center gap-1.5">
          {#if !batchRunning}
            <button
              type="button"
              onclick={() => dismissBatch(batch.id)}
              class="rounded p-0.5 opacity-50 hover:opacity-100"
              aria-label="Dismiss"
            >
              <X size={12} aria-hidden="true" />
            </button>
          {/if}
        </div>
      </div>
      {#if batch.error}
        <p class="mt-1">{batch.error}</p>
      {:else if batchRunning && batch.statusLog?.length}
        <p class="mt-1 opacity-75">{batch.statusLog[batch.statusLog.length - 1]?.message ?? ""}</p>
      {/if}
      {#if batch.status === "error"}
        <button
          type="button"
          onclick={() => void retryGameBatchGeneration(courseId, lessonId, batch.id)}
          class="mt-2 inline-flex items-center gap-1.5 rounded-md border border-current px-2 py-1 text-xs font-medium"
        >
          <RefreshCw size={11} aria-hidden="true" /> Try again
        </button>
      {/if}
    </div>
  {/if}

  {#if !sub || sub.loading}
    <div class="flex flex-1 items-center justify-center">
      <p class="text-(--color-muted) text-sm">Loading games…</p>
    </div>

  {:else if sub.error}
    <p class="text-(--color-danger) text-sm">Failed to load games: {sub.error.message}</p>

  {:else if allGames.length === 0}
    <!-- Empty state -->
    <div class="flex flex-1 flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-(--color-border) py-20">
      <p class="text-(--color-muted) text-sm">No games for this lesson yet.</p>
      <button
        type="button"
        onclick={() => void generateGames()}
        disabled={generatingGames}
        class="inline-flex items-center gap-1.5 rounded-md bg-(--color-accent) px-4 py-2 text-sm font-medium text-white hover:bg-(--color-accent-hover) disabled:opacity-50"
      >
        <Sparkles size={14} aria-hidden="true" />
        {generatingGames ? "Generating…" : "Generate games"}
      </button>
      {#if generateError}<p class="text-sm text-(--color-danger)">{generateError}</p>{/if}
    </div>

  {:else}
    <!-- Type tab bar -->
    <div class="mb-0 flex flex-shrink-0 items-center justify-between gap-2 border-b border-(--color-border) pb-0">
      <div class="flex gap-0.5 overflow-x-auto">
        <button
          type="button"
          onclick={() => { typeFilter = "all"; index = 0; resetAnswerState(); }}
          class="h-8 rounded-t px-3 text-xs font-bold transition-colors
            {typeFilter === 'all'
              ? 'bg-(--color-accent) text-white'
              : 'text-(--color-muted) hover:text-(--color-text) hover:bg-(--color-surface-muted)'}"
        >
          All
        </button>
        {#each gameTypes as type}
          <button
            type="button"
            onclick={() => { typeFilter = type; index = 0; resetAnswerState(); }}
            class="h-8 rounded-t px-3 text-xs font-bold whitespace-nowrap transition-colors
              {typeFilter === type
                ? 'bg-(--color-accent) text-white'
                : 'text-(--color-muted) hover:text-(--color-text) hover:bg-(--color-surface-muted)'}"
          >
            {shortLabel(type)}
          </button>
        {/each}
      </div>
      <div class="flex items-center gap-1 pb-1 flex-shrink-0">
        <button
          type="button"
          onclick={shuffleOrder}
          class="grid h-7 w-7 place-items-center rounded border border-(--color-border) text-(--color-muted) hover:border-(--color-accent) hover:text-(--color-accent)"
          title="Shuffle"
        >
          <Shuffle size={13} aria-hidden="true" />
        </button>
        <button
          type="button"
          onclick={() => void generateGames()}
          disabled={generatingGames}
          class="inline-flex h-7 items-center gap-1 rounded border border-(--color-border) px-2 text-xs font-bold text-(--color-muted) hover:border-(--color-accent) hover:text-(--color-accent) disabled:opacity-40"
          title="Generate more"
        >
          <Sparkles size={12} aria-hidden="true" />
          {generatingGames ? "…" : "Generate"}
        </button>
      </div>
    </div>

    {#if games.length === 0}
      <div class="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
        <p class="text-sm text-(--color-muted)">No {label(typeFilter)} games yet.</p>
        <button
          type="button"
          onclick={() => void generateGames()}
          disabled={generatingGames}
          class="inline-flex items-center gap-1.5 rounded-md bg-(--color-accent) px-3 py-1.5 text-sm font-medium text-white hover:bg-(--color-accent-hover) disabled:opacity-50"
        >
          <Sparkles size={13} aria-hidden="true" />
          {generatingGames ? "Generating…" : "Generate this type"}
        </button>
      </div>

    {:else if current}
      <!-- Question area — flex-1, vertically centered -->
      <div class="flex flex-1 flex-col items-center justify-center px-4 py-6 text-center">
        <!-- Counter + type badge -->
        <div class="mb-4 flex w-full max-w-xl items-center justify-between">
          <div class="flex flex-col items-start gap-1">
            <span class="inline-flex items-center rounded bg-(--color-accent)/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-(--color-accent)">
              {label(current.type)}
            </span>
            <span class="text-[11px] font-bold text-(--color-muted)">{index + 1} / {games.length}</span>
          </div>
          {#if current.direction}
            <span class="text-xs text-(--color-muted)">{current.direction}</span>
          {/if}
        </div>

        <!-- Passage (for reading comprehension) -->
        {#if current.passage}
          <div class="mb-5 w-full max-w-xl rounded-lg border border-(--color-border) bg-(--color-surface-muted) px-5 py-4 text-left font-serif text-base leading-relaxed">
            {current.passage}
          </div>
          {#if current.question}
            <p class="mb-2 w-full max-w-xl text-left text-base font-medium">{current.question}</p>
          {/if}
        {/if}

        <!-- Main prompt — large and prominent -->
        <p class="max-w-xl text-balance font-bold leading-snug text-(--color-text)"
           style="font-size: clamp(1.3rem, 4vw, 2rem);">
          {current.prompt}
        </p>
      </div>

      <!-- Answer + result area -->
      <div class="flex-shrink-0 px-4 pb-3">
        <input
          type="text"
          bind:value={answer}
          disabled={checked || grading}
          class="w-full rounded-lg border border-(--color-border) bg-(--color-surface-muted) px-4 py-3 text-base focus:border-(--color-accent) focus:outline-none focus:ring-1 focus:ring-(--color-accent) disabled:opacity-60"
          placeholder="Your answer…"
          onkeydown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            if (checked) move(1);
            else void checkAnswer();
          }}
        />

        {#if grading}
          <div class="mt-3 rounded-lg bg-[#eff6ff] px-4 py-3 text-sm text-[#1d4ed8]">
            Grading with AI…
          </div>
        {:else if gradeError}
          <div class="mt-3 rounded-lg bg-[#fef2f2] px-4 py-3 text-sm text-(--color-danger)">
            {gradeError}
          </div>
        {:else if checked && gradeResult}
          {@const verdict = gradeResult.verdict}
          <div class="mt-3 rounded-lg border px-4 py-3 text-sm
            {verdict === 'correct'
              ? 'border-[#17614f]/30 bg-[#17614f]/5 text-[#17614f]'
              : verdict === 'almost'
                ? 'border-[#a77716]/30 bg-[#a77716]/5 text-[#92400e]'
                : 'border-[#a24f3f]/30 bg-[#a24f3f]/5 text-(--color-danger)'}">
            <div class="mb-1 flex items-center gap-2">
              <span class="text-base font-black">
                {verdict === "correct" ? "✓" : verdict === "almost" ? "~" : "✗"}
              </span>
              <span class="font-bold">
                {verdict === "correct" ? "Correct" : verdict === "almost" ? "Close" : "Not quite"}
              </span>
              <span class="ml-auto text-xs font-bold opacity-60">
                {Math.round(gradeResult.score * 100)}%
              </span>
            </div>
            <p>{gradeResult.feedback}</p>
            {#if gradeResult.betterAnswer}
              <p class="mt-1.5 text-xs opacity-75"><strong>Target:</strong> {gradeResult.betterAnswer}</p>
            {/if}
            {#if gradeResult.greekCorrection?.tips?.length}
              <p class="mt-2 text-xs opacity-80">{gradeResult.greekCorrection.correctedText}</p>
            {/if}
          </div>
        {/if}
      </div>

      <!-- Nav bar pinned to bottom -->
      <div class="flex flex-shrink-0 items-center justify-center gap-2 border-t border-(--color-border) px-4 py-3">
        <button
          type="button"
          onclick={() => move(-1)}
          class="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-(--color-border) text-(--color-muted) hover:border-(--color-accent) hover:text-(--color-accent)"
          title="Previous"
        >
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
        <button
          type="button"
          onclick={() => move(1)}
          class="h-9 rounded-lg border border-(--color-border) px-4 text-sm font-bold text-(--color-muted) hover:border-(--color-accent) hover:text-(--color-accent)"
        >
          Skip
        </button>
        {#if checked}
          <button
            type="button"
            onclick={() => move(1)}
            class="inline-flex h-9 items-center gap-1.5 rounded-lg bg-(--color-accent) px-5 text-sm font-bold text-white shadow-sm hover:bg-(--color-accent-hover)"
          >
            Next <ChevronRight size={15} aria-hidden="true" />
          </button>
        {:else}
          <button
            type="button"
            onclick={() => void checkAnswer()}
            disabled={!hasAnswer || grading}
            class="inline-flex h-9 items-center gap-1.5 rounded-lg bg-(--color-accent) px-5 text-sm font-bold text-white shadow-sm hover:bg-(--color-accent-hover) disabled:opacity-40"
          >
            <Check size={15} aria-hidden="true" />
            {grading ? "Checking…" : "Check"}
          </button>
        {/if}
        <button
          type="button"
          onclick={() => move(1)}
          class="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-(--color-border) text-(--color-muted) hover:border-(--color-accent) hover:text-(--color-accent)"
          title="Next"
        >
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </div>

      {#if generateError}
        <p class="pb-2 text-center text-xs text-(--color-danger)">{generateError}</p>
      {/if}
    {/if}
  {/if}
</div>
