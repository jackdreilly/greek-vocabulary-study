<script lang="ts">
  import { createGameBatch } from "../../lib/data/createGameBatch";
  import { scoreGameAnswer, type GameScoreResult } from "../../lib/data/gameScoring";
  import { retryGameBatchGeneration } from "../../lib/data/retryGeneration";
  import { subscribeGames, subscribeLatestGameBatches, subscribeLesson } from "../../lib/data/lessons.svelte";
  import { ChevronLeft, ChevronRight, Check, RefreshCw, Sparkles } from "lucide-svelte";

  let { courseId, lessonId }: { courseId: string; lessonId: string } = $props();

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
    };
  });

  const allGames = $derived(sub?.games ?? []);
  const gameTypes = $derived([...new Set(allGames.map((game) => game.type))]);
  const games = $derived(typeFilter === "all" ? allGames : allGames.filter((game) => game.type === typeFilter));
  const current = $derived(games[index]);
  const progress = $derived(games.length ? ((index + 1) / games.length) * 100 : 0);
  const hasAnswer = $derived(answer.trim().length > 0);
  const latestBatch = $derived(batchSub?.latest ?? null);
  const batchRunning = $derived(latestBatch?.status === "initializing" || latestBatch?.status === "streaming");
  const batchMessages = $derived((latestBatch?.statusLog ?? []).slice(-4));

  function label(type: string) {
    return type
      .split("_")
      .map((part) => part[0]?.toUpperCase() + part.slice(1))
      .join(" ");
  }

  function resetAnswerState() {
    submissionId += 1;
    answer = "";
    checked = false;
    grading = false;
    gradeResult = null;
    gradeError = "";
  }

  function continuePractice() {
    if (index < games.length - 1) {
      index += 1;
      resetAnswerState();
    } else {
      index = 0;
      resetAnswerState();
    }
  }

  function move(delta: number) {
    if (games.length === 0) return;
    index = (index + delta + games.length) % games.length;
    resetAnswerState();
  }

  function skip() {
    move(1);
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

<div>
  {#if latestBatch}
    <div
      class="mb-4 rounded-md border px-3 py-2 text-sm {latestBatch.status === 'error'
        ? 'border-[#fecaca] bg-[#fef2f2] text-(--color-danger)'
        : batchRunning
          ? 'border-[#bfdbfe] bg-[#eff6ff] text-[#1d4ed8]'
          : 'border-[#bbf7d0] bg-[#f0fdf4] text-[#15803d]'}"
    >
      <div class="flex items-center justify-between gap-3">
        <span class="font-medium">
          {latestBatch.status === "error"
            ? "Game generation failed"
            : batchRunning
              ? "Game generation running"
              : "Game generation complete"}
        </span>
        <span class="text-xs uppercase tracking-wide opacity-75">{latestBatch.status}</span>
      </div>
      {#if latestBatch.error}
        <p class="mt-1">{latestBatch.error}</p>
      {:else if batchMessages.length}
        <ul class="mt-1 space-y-0.5">
          {#each batchMessages as item}
            <li>{item.message}</li>
          {/each}
        </ul>
      {/if}
      {#if latestBatch.status === "error"}
        <button
          type="button"
          onclick={() => void retryGameBatchGeneration(courseId, lessonId, latestBatch.id)}
          class="mt-2 inline-flex items-center gap-1.5 rounded-md border border-current px-2 py-1 text-xs font-medium"
        >
          <RefreshCw size={12} aria-hidden="true" />
          Try again
        </button>
      {/if}
    </div>
  {/if}

  {#if !sub || sub.loading}
    <p class="text-(--color-muted)">Loading games...</p>
  {:else if sub.error}
    <p class="text-(--color-danger)">Failed to load games: {sub.error.message}</p>
  {:else if allGames.length === 0}
    <div class="text-center py-16 border border-dashed border-(--color-border) rounded-lg">
      <p class="text-(--color-muted) text-sm">No games for this lesson yet.</p>
      <button
        type="button"
        onclick={() => void generateGames()}
        disabled={generatingGames}
        class="mt-4 inline-flex items-center justify-center gap-1.5 rounded-md bg-(--color-accent) px-4 py-2 text-sm font-medium text-white hover:bg-(--color-accent-hover) disabled:opacity-50"
      >
        <Sparkles size={14} aria-hidden="true" />
        {generatingGames ? "Generating..." : "Generate games"}
      </button>
      {#if generateError}
        <p class="mt-2 text-sm text-(--color-danger)">{generateError}</p>
      {/if}
    </div>
  {:else if games.length === 0}
    <div>
      <select
        bind:value={typeFilter}
        onchange={() => {
          index = 0;
          resetAnswerState();
        }}
        class="mb-4 rounded-md border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm"
      >
        <option value="all">All game types</option>
        {#each gameTypes as type}
          <option value={type}>{label(type)}</option>
        {/each}
      </select>
      <p class="text-(--color-muted)">No games match this filter.</p>
      <button
        type="button"
        onclick={() => void generateGames()}
        disabled={generatingGames}
        class="mt-4 inline-flex items-center justify-center gap-1.5 rounded-md bg-(--color-accent) px-4 py-2 text-sm font-medium text-white hover:bg-(--color-accent-hover) disabled:opacity-50"
      >
        <Sparkles size={14} aria-hidden="true" />
        {generatingGames ? "Generating..." : "Generate this type"}
      </button>
    </div>
  {:else if current}
    <section class="max-w-xl mx-auto">
      <div class="mb-4">
        <div class="mb-2 flex flex-wrap items-center justify-between gap-3 text-sm text-(--color-muted)">
          <span>{index + 1} / {games.length}</span>
          <div class="flex flex-wrap items-center gap-2">
            <label class="flex items-center gap-2">
              <span>Type</span>
              <select
                bind:value={typeFilter}
                onchange={() => {
                  index = 0;
                  resetAnswerState();
                }}
                class="rounded-md border border-(--color-border) bg-(--color-surface) px-2 py-1 text-sm text-(--color-text)"
              >
                <option value="all">All</option>
                {#each gameTypes as type}
                  <option value={type}>{label(type)}</option>
                {/each}
              </select>
            </label>
            <button
              type="button"
              onclick={() => void generateGames()}
              disabled={generatingGames}
              class="inline-flex items-center gap-1 rounded-md border border-(--color-border) px-2 py-1 text-sm text-(--color-text) hover:bg-(--color-surface-muted) disabled:opacity-50"
            >
              <Sparkles size={12} aria-hidden="true" />
              {generatingGames ? "Generating..." : "Generate"}
            </button>
          </div>
        </div>
        {#if generateError}
          <p class="mb-2 text-sm text-(--color-danger)">{generateError}</p>
        {/if}
        <div class="h-1 rounded-full bg-(--color-border) overflow-hidden">
          <div
            class="h-full rounded-full bg-(--color-accent) transition-[width]"
            style="width: {progress}%"
          ></div>
        </div>
      </div>

      <article class="rounded-lg border border-(--color-border) bg-(--color-surface) p-5 shadow-sm">
        <div class="mb-5 flex items-baseline justify-between gap-3">
          <div>
            <h2 class="text-xl font-semibold tracking-tight">
              {current.title ?? label(current.type)}
            </h2>
            <p class="text-sm text-(--color-muted)">{label(current.type)}</p>
          </div>
          {#if current.direction}
            <span class="text-xs text-(--color-muted)">{current.direction}</span>
          {/if}
        </div>

        {#if current.passage}
          <p class="mb-4 rounded-md bg-(--color-surface-muted) px-4 py-3 font-serif text-lg leading-relaxed">
            {current.passage}
          </p>
        {/if}
        {#if current.question}
          <p class="mb-2 text-base font-medium">{current.question}</p>
        {/if}
        <p class="mb-5 text-lg">{current.prompt}</p>

        <input
          type="text"
          bind:value={answer}
          disabled={checked || grading}
          class="w-full rounded-md border border-(--color-border) bg-(--color-surface) px-3 py-3 text-base focus:outline-none focus:border-(--color-accent) focus:ring-1 focus:ring-(--color-accent) disabled:bg-(--color-surface-muted)"
          placeholder="Type your answer"
          onkeydown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void checkAnswer();
            }
          }}
        />

        {#if grading}
          <div class="mt-4 rounded-md bg-[#eff6ff] px-4 py-3 text-sm text-[#1d4ed8]">
            Grading with AI...
          </div>
        {:else if gradeError}
          <div class="mt-4 rounded-md bg-[#fef2f2] px-4 py-3 text-sm text-(--color-danger)">
            Grading failed: {gradeError}
          </div>
        {:else if checked && gradeResult}
          <div
            class="mt-4 rounded-md px-4 py-3 text-sm {gradeResult.accepted
              ? 'bg-[#f0fdf4] text-[#15803d]'
              : 'bg-[#fef2f2] text-(--color-danger)'}"
          >
            <p class="font-medium">{gradeResult.verdict === "correct" ? "Correct." : gradeResult.verdict === "almost" ? "Almost." : "Not quite."}</p>
            <p>{gradeResult.feedback}</p>
            {#if !gradeResult.accepted && gradeResult.betterAnswer}
              <p class="mt-2">Better answer: {gradeResult.betterAnswer}</p>
            {/if}
            {#if gradeResult.greekCorrection?.tips?.length}
              <p class="mt-2">{gradeResult.greekCorrection.correctedText}</p>
            {/if}
          </div>
        {/if}

        {#if current.requiredWords?.length}
          <p class="mt-4 text-xs text-(--color-muted)">
            Words: {current.requiredWords.join(", ")}
          </p>
        {/if}
      </article>

      <div class="mt-4 flex items-center justify-between gap-2">
        <button
          type="button"
          onclick={() => move(-1)}
          class="inline-flex items-center gap-1.5 rounded-md border border-(--color-border) px-4 py-2 text-sm hover:bg-(--color-surface-muted)"
        >
          <ChevronLeft size={14} aria-hidden="true" />
          Previous
        </button>
        <div class="flex gap-2">
          <button
            type="button"
            onclick={skip}
            class="rounded-md border border-(--color-border) px-4 py-2 text-sm hover:bg-(--color-surface-muted)"
          >
            Skip
          </button>
          {#if checked}
            <button
              type="button"
              onclick={continuePractice}
              class="inline-flex items-center gap-1.5 rounded-md bg-(--color-accent) px-4 py-2 text-sm font-medium text-white hover:bg-(--color-accent-hover)"
            >
              {index < games.length - 1 ? "Continue" : "Restart"}
              <ChevronRight size={14} aria-hidden="true" />
            </button>
          {:else}
            <button
              type="button"
              onclick={() => void checkAnswer()}
              disabled={!hasAnswer || grading}
              class="inline-flex items-center gap-1.5 rounded-md bg-(--color-accent) px-4 py-2 text-sm font-medium text-white hover:bg-(--color-accent-hover) disabled:opacity-50"
            >
              <Check size={14} aria-hidden="true" />
              {grading ? "Checking" : "Check"}
            </button>
          {/if}
        </div>
      </div>
    </section>
  {/if}
</div>
