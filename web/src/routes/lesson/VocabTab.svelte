<script lang="ts">
  import { onDestroy } from "svelte";
  import { subscribeEntries } from "../../lib/data/lessons.svelte";
  import GreekText from "../../lib/ui/GreekText.svelte";

  let { courseId, lessonId }: { courseId: string; lessonId: string } = $props();

  let sub = $state<ReturnType<typeof subscribeEntries>>(subscribeEntries(courseId, lessonId));

  $effect(() => {
    const next = subscribeEntries(courseId, lessonId);
    sub = next;
    return () => next.stop();
  });

  onDestroy(() => sub.stop());

  let search = $state("");
  const filtered = $derived(
    search.trim() === ""
      ? sub.entries
      : sub.entries.filter((e) => {
          const q = search.trim().toLowerCase();
          return (
            e.lemma?.toLowerCase().includes(q) ||
            e.english?.toLowerCase().includes(q) ||
            e.senses?.some((s: string) => s.toLowerCase().includes(q))
          );
        })
  );
</script>

<div>
  <input
    type="search"
    placeholder="Search vocabulary…"
    bind:value={search}
    class="w-full max-w-sm px-3 py-2 text-sm border border-(--color-border) rounded-md bg-(--color-surface) focus:outline-none focus:border-(--color-accent) focus:ring-1 focus:ring-(--color-accent) mb-6"
  />

  {#if sub.loading}
    <p class="text-(--color-muted)">Loading entries…</p>
  {:else if filtered.length === 0}
    <p class="text-(--color-muted)">No entries.</p>
  {:else}
    <ul class="divide-y divide-(--color-border) border-y border-(--color-border)">
      {#each filtered as entry (entry.id)}
        <li class="py-3 flex items-baseline justify-between gap-6">
          <div class="flex items-baseline gap-2 min-w-0">
            {#if entry.article}
              <span class="text-(--color-muted) text-sm shrink-0">{entry.article}</span>
            {/if}
            <GreekText>{entry.lemma}</GreekText>
          </div>
          <div class="text-(--color-text) text-right min-w-0">
            <div class="truncate">{entry.english}</div>
            {#if entry.senses && entry.senses.length > 1}
              <div class="text-xs text-(--color-muted) truncate">
                {entry.senses.slice(1).join("; ")}
              </div>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
    <p class="text-xs text-(--color-muted) mt-3">
      {filtered.length}
      {filtered.length === 1 ? "word" : "words"}
    </p>
  {/if}
</div>
