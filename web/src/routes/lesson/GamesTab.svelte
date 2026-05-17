<script lang="ts">
  import { subscribeGames } from "../../lib/data/lessons.svelte";

  let { courseId, lessonId }: { courseId: string; lessonId: string } = $props();

  let sub = $state<ReturnType<typeof subscribeGames>>();
  let selected = $state<Record<string, string>>({});

  $effect(() => {
    const next = subscribeGames(courseId, lessonId);
    sub = next;
    return () => next.stop();
  });

  function label(type: string) {
    return type
      .split("_")
      .map((part) => part[0]?.toUpperCase() + part.slice(1))
      .join(" ");
  }
</script>

<div>
  {#if !sub || sub.loading}
    <p class="text-(--color-muted)">Loading games...</p>
  {:else if sub.error}
    <p class="text-(--color-danger)">Failed to load games: {sub.error.message}</p>
  {:else if sub.games.length === 0}
    <div class="text-center py-16 border border-dashed border-(--color-border) rounded-lg">
      <p class="text-(--color-muted) text-sm">No games for this lesson yet.</p>
    </div>
  {:else}
    <ul class="space-y-4">
      {#each sub.games as game (game.id)}
        {@const answer = selected[game.id] ?? ""}
        {@const hasAnswer = answer.trim().length > 0}
        {@const accepted = [game.expectedAnswer, ...(game.acceptableAnswers ?? [])]
          .filter(Boolean)
          .map((a) => String(a).trim().toLowerCase())}
        {@const correct = hasAnswer && accepted.includes(answer.trim().toLowerCase())}
        <li class="rounded-lg border border-(--color-border) bg-(--color-surface) p-4">
          <div class="mb-3 flex items-baseline justify-between gap-3">
            <div>
              <h2 class="text-base font-semibold tracking-tight">{game.title ?? label(game.type)}</h2>
              <p class="text-xs text-(--color-muted)">{label(game.type)}</p>
            </div>
            {#if game.direction}
              <span class="text-xs text-(--color-muted)">{game.direction}</span>
            {/if}
          </div>

          {#if game.passage}
            <p class="mb-3 rounded-md bg-(--color-surface-muted) px-3 py-2 font-serif text-lg leading-relaxed">
              {game.passage}
            </p>
          {/if}
          {#if game.question}
            <p class="mb-2 text-sm font-medium">{game.question}</p>
          {/if}
          <p class="mb-3">{game.prompt}</p>

          <div class="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={answer}
              oninput={(e) =>
                (selected = { ...selected, [game.id]: (e.target as HTMLInputElement).value })}
              class="min-w-0 flex-1 rounded-md border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm focus:outline-none focus:border-(--color-accent) focus:ring-1 focus:ring-(--color-accent)"
              placeholder="Answer"
            />
            {#if hasAnswer}
              <span
                class="rounded-md px-3 py-2 text-sm {correct
                  ? 'bg-[#f0fdf4] text-[#15803d]'
                  : 'bg-[#fef2f2] text-(--color-danger)'}"
              >
                {correct ? "Correct" : "Check answer"}
              </span>
            {/if}
          </div>

          {#if hasAnswer && !correct && game.expectedAnswer}
            <p class="mt-2 text-sm text-(--color-muted)">Expected: {game.expectedAnswer}</p>
          {/if}
          {#if game.requiredWords?.length}
            <p class="mt-3 text-xs text-(--color-muted)">
              Words: {game.requiredWords.join(", ")}
            </p>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>
