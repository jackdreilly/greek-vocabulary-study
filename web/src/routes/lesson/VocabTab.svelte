<script lang="ts">
  import { subscribeEntries } from "../../lib/data/lessons.svelte";
  import GreekText from "../../lib/ui/GreekText.svelte";

  let { courseId, lessonId }: { courseId: string; lessonId: string } = $props();

  let sub = $state<ReturnType<typeof subscribeEntries>>();

  $effect(() => {
    const next = subscribeEntries(courseId, lessonId);
    sub = next;
    return () => next.stop();
  });

  let search = $state("");
  const filtered = $derived(
    search.trim() === ""
      ? (sub?.entries ?? [])
      : (sub?.entries ?? []).filter((e) => {
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

  {#if !sub || sub.loading}
    <p class="text-(--color-muted)">Loading entries…</p>
  {:else if filtered.length === 0}
    <p class="text-(--color-muted)">No entries.</p>
  {:else}
    <ul class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {#each filtered as entry (entry.id)}
        <li
          class="min-h-32 border border-(--color-border) rounded-lg bg-(--color-surface) px-4 py-3 flex flex-col gap-3"
        >
          <div class="flex items-baseline gap-2 min-w-0">
            {#if entry.article}
              <span class="text-(--color-muted) text-sm shrink-0">{entry.article}</span>
            {/if}
            <GreekText>{entry.lemma}</GreekText>
          </div>
          <div class="text-(--color-text) min-w-0">
            <div class="leading-snug">{entry.english}</div>
            {#if entry.senses && entry.senses.length > 1}
              <div class="text-xs text-(--color-muted) mt-1 line-clamp-2">
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
