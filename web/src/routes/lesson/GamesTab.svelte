<script lang="ts">
  import { createGameBatch } from "../../lib/data/createGameBatch";
  import { scoreGameAnswer, type GameScoreResult } from "../../lib/data/gameScoring";
  import { getGameHint } from "../../lib/data/gameHints";
  import { retryGameBatchGeneration } from "../../lib/data/retryGeneration";
  import { subscribeGames, subscribeLatestGameBatches, subscribeLesson } from "../../lib/data/lessons.svelte";
  import { hasGreek } from "../../lib/data/yiayia";
  import GreekCorrectionCard from "../../lib/ui/GreekCorrectionCard.svelte";
  import SkillLevelPicker from "../../lib/ui/SkillLevelPicker.svelte";
  import { inferSkillLevel, SKILL_LEVEL_LABEL, type SkillLevel } from "../../lib/skillLevel";
  import { Check, ChevronLeft, ChevronRight, Lightbulb, RefreshCw, Shuffle, Sparkles, X } from "lucide-svelte";
  import { clearFocus, setFocus } from "../../lib/data/yiayiaFocus.svelte";
  import GenerateModal from "../../lib/ui/GenerateModal.svelte";

  type GamesSub = ReturnType<typeof subscribeGames>;
  type LessonSub = ReturnType<typeof subscribeLesson>;
  type GameBatchSub = ReturnType<typeof subscribeLatestGameBatches>;

  let {
    courseId,
    lessonId,
    canGenerate = true,
    gamesSub: providedGamesSub,
    lessonSub: providedLessonSub,
    gameBatchSub: providedGameBatchSub,
  }: {
    courseId: string;
    lessonId: string;
    canGenerate?: boolean;
    gamesSub?: GamesSub;
    lessonSub?: LessonSub;
    gameBatchSub?: GameBatchSub;
  } = $props();

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

  // Per-lesson games progress persistence — survives tab switches and refreshes.
  type GamesState = { index: number; typeFilter: string };
  function gamesStorageKey(c: string, l: string) {
    return `greekflash:games:${c}:${l}`;
  }
  function loadGamesState(c: string, l: string): GamesState | null {
    try {
      const raw = localStorage.getItem(gamesStorageKey(c, l));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<GamesState>;
      return {
        index: Math.max(0, Number(parsed.index ?? 0)),
        typeFilter: typeof parsed.typeFilter === "string" ? parsed.typeFilter : "all",
      };
    } catch {
      return null;
    }
  }
  function saveGamesState(c: string, l: string, state: GamesState) {
    try {
      localStorage.setItem(gamesStorageKey(c, l), JSON.stringify(state));
    } catch {
      // ignore quota / disabled storage
    }
  }

  let sub = $state<GamesSub>();
  let lessonSub = $state<LessonSub>();
  let batchSub = $state<GameBatchSub>();
  let index = $state(0);
  let answer = $state("");
  let checked = $state(false);
  let grading = $state(false);
  let gradeResult = $state<GameScoreResult | null>(null);
  let gradeError = $state("");
  let typeFilter = $state("all");
  let generatingGames = $state(false);
  let generateError = $state("");
  let generateOpen = $state(false);
  let generatePrompt = $state("");
  let generateSkillLevel = $state<SkillLevel | "">("");
  let generateCount = $state(10);
  let submissionId = 0;
  let gameDragX = $state(0);
  let gameDragY = $state(0);
  let gameDragStart = $state<{ pointerId: number; x: number; y: number } | null>(null);
  let gameDragTransition = $state(false);
  let hints = $state<string[] | null>(null);
  let hintIndex = $state(0);
  let hintLoading = $state(false);

  $effect(() => {
    // Rehydrate per-lesson games progress.
    const restored = loadGamesState(courseId, lessonId);
    index = restored?.index ?? 0;
    typeFilter = restored?.typeFilter ?? "all";
    answer = "";
    checked = false;
    grading = false;
    gradeResult = null;
    gradeError = "";
    generatingGames = false;
    generateError = "";

    if (providedGamesSub && providedLessonSub && providedGameBatchSub) {
      sub = providedGamesSub;
      lessonSub = providedLessonSub;
      batchSub = providedGameBatchSub;
      return () => clearFocus();
    }

    const next = subscribeGames(courseId, lessonId);
    const nextLesson = subscribeLesson(courseId, lessonId);
    const nextBatch = subscribeLatestGameBatches(courseId, lessonId);
    sub = next;
    lessonSub = nextLesson;
    batchSub = nextBatch;
    return () => {
      next.stop();
      nextLesson.stop();
      nextBatch.stop();
      clearFocus();
    };
  });

  // Persist on change.
  $effect(() => {
    saveGamesState(courseId, lessonId, { index, typeFilter });
  });

  // Clamp index when the filtered game list grows/shrinks.
  $effect(() => {
    const total = games.length;
    if (total > 0 && index >= total) {
      index = total - 1;
    }
  });

  // Keep yiayiaFocus in sync with the current game's target words.
  $effect(() => {
    if (current) {
      const words = current.requiredWords?.length ? current.requiredWords : [];
      setFocus({
        kind: "game",
        label: `Game: ${label(current.type)}`,
        courseId,
        lessonId,
        tab: "games",
        gameId: current.id,
        type: current.type,
        title: current.title || label(current.type),
        prompt: current.prompt,
        summary: [current.passage, current.question, current.rubric].filter(Boolean).join("\n\n"),
        expectedAnswer: current.expectedAnswer,
        words,
        index: index + 1,
        total: games.length,
      });
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
    hints = null;
    hintIndex = 0;
    hintLoading = false;
  }

  async function requestHint() {
    if (!current || hintLoading) return;
    if (hints) { hintIndex = Math.min(hintIndex + 1, hints.length - 1); return; }
    hintLoading = true;
    try {
      hints = await getGameHint(courseId, lessonId, current.id);
      hintIndex = 0;
    } catch {
      // silently ignore — button will re-enable
    } finally {
      hintLoading = false;
    }
  }

  function resetGameDrag() {
    gameDragStart = null;
    gameDragX = 0;
    gameDragY = 0;
    gameDragTransition = false;
  }

  function handleGamePointerDown(event: PointerEvent) {
    if (checked || grading) return;
    const target = event.target as HTMLElement;
    if (target.closest("input, button, textarea, a")) return;
    gameDragTransition = false;
    gameDragStart = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    gameDragX = 0;
    gameDragY = 0;
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  }

  function handleGamePointerMove(event: PointerEvent) {
    if (!gameDragStart || gameDragStart.pointerId !== event.pointerId) return;
    gameDragX = event.clientX - gameDragStart.x;
    gameDragY = event.clientY - gameDragStart.y;
  }

  function handleGamePointerUp(event: PointerEvent) {
    if (!gameDragStart || gameDragStart.pointerId !== event.pointerId) return;
    const absX = Math.abs(gameDragX);
    const absY = Math.abs(gameDragY);
    const swiped = absX > 80 && absX > absY * 1.2;
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
    if (swiped) {
      const delta = gameDragX > 0 ? -1 : 1;
      gameDragTransition = true;
      gameDragX = gameDragX > 0 ? 450 : -450;
      gameDragY = Math.max(-60, Math.min(60, gameDragY));
      setTimeout(() => { move(delta); resetGameDrag(); }, 140);
      return;
    }
    gameDragTransition = true;
    gameDragX = 0;
    gameDragY = 0;
    gameDragStart = null;
    setTimeout(() => { gameDragTransition = false; }, 150);
  }

  function handleGamePointerCancel() {
    gameDragTransition = true;
    gameDragX = 0;
    gameDragY = 0;
    gameDragStart = null;
    setTimeout(() => { gameDragTransition = false; }, 150);
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
        courseId,
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

  const inheritedLevel = $derived<SkillLevel | undefined>(
    (lessonSub?.lesson?.skillLevel as SkillLevel | undefined) ?? undefined,
  );

  async function generateGames() {
    if (generatingGames) return;
    generatingGames = true;
    generateError = "";
    try {
      const resolved: SkillLevel | undefined =
        generateSkillLevel || inferSkillLevel(generatePrompt) || inheritedLevel;
      await createGameBatch({
        courseId,
        lessonId,
        requestedType: typeFilter === "all" ? "mixed" : typeFilter,
        count: Math.max(10, Math.min(30, Math.round(generateCount))),
        customFocus: generatePrompt,
        skillLevel: resolved,
      });
      generatePrompt = "";
      generateSkillLevel = "";
      generateCount = 10;
      generateOpen = false;
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
    <div class="flex flex-1 flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-(--color-border) px-6 py-16">
      <p class="text-(--color-muted) text-sm">No games for this lesson yet.</p>
      {#if canGenerate}
        <button
          type="button"
          onclick={() => (generateOpen = true)}
          disabled={generatingGames}
          class="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-700 hover:border-amber-300 hover:bg-amber-100 disabled:opacity-50"
        >
          <Sparkles size={14} aria-hidden="true" />
          {generatingGames ? "Generating…" : "Generate games"}
        </button>
      {/if}
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
        {#if canGenerate}
          <button
            type="button"
            onclick={() => (generateOpen = true)}
            disabled={generatingGames}
            class="inline-flex h-7 items-center gap-1 rounded border border-amber-200 bg-amber-50 px-2 text-xs font-semibold text-amber-700 hover:border-amber-300 hover:bg-amber-100 disabled:opacity-40"
            title="Generate more games"
          >
            <Sparkles size={12} aria-hidden="true" />
            {generatingGames ? "…" : "Generate"}
          </button>
        {/if}
      </div>
    </div>

    {#if games.length === 0}
      <div class="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
        <p class="text-sm text-(--color-muted)">No {label(typeFilter)} games yet.</p>
        {#if canGenerate}
          <button
            type="button"
            onclick={() => (generateOpen = true)}
            disabled={generatingGames}
            class="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm font-semibold text-amber-700 hover:border-amber-300 hover:bg-amber-100 disabled:opacity-50"
          >
            <Sparkles size={13} aria-hidden="true" />
            {generatingGames ? "Generating…" : "Generate this type"}
          </button>
        {/if}
      </div>

    {:else if current}
      <div class="relative flex flex-1 flex-col overflow-hidden"
        onpointerdown={handleGamePointerDown}
        onpointermove={handleGamePointerMove}
        onpointerup={handleGamePointerUp}
        onpointercancel={handleGamePointerCancel}
      >
        <div
          class="flex flex-1 flex-col {gameDragTransition ? 'transition-transform duration-150 ease-out' : ''}"
          style="transform: translate({gameDragX}px, {gameDragY * 0.15}px) rotate({gameDragX / 22}deg)"
        >
          {#if Math.abs(gameDragX) > 30 && !checked && !grading}
            <div
              class="pointer-events-none absolute top-16 z-10
                {gameDragX > 0
                  ? 'left-6 -rotate-12 border-[#15803d] text-[#15803d]'
                  : 'right-6 rotate-12 border-[#dc2626] text-[#dc2626]'}
                rounded-lg border-[2.5px] bg-white/90 px-4 py-1.5 text-sm font-black uppercase tracking-widest shadow-sm"
              style="opacity: {Math.min(1, (Math.abs(gameDragX) - 30) / 80)}"
            >
              {gameDragX > 0 ? '← Back' : 'Skip →'}
            </div>
          {/if}

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
        </div>

        <!-- Passage (for reading comprehension) -->
        {#if current.passage}
          <div class="mb-3 w-full max-w-xl rounded-lg border border-(--color-border) bg-(--color-surface-muted) px-5 py-4 text-left font-serif text-base leading-relaxed">
            {current.passage}
          </div>
          {#if current.requiredWords?.length}
            <div class="mb-3 flex w-full max-w-xl flex-wrap gap-1.5">
              {#each current.requiredWords as word}
                <span class="rounded-full border border-(--color-accent)/30 bg-(--color-accent)/8 px-2.5 py-0.5 text-sm font-medium text-(--color-accent)">{word}</span>
              {/each}
            </div>
          {/if}
          {#if current.question}
            <p class="mb-2 w-full max-w-xl text-left text-base font-medium">{current.question}</p>
          {/if}
        {/if}

        <!-- Main prompt — hidden for reading cards (passage+question already shown above) -->
        {#if !current.passage}
          <p class="max-w-xl text-balance font-bold leading-snug text-(--color-text)"
             style="font-size: clamp(1.3rem, 4vw, 2rem);">
            {current.prompt}
          </p>
        {/if}
      </div>

      <!-- Answer + result area -->
      <div class="flex-shrink-0 px-4 pb-3">
        <!-- Hint display -->
        {#if hints}
          <div class="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
            <span class="mr-1.5 font-semibold">Hint {hintIndex + 1}:</span>{hints[hintIndex]}
          </div>
        {/if}
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
            {#if gradeResult.greekCorrection && hasGreek(answer)}
              <div class="mt-3">
                <GreekCorrectionCard
                  correction={gradeResult.greekCorrection}
                  userText={answer}
                />
              </div>
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
            onclick={() => resetAnswerState()}
            class="h-9 rounded-lg border border-(--color-border) px-4 text-sm font-bold text-(--color-muted) hover:border-(--color-accent) hover:text-(--color-accent)"
          >
            Try again
          </button>
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
            onclick={() => void requestHint()}
            disabled={hintLoading || (!!hints && hintIndex >= hints.length - 1)}
            class="inline-flex h-9 items-center gap-1.5 rounded-lg border border-amber-300 px-3 text-sm font-medium text-amber-600 hover:border-amber-400 hover:bg-amber-50 disabled:opacity-30"
          >
            <Lightbulb size={14} aria-hidden="true" />
            {hintLoading ? "Loading…" : hints ? `Hint ${hintIndex + 1} / 3` : "Hint"}
          </button>
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
        </div>
      </div>
    {/if}
  {/if}

  <GenerateModal bind:open={generateOpen} title="Generate games">
    <div class="flex flex-col gap-3">
      <label class="block">
        <span class="mb-1 block text-sm font-medium text-(--color-text)">Focus or theme (optional)</span>
        <input
          type="text"
          bind:value={generatePrompt}
          placeholder="e.g. focus on past-tense verbs, or kitchen vocabulary"
          class="w-full rounded-md border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm focus:border-(--color-accent) focus:outline-none focus:ring-1 focus:ring-(--color-accent)"
        />
      </label>
      <div class="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_7rem]">
        <SkillLevelPicker
          bind:value={generateSkillLevel}
          autoLabel={inheritedLevel ? `Inherit from lesson (${SKILL_LEVEL_LABEL[inheritedLevel]})` : "Auto-detect from prompt"}
        />
        <label class="block">
          <span class="mb-1 block text-xs font-medium text-(--color-muted)">Count</span>
          <input
            type="number"
            min="10"
            max="30"
            bind:value={generateCount}
            class="w-full rounded-md border border-(--color-border) bg-(--color-surface) px-2 py-1.5 text-sm focus:border-(--color-accent) focus:outline-none focus:ring-1 focus:ring-(--color-accent)"
          />
        </label>
      </div>
      {#if generateError}
        <p class="text-sm text-(--color-danger)">{generateError}</p>
      {/if}
      <button
        type="button"
        onclick={() => void generateGames()}
        disabled={generatingGames}
        class="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
      >
        <Sparkles size={14} aria-hidden="true" />
        {generatingGames ? "Starting…" : `Generate ${Math.max(10, Math.min(30, generateCount))} games`}
      </button>
    </div>
  </GenerateModal>
</div>
