<script lang="ts">
  import { subscribeEntries } from "../../lib/data/lessons.svelte";
  import GreekText from "../../lib/ui/GreekText.svelte";
  import AudioPlayButton from "../../lib/ui/AudioPlayButton.svelte";
  import { yiayiaFocus, clearFocus } from "../../lib/data/yiayiaFocus.svelte";

  type EntriesSub = ReturnType<typeof subscribeEntries>;

  let {
    courseId,
    lessonId,
    entriesSub: providedEntriesSub,
  }: { courseId: string; lessonId: string; entriesSub?: EntriesSub } = $props();

  let sub = $state<EntriesSub>();
  let index = $state(0);
  let flipped = $state(false);
  let mode = $state<"gr-en" | "en-gr" | "mixed">("gr-en");
  let deckSeed = $state(0);
  let dragStart = $state<{ pointerId: number; x: number; y: number } | null>(null);
  let dragX = $state(0);
  let dragY = $state(0);
  let dragTransition = $state(false);
  let suppressNextClick = $state(false);

  $effect(() => {
    if (providedEntriesSub) {
      sub = providedEntriesSub;
      index = 0;
      flipped = false;
      return () => clearFocus();
    }

    const next = subscribeEntries(courseId, lessonId);
    sub = next;
    index = 0;
    flipped = false;
    return () => {
      next.stop();
      clearFocus();
    };
  });

  // Keep yiayiaFocus in sync with the current card.
  $effect(() => {
    if (current) {
      yiayiaFocus.words = [current.lemma];
      yiayiaFocus.label = `Flashcard: ${current.lemma}`;
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
    return entry.senses?.length ? entry.senses : [entry.english];
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
    if (!current || event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
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
      const delta = dragX < 0 ? 1 : -1;
      suppressNextClick = true;
      dragTransition = true;
      dragX = dragX > 0 ? 360 : -360;
      dragY = Math.max(-80, Math.min(80, dragY));
      setTimeout(() => {
        go(delta);
        resetDrag();
      }, 120);
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
        {#if Math.abs(dragX) > 35}
          <span
            class="absolute top-5 {dragX > 0 ? 'left-5 text-[#15803d] border-[#bbf7d0]' : 'right-5 text-(--color-danger) border-[#fecaca]'} rounded border px-3 py-1 text-xs font-semibold uppercase tracking-widest bg-white/85"
          >
            {dragX > 0 ? "Back" : "Next"}
          </span>
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
