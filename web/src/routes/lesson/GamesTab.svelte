<script lang="ts">
  import { subscribeGames } from "../../lib/data/lessons.svelte";

  let { courseId, lessonId }: { courseId: string; lessonId: string } = $props();

  let sub = $state<ReturnType<typeof subscribeGames>>();
  let index = $state(0);
  let answer = $state("");
  let checked = $state(false);

  $effect(() => {
    const next = subscribeGames(courseId, lessonId);
    sub = next;
    index = 0;
    answer = "";
    checked = false;
    return () => next.stop();
  });

  const games = $derived(sub?.games ?? []);
  const current = $derived(games[index]);
  const progress = $derived(games.length ? ((index + 1) / games.length) * 100 : 0);
  const accepted = $derived(
    current
      ? [current.expectedAnswer, ...(current.acceptableAnswers ?? [])]
          .filter(Boolean)
          .map((a) => String(a).trim().toLowerCase())
      : []
  );
  const hasAnswer = $derived(answer.trim().length > 0);
  const correct = $derived(hasAnswer && accepted.length > 0 && accepted.includes(answer.trim().toLowerCase()));

  function label(type: string) {
    return type
      .split("_")
      .map((part) => part[0]?.toUpperCase() + part.slice(1))
      .join(" ");
  }

  function continuePractice() {
    if (index < games.length - 1) {
      index += 1;
      answer = "";
      checked = false;
    } else {
      index = 0;
      answer = "";
      checked = false;
    }
  }
</script>

<div>
  {#if !sub || sub.loading}
    <p class="text-(--color-muted)">Loading games...</p>
  {:else if sub.error}
    <p class="text-(--color-danger)">Failed to load games: {sub.error.message}</p>
  {:else if games.length === 0}
    <div class="text-center py-16 border border-dashed border-(--color-border) rounded-lg">
      <p class="text-(--color-muted) text-sm">No games for this lesson yet.</p>
    </div>
  {:else if current}
    <section class="max-w-xl mx-auto">
      <div class="mb-4">
        <div class="mb-2 flex items-center justify-between text-sm text-(--color-muted)">
          <span>{index + 1} / {games.length}</span>
          <span>{label(current.type)}</span>
        </div>
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
          disabled={checked}
          class="w-full rounded-md border border-(--color-border) bg-(--color-surface) px-3 py-3 text-base focus:outline-none focus:border-(--color-accent) focus:ring-1 focus:ring-(--color-accent) disabled:bg-(--color-surface-muted)"
          placeholder="Type your answer"
        />

        {#if checked}
          <div
            class="mt-4 rounded-md px-4 py-3 text-sm {correct || accepted.length === 0
              ? 'bg-[#f0fdf4] text-[#15803d]'
              : 'bg-[#fef2f2] text-(--color-danger)'}"
          >
            {#if accepted.length === 0}
              Saved for review.
            {:else if correct}
              Correct.
            {:else}
              Expected: {current.expectedAnswer}
            {/if}
          </div>
        {/if}

        {#if current.requiredWords?.length}
          <p class="mt-4 text-xs text-(--color-muted)">
            Words: {current.requiredWords.join(", ")}
          </p>
        {/if}
      </article>

      <div class="mt-4 flex justify-end">
        {#if checked}
          <button
            type="button"
            onclick={continuePractice}
            class="rounded-md bg-(--color-accent) px-4 py-2 text-sm font-medium text-white hover:bg-(--color-accent-hover)"
          >
            {index < games.length - 1 ? "Continue" : "Restart"}
          </button>
        {:else}
          <button
            type="button"
            onclick={() => (checked = true)}
            disabled={!hasAnswer}
            class="rounded-md bg-(--color-accent) px-4 py-2 text-sm font-medium text-white hover:bg-(--color-accent-hover) disabled:opacity-50"
          >
            Check
          </button>
        {/if}
      </div>
    </section>
  {/if}
</div>
