<script lang="ts">
  import { linkClick } from "../lib/router.svelte";
  import { revertGeneration, subscribeGeneration } from "../lib/data/generations.svelte";
  import { ArrowLeft, Trash2 } from "lucide-svelte";

  let { generationId }: { generationId: string } = $props();

  let sub = $state<ReturnType<typeof subscribeGeneration>>();
  let reverting = $state(false);
  let revertResult = $state<string | null>(null);
  let revertError = $state<string | null>(null);
  let confirmOpen = $state(false);

  $effect(() => {
    const next = subscribeGeneration(generationId);
    sub = next;
    return () => next.stop();
  });

  const generation = $derived(sub?.generation);

  const manifestByCollection = $derived.by(() => {
    const buckets = new Map<string, number>();
    for (const entry of generation?.manifest ?? []) {
      const collection = entry.path.split("/").slice(-2, -1)[0] ?? "(root)";
      buckets.set(collection, (buckets.get(collection) ?? 0) + 1);
    }
    return [...buckets.entries()].sort((a, b) => b[1] - a[1]);
  });

  async function performRevert() {
    if (reverting) return;
    reverting = true;
    revertResult = null;
    revertError = null;
    try {
      const data = await revertGeneration(generationId);
      if (data.alreadyReverted) {
        revertResult = "Already reverted.";
      } else {
        revertResult = `Reverted. Deletes=${data.deletes ?? 0}, arrayRemoves=${data.arrayRemoves ?? 0}, updates=${data.updates ?? 0}, orphans=${data.orphans ?? 0}.`;
      }
      confirmOpen = false;
    } catch (err) {
      revertError = err instanceof Error ? err.message : String(err);
    } finally {
      reverting = false;
    }
  }

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
</script>

<div class="max-w-3xl mx-auto pt-10 pb-24 px-6">
  <a
    href="/admin/generations"
    onclick={linkClick("/admin/generations")}
    class="inline-flex items-center gap-1.5 text-sm text-(--color-muted) hover:text-(--color-text) mb-6"
  >
    <ArrowLeft size={14} aria-hidden="true" />
    All generations
  </a>

  {#if !sub || sub.loading}
    <p class="text-(--color-muted)">Loading generation…</p>
  {:else if sub.error || !generation}
    <p class="text-(--color-danger)">Generation not found.</p>
  {:else}
    <header class="mb-6">
      <p class="text-xs tracking-widest uppercase text-(--color-muted) mb-2 font-semibold">
        {generation.kind ?? "generation"} · {generation.status}
      </p>
      <h1 class="text-2xl font-semibold tracking-tight break-all">{generation.id}</h1>
      {#if generation.trigger?.description}
        <p class="mt-2 text-(--color-muted)">{generation.trigger.description}</p>
      {/if}
    </header>

    <section class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8">
      <div class="rounded-md border border-(--color-border) bg-(--color-surface) p-3">
        <div class="text-xs uppercase tracking-wider text-(--color-muted) mb-1">Parent doc</div>
        <div class="text-sm break-all">{generation.parentDoc ?? "—"}</div>
      </div>
      <div class="rounded-md border border-(--color-border) bg-(--color-surface) p-3">
        <div class="text-xs uppercase tracking-wider text-(--color-muted) mb-1">Created</div>
        <div class="text-sm">{format(generation.createdAt)}</div>
      </div>
      <div class="rounded-md border border-(--color-border) bg-(--color-surface) p-3">
        <div class="text-xs uppercase tracking-wider text-(--color-muted) mb-1">Model</div>
        <div class="text-sm break-all">{generation.modelUsed ?? "—"}</div>
      </div>
      <div class="rounded-md border border-(--color-border) bg-(--color-surface) p-3">
        <div class="text-xs uppercase tracking-wider text-(--color-muted) mb-1">Source prompt</div>
        <div class="text-sm break-words">{generation.sourcePrompt || "—"}</div>
      </div>
    </section>

    <section class="mb-8">
      <h2 class="text-xs tracking-widest uppercase text-(--color-muted) mb-3 font-semibold">
        Manifest ({generation.manifest?.length ?? 0})
      </h2>
      {#if manifestByCollection.length === 0}
        <p class="text-sm text-(--color-muted)">No recorded writes.</p>
      {:else}
        <ul class="grid grid-cols-2 gap-2 text-sm">
          {#each manifestByCollection as [collection, count]}
            <li class="flex items-center justify-between rounded-md border border-(--color-border) bg-(--color-surface-muted) px-3 py-2">
              <span>{collection}</span>
              <span class="text-(--color-muted) tabular-nums">{count}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    {#if generation.statusLog?.length}
      <section class="mb-8">
        <h2 class="text-xs tracking-widest uppercase text-(--color-muted) mb-3 font-semibold">Status log</h2>
        <ol class="space-y-1 text-sm">
          {#each generation.statusLog as item}
            <li class="text-(--color-muted)">{item.message}</li>
          {/each}
        </ol>
      </section>
    {/if}

    {#if generation.error}
      <p class="mb-6 rounded-md bg-[#fef2f2] px-4 py-3 text-sm text-(--color-danger)">{generation.error}</p>
    {/if}

    {#if generation.status === "reverted"}
      <p class="rounded-md border border-(--color-border) bg-(--color-surface-muted) px-4 py-3 text-sm">
        Reverted {format(generation.revertedAt)} by {generation.revertedBy ?? "—"}.
      </p>
    {:else if generation.status === "reverting"}
      <p class="rounded-md border border-[#bfdbfe] bg-[#eff6ff] px-4 py-3 text-sm text-[#1d4ed8]">
        Revert in progress…
      </p>
    {:else}
      <section class="rounded-md border border-(--color-border) bg-(--color-surface) p-4">
        <h2 class="text-base font-semibold tracking-tight mb-1">Revert this generation</h2>
        <p class="text-sm text-(--color-muted) mb-3">
          Removes every doc the generation created and undoes recorded array unions. Cannot be undone.
        </p>
        {#if !confirmOpen}
          <button
            type="button"
            onclick={() => (confirmOpen = true)}
            class="inline-flex items-center gap-1.5 rounded-md border border-(--color-danger) text-(--color-danger) px-3 py-2 text-sm hover:bg-[#fef2f2]"
          >
            <Trash2 size={14} aria-hidden="true" />
            Revert…
          </button>
        {:else}
          <div class="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onclick={performRevert}
              disabled={reverting}
              class="inline-flex items-center gap-1.5 rounded-md bg-(--color-danger) text-white px-3 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              <Trash2 size={14} aria-hidden="true" />
              {reverting ? "Reverting…" : "Confirm revert"}
            </button>
            <button
              type="button"
              onclick={() => (confirmOpen = false)}
              class="rounded-md border border-(--color-border) px-3 py-2 text-sm hover:bg-(--color-surface-muted)"
            >
              Cancel
            </button>
          </div>
        {/if}
        {#if revertResult}
          <p class="mt-3 text-sm text-(--color-text)">{revertResult}</p>
        {/if}
        {#if revertError}
          <p class="mt-3 text-sm text-(--color-danger)">{revertError}</p>
        {/if}
      </section>
    {/if}
  {/if}
</div>
