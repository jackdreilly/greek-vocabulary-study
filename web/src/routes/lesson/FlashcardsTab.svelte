<script lang="ts">
  import { subscribeEntries, entryPrimaryEnglish } from "../../lib/data/lessons.svelte";
  import GreekText from "../../lib/ui/GreekText.svelte";
  import AudioPlayButton from "../../lib/ui/AudioPlayButton.svelte";
  import { clearFocus, setFocus } from "../../lib/data/yiayiaFocus.svelte";

  type EntriesSub = ReturnType<typeof subscribeEntries>;
  type Mode = "gr-en" | "en-gr" | "mixed";

  let {
    courseId,
    lessonId,
    entriesSub: providedEntriesSub,
  }: { courseId: string; lessonId: string; entriesSub?: EntriesSub } = $props();

  // Persist flashcard order/progress per-lesson so tab switches and refreshes preserve state.
  type FlashcardState = { index: number; mode: Mode; deckSeed: number };
  function storageKey(c: string, l: string) {
    return `greekflash:flashcards:${c}:${l}`;
  }
  function loadState(c: string, l: string): FlashcardState | null {
    try {
      const raw = localStorage.getItem(storageKey(c, l));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<FlashcardState>;
      const mode: Mode = parsed.mode === "en-gr" || parsed.mode === "mixed" ? parsed.mode : "gr-en";
      return {
        index: Math.max(0, Number(parsed.index ?? 0)),
        mode,
        deckSeed: Number(parsed.deckSeed ?? 0),
      };
    } catch {
      return null;
    }
  }
  function saveState(c: string, l: string, state: FlashcardState) {
    try {
      localStorage.setItem(storageKey(c, l), JSON.stringify(state));
    } catch {
      // ignore quota / disabled storage
    }
  }

  const initial = $derived(loadState(courseId, lessonId));

  let sub = $state<EntriesSub>();
  let index = $state(0);
  let flipped = $state(false);
  let mode = $state<Mode>("gr-en");
  let deckSeed = $state(0);
  let dragStart = $state<{ pointerId: number; x: number; y: number } | null>(null);
  let dragX = $state(0);
  let dragY = $state(0);
  let dragTransition = $state(false);
  let suppressNextClick = $state(false);

  $effect(() => {
    // Rehydrate per-lesson state on (courseId, lessonId) change.
    const restored = loadState(courseId, lessonId);
    index = restored?.index ?? 0;
    mode = restored?.mode ?? "gr-en";
    deckSeed = restored?.deckSeed ?? 0;
    flipped = false;

    if (providedEntriesSub) {
      sub = providedEntriesSub;
      return () => clearFocus();
    }

    const next = subscribeEntries(courseId, lessonId);
    sub = next;
    return () => {
      next.stop();
      clearFocus();
    };
  });

  // Persist on any state change.
  $effect(() => {
    saveState(courseId, lessonId, { index, mode, deckSeed });
  });

  // Once entries are loaded, clamp index to a valid value (the lesson may have grown/shrunk).
  $effect(() => {
    const total = sub?.entries?.length ?? 0;
    if (total > 0 && index >= total) {
      index = total - 1;
    }
  });
  // Suppress unused warning for initial — it primes the on-load value.
  void initial;

  // Keep yiayiaFocus in sync with the current card.
  $effect(() => {
    if (current) {
      setFocus({
        kind: "flashcard",
        label: `Flashcard: ${current.lemma}`,
        courseId,
        lessonId,
        tab: "cards",
        entryId: current.id,
        words: [current.lemma],
        title: [current.article, current.lemma].filter(Boolean).join(" "),
        summary: senses(current).filter(Boolean).join("; "),
        index: index + 1,
        total: entries.length,
      });
    } else {
      clearFocus();
    }
  });

  const entries = $derived.by(() => {
    const source = sub?.entries ?? [];
    if (deckSeed === 0) return source;
    return [...source].sort((a, b) => {
      const ak = shuffleKey(a.id, deckSeed);
      const bk = shuffleKey(b.id, deckSeed);
      return ak - bk;
    });
  });
  const current = $derived(entries[index]);
  const direction = $derived(current ? directionForCard(current, index, mode) : "gr-en");
  const progress = $derived(entries.length ? ((index + 1) / entries.length) * 100 : 0);
  const cardTransform = $derived(`translate(${dragX}px, ${dragY}px) rotate(${dragX / 28}deg)`);

  function go(delta: number) {
    if (entries.length === 0) return;
    index = (index + delta + entries.length) % entries.length;
    flipped = false;
  }

  function shuffleKey(id: string, seed: number) {
    let hash = seed || 1;
    for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    return hash;
  }

  function shuffleDeck() {
    deckSeed = Date.now();
    index = 0;
    flipped = false;
  }

  function senses(entry: typeof current) {
    if (!entry) return [];
    return entry.senses?.length ? entry.senses : [entryPrimaryEnglish(entry)];
  }

  function primarySense(entry: typeof current) {
    return senses(entry)[0] ?? "";
  }

  function secondarySenses(entry: typeof current) {
    return senses(entry).slice(1);
  }

  function directionForCard(entry: NonNullable<typeof current>, cardIndex: number, cardMode: typeof mode) {
    if (cardMode === "mixed") return (shuffleKey(entry.id, cardIndex + 17) % 2 === 0) ? "gr-en" : "en-gr";
    return cardMode;
  }

  function handleKeydown(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable) return;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      go(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      go(-1);
    } else if (event.key === " " || event.key === "Enter" || event.key === "ArrowUp") {
      event.preventDefault();
      flipped = !flipped;
    } else if (event.key.toLowerCase() === "s") {
      event.preventDefault();
      shuffleDeck();
    } else if (event.key === "1") {
      mode = "gr-en";
      flipped = false;
    } else if (event.key === "2") {
      mode = "en-gr";
      flipped = false;
    } else if (event.key === "3") {
      mode = "mixed";
      flipped = false;
    }
  }

  function resetDrag() {
    dragStart = null;
    dragX = 0;
    dragY = 0;
    dragTransition = false;
  }

  function handlePointerDown(event: PointerEvent) {
    if (!current || event.button !== 0) return;
    const target = event.target as HTMLElement;
    const interactive = target.closest("button, input, textarea, a");
    if (interactive && interactive !== event.currentTarget) return;

    dragTransition = false;
    dragStart = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    dragX = 0;
    dragY = 0;
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent) {
    if (!dragStart || dragStart.pointerId !== event.pointerId) return;
    dragX = event.clientX - dragStart.x;
    dragY = event.clientY - dragStart.y;
  }

  function handlePointerUp(event: PointerEvent) {
    if (!dragStart || dragStart.pointerId !== event.pointerId) return;
    const absX = Math.abs(dragX);
    const absY = Math.abs(dragY);
    const swiped = absX > 90 && absX > absY * 1.15;
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);

    if (swiped) {
      // Swiping left goes forward (Next), swiping right goes backward (Back)
      const isForward = dragX < 0;
      suppressNextClick = true;
      dragTransition = true;
      dragX = isForward ? -400 : 400;
      dragY = Math.max(-80, Math.min(80, dragY));
      setTimeout(() => {
        go(isForward ? 1 : -1);
        resetDrag();
      }, 130);
      return;
    }

    suppressNextClick = true;
    resetDrag();
    flipped = !flipped;
  }

  function handlePointerCancel() {
    dragTransition = true;
    dragX = 0;
    dragY = 0;
    dragStart = null;
    setTimeout(() => {
      dragTransition = false;
    }, 140);
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div>
  {#if !sub || sub.loading}
    <p class="text-(--color-muted)">Loading cards...</p>
  {:else if sub.error}
    <p class="text-(--color-danger)">Failed to load cards: {sub.error.message}</p>
  {:else if entries.length === 0}
    <div class="text-center py-16 border border-dashed border-(--color-border) rounded-lg">
      <p class="text-(--color-muted) text-sm">No vocabulary cards yet.</p>
    </div>
  {:else}
    <section class="max-w-xl mx-auto">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-3 text-sm text-(--color-muted)">
        <div>
          <span class="font-medium text-(--color-text)">{index + 1}</span>
          <span> / {entries.length}</span>
          {#if current?.category}
            <span class="ml-2">{current.category}</span>
          {/if}
        </div>
        <div class="flex items-center gap-1 rounded-md border border-(--color-border) bg-(--color-surface-muted) p-1">
          {#each [
            { value: "gr-en", label: "GR -> EN" },
            { value: "en-gr", label: "EN -> GR" },
            { value: "mixed", label: "Mixed" },
          ] as option}
            <button
              type="button"
              onclick={() => {
                mode = option.value as typeof mode;
                flipped = false;
              }}
              class="rounded px-2.5 py-1 text-xs font-medium {mode === option.value
                ? 'bg-(--color-accent) text-white'
                : 'text-(--color-muted) hover:text-(--color-text)'}"
            >
              {option.label}
            </button>
          {/each}
        </div>
      </div>

      <div class="mb-5 h-1 rounded-full bg-(--color-border) overflow-hidden">
        <div
          class="h-full rounded-full bg-(--color-accent) transition-[width]"
          style="width: {progress}%"
        ></div>
      </div>

      <button
        type="button"
        onpointerdown={handlePointerDown}
        onpointermove={handlePointerMove}
        onpointerup={handlePointerUp}
        onpointercancel={handlePointerCancel}
        onclick={(event) => {
          if (suppressNextClick) {
            event.preventDefault();
            suppressNextClick = false;
            return;
          }
          flipped = !flipped;
        }}
        class="relative w-full min-h-[22rem] touch-pan-y select-none rounded-lg border px-8 py-8 text-left shadow-sm focus:outline-none focus:ring-2 focus:ring-(--color-accent)
          {flipped
          ? 'border-[#bfdbfe] bg-[#eff6ff] shadow-[0_0_0_1px_rgba(37,99,235,0.10),0_10px_30px_rgba(37,99,235,0.08)]'
          : 'border-(--color-border) bg-(--color-surface) hover:border-(--color-border-strong)'}
          {dragTransition ? 'transition-transform duration-150 ease-out' : ''}"
        style="transform: {cardTransform}"
      >
        {#if flipped}
          <span class="absolute left-5 top-5 rounded border border-[#bfdbfe] bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-(--color-accent)">
            Answer
          </span>
        {/if}
        {#if Math.abs(dragX) > 30}
          <div
            class="pointer-events-none absolute top-7 {dragX > 0
              ? 'left-6 -rotate-12 border-slate-500 text-slate-500'
              : 'right-6 rotate-12 border-blue-500 text-blue-500'} rounded-lg border-[2.5px] bg-white/90 px-4 py-1 text-sm font-black uppercase tracking-widest shadow-sm"
            style="opacity: {Math.min(1, (Math.abs(dragX) - 30) / 80)}"
          >
            {dragX > 0 ? "◀ Back" : "Next ▶"}
          </div>
        {/if}
        {#if !flipped}
          <div class="flex h-full min-h-56 flex-col items-center justify-center text-center">
            {#if direction === "gr-en"}
              <div class="flex items-baseline justify-center gap-2">
                {#if current.article}
                  <span class="text-(--color-muted)">{current.article}</span>
                {/if}
                <GreekText size="lg">{current.lemma}</GreekText>
                {#if current.audio?.url}
                  <AudioPlayButton
                    url={current.audio.url}
                    label=""
                    iconSize={18}
                    class="ml-1 inline-flex h-8 w-8 items-center justify-center rounded-full text-(--color-muted) hover:bg-(--color-surface-muted) hover:text-(--color-accent) disabled:opacity-70"
                  />
                {/if}
              </div>
            {:else}
              <div class="max-w-md text-center">
                <p class="text-3xl font-semibold tracking-tight leading-tight">{primarySense(current)}</p>
                {#if secondarySenses(current).length}
                  <p class="mt-3 text-base text-(--color-muted)">
                    {secondarySenses(current).join("; ")}
                  </p>
                {/if}
              </div>
            {/if}
            <p class="mt-6 text-sm text-(--color-muted)">Tap, Space, or Enter to flip</p>
          </div>
        {:else}
          <div class="flex h-full min-h-56 flex-col items-center justify-center text-center">
            {#if direction === "gr-en"}
              <!-- Back of GR→EN: show English answer, recap Greek below -->
              <div class="max-w-md">
                <p class="text-3xl font-semibold tracking-tight leading-tight">{primarySense(current)}</p>
                {#if secondarySenses(current).length}
                  <p class="mt-3 text-base text-(--color-muted)">
                    {secondarySenses(current).join("; ")}
                  </p>
                {/if}
              </div>
              <div class="mt-8 w-full max-w-md border-t border-(--color-border) pt-5">
                <div class="flex items-baseline justify-center gap-2">
                  {#if current.article}
                    <span class="text-(--color-muted) text-sm">{current.article}</span>
                  {/if}
                  <GreekText>{current.lemma}</GreekText>
                  {#if current.audio?.url}
                    <AudioPlayButton
                      url={current.audio.url}
                      label=""
                      iconSize={16}
                      class="ml-1 inline-flex h-8 w-8 items-center justify-center rounded-full text-(--color-muted) hover:bg-(--color-surface-muted) hover:text-(--color-accent) disabled:opacity-70"
                    />
                  {/if}
                </div>
              </div>
            {:else}
              <!-- Back of EN→GR: show Greek answer, recap English below -->
              <div class="flex items-baseline gap-2">
                {#if current.article}
                  <span class="text-(--color-muted) text-sm">{current.article}</span>
                {/if}
                <GreekText size="lg">{current.lemma}</GreekText>
                {#if current.audio?.url}
                  <AudioPlayButton
                    url={current.audio.url}
                    label=""
                    iconSize={18}
                    class="ml-1 inline-flex h-8 w-8 items-center justify-center rounded-full text-(--color-muted) hover:bg-(--color-surface-muted) hover:text-(--color-accent) disabled:opacity-70"
                  />
                {/if}
              </div>
              <div class="mt-8 w-full max-w-md border-t border-(--color-border) pt-5">
                <p class="text-sm text-(--color-muted)">{senses(current).slice(0, 2).join("; ")}</p>
              </div>
            {/if}
          </div>
        {/if}
      </button>

      <div class="mt-4 grid grid-cols-3 gap-2">
        <button
          type="button"
          onclick={() => go(-1)}
          class="rounded-md border border-(--color-border) px-3 py-2 text-sm hover:bg-(--color-surface-muted)"
        >
          Previous
        </button>
        <button
          type="button"
          onclick={shuffleDeck}
          class="rounded-md border border-(--color-border) px-3 py-2 text-sm hover:bg-(--color-surface-muted)"
        >
          Shuffle
        </button>
        <button
          type="button"
          onclick={() => go(1)}
          class="rounded-md bg-(--color-accent) px-3 py-2 text-sm font-medium text-white hover:bg-(--color-accent-hover)"
        >
          Next
        </button>
      </div>
      <p class="mt-3 text-center text-xs text-(--color-muted)">
        Swipe left/right or use arrow keys to move. Space/Enter flips. S shuffles.
      </p>
    </section>
  {/if}
</div>
