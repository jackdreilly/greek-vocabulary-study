<script lang="ts">
  import { subscribeEntries } from "../../lib/data/lessons.svelte";
  import GreekText from "../../lib/ui/GreekText.svelte";

  let { courseId, lessonId }: { courseId: string; lessonId: string } = $props();

  let sub = $state<ReturnType<typeof subscribeEntries>>();
  let index = $state(0);
  let flipped = $state(false);

  $effect(() => {
    const next = subscribeEntries(courseId, lessonId);
    sub = next;
    index = 0;
    flipped = false;
    return () => next.stop();
  });

  const entries = $derived(sub?.entries ?? []);
  const current = $derived(entries[index]);

  function go(delta: number) {
    if (entries.length === 0) return;
    index = (index + delta + entries.length) % entries.length;
    flipped = false;
  }
</script>

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
      <div class="mb-3 flex items-center justify-between text-sm text-(--color-muted)">
        <span>{index + 1} / {entries.length}</span>
        {#if current?.category}
          <span>{current.category}</span>
        {/if}
      </div>

      <button
        type="button"
        onclick={() => (flipped = !flipped)}
        class="w-full min-h-72 rounded-lg border border-(--color-border) bg-(--color-surface) px-6 py-8 text-left shadow-sm hover:border-(--color-border-strong) focus:outline-none focus:ring-2 focus:ring-(--color-accent)"
      >
        {#if !flipped}
          <div class="flex h-full min-h-56 flex-col items-center justify-center text-center">
            <div class="flex items-baseline justify-center gap-2">
              {#if current.article}
                <span class="text-(--color-muted)">{current.article}</span>
              {/if}
              <GreekText size="lg">{current.lemma}</GreekText>
            </div>
            <p class="mt-6 text-sm text-(--color-muted)">Click to reveal</p>
          </div>
        {:else}
          <div class="flex h-full min-h-56 flex-col justify-center">
            <p class="text-2xl font-semibold tracking-tight">{current.english}</p>
            {#if current.senses && current.senses.length > 1}
              <p class="mt-3 text-sm text-(--color-muted)">
                {current.senses.slice(1).join("; ")}
              </p>
            {/if}
            <div class="mt-6 pt-5 border-t border-(--color-border)">
              <div class="flex items-baseline gap-2">
                {#if current.article}
                  <span class="text-(--color-muted) text-sm">{current.article}</span>
                {/if}
                <GreekText>{current.lemma}</GreekText>
              </div>
            </div>
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
          onclick={() => (flipped = !flipped)}
          class="rounded-md border border-(--color-border) px-3 py-2 text-sm hover:bg-(--color-surface-muted)"
        >
          {flipped ? "Hide" : "Reveal"}
        </button>
        <button
          type="button"
          onclick={() => go(1)}
          class="rounded-md bg-(--color-accent) px-3 py-2 text-sm font-medium text-white hover:bg-(--color-accent-hover)"
        >
          Next
        </button>
      </div>
    </section>
  {/if}
</div>
