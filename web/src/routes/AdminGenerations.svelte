<script lang="ts">
  import { onDestroy } from "svelte";
  import { linkClick } from "../lib/router.svelte";
  import { subscribeRecentGenerations } from "../lib/data/generations.svelte";
  import { ChevronRight } from "lucide-svelte";

  let kindFilter = $state<string>("");
  let statusFilter = $state<string>("");

  let sub = $state<ReturnType<typeof subscribeRecentGenerations>>();

  $effect(() => {
    const next = subscribeRecentGenerations({
      kind: kindFilter || undefined,
      status: statusFilter || undefined,
      limitCount: 80,
    });
    sub = next;
    return () => next.stop();
  });

  onDestroy(() => sub?.stop?.());

  function format(value: unknown) {
    if (!value) return "—";
    if (typeof value === "object" && value && "toDate" in value) {
      try {
        return (value as { toDate: () => Date }).toDate().toLocaleString();
      } catch {
        return "—";
      }
    }
    return String(value);
  }

  function shorten(value: string | undefined, max = 60) {
    if (!value) return "—";
    return value.length > max ? `${value.slice(0, max - 1)}…` : value;
  }
</script>

<div class="max-w-4xl mx-auto pt-12 pb-24 px-6">
  <header class="mb-6">
    <p class="text-xs tracking-widest uppercase text-(--color-muted) mb-2 font-semibold">Admin</p>
    <h1 class="text-3xl font-semibold tracking-tight">Generations</h1>
    <p class="mt-2 text-sm text-(--color-muted)">
      Every AI write registers a generation. Click a row to inspect or revert.
    </p>
  </header>

  <div class="mb-5 flex flex-wrap items-center gap-3 text-sm">
    <label class="flex items-center gap-2">
      <span class="text-(--color-muted)">Kind</span>
      <select
        bind:value={kindFilter}
        class="rounded-md border border-(--color-border) bg-(--color-surface) px-2 py-1.5"
      >
        <option value="">All</option>
        <option value="course">course</option>
        <option value="lesson">lesson</option>
        <option value="plan">plan</option>
        <option value="entry_batch">entry_batch</option>
        <option value="game_batch">game_batch</option>
        <option value="legacy_import">legacy_import</option>
        <option value="yiayia_edit">yiayia_edit</option>
        <option value="debug_course">debug_course</option>
      </select>
    </label>
    <label class="flex items-center gap-2">
      <span class="text-(--color-muted)">Status</span>
      <select
        bind:value={statusFilter}
        class="rounded-md border border-(--color-border) bg-(--color-surface) px-2 py-1.5"
      >
        <option value="">All</option>
        <option value="streaming">streaming</option>
        <option value="done">done</option>
        <option value="error">error</option>
        <option value="reverting">reverting</option>
        <option value="reverted">reverted</option>
      </select>
    </label>
  </div>

  {#if !sub || sub.loading}
    <p class="text-(--color-muted)">Loading generations…</p>
  {:else if sub.error}
    <p class="text-(--color-danger)">Failed to load: {sub.error.message}</p>
  {:else if sub.generations.length === 0}
    <p class="text-(--color-muted)">No generations match this filter.</p>
  {:else}
    <ul class="divide-y divide-(--color-border) border-y border-(--color-border)">
      {#each sub.generations as gen (gen.id)}
        {@const href = `/admin/generations/${gen.id}`}
        <li>
          <a
            {href}
            onclick={linkClick(href)}
            class="flex flex-col gap-1 py-3 -mx-2 px-2 hover:bg-(--color-surface-muted) transition-colors rounded"
          >
            <div class="flex items-baseline justify-between gap-3">
              <div class="min-w-0">
                <span class="text-sm font-medium text-(--color-text) truncate">
                  {gen.kind ?? "—"}
                </span>
                <span class="ml-2 text-xs text-(--color-muted)">{gen.id}</span>
              </div>
              <div class="flex shrink-0 items-center gap-2">
                <span
                  class="rounded-full px-2 py-0.5 text-xs font-medium {gen.status === 'reverted'
                    ? 'bg-(--color-surface-muted) text-(--color-muted)'
                    : gen.status === 'error'
                      ? 'bg-[#fef2f2] text-(--color-danger)'
                      : gen.status === 'done'
                        ? 'bg-[#f0fdf4] text-[#15803d]'
                        : 'bg-[#eff6ff] text-[#1d4ed8]'}"
                >
                  {gen.status ?? "—"}
                </span>
                <ChevronRight size={14} aria-hidden="true" class="text-(--color-muted)/60" />
              </div>
            </div>
            <div class="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-(--color-muted)">
              <span>{format(gen.createdAt)}</span>
              {#if gen.parentDoc}<span>{shorten(gen.parentDoc, 80)}</span>{/if}
              {#if gen.sourcePrompt}<span class="truncate">"{shorten(gen.sourcePrompt, 80)}"</span>{/if}
              {#if gen.modelUsed}<span>{gen.modelUsed}</span>{/if}
              {#if gen.manifest?.length}<span>{gen.manifest.length} writes</span>{/if}
            </div>
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</div>
