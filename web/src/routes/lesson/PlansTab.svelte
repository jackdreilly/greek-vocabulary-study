<script lang="ts">
  import { createPlanStub } from "../../lib/data/createPlan";
  import { subscribePlans } from "../../lib/data/plans.svelte";
  import { navigate } from "../../lib/router.svelte";
  import { linkClick } from "../../lib/router.svelte";
  import { ChevronRight, Sparkles } from "lucide-svelte";

  let { courseId, lessonId }: { courseId: string; lessonId: string } = $props();

  let sub = $state<ReturnType<typeof subscribePlans>>();
  let customFocus = $state("");
  let creating = $state(false);
  let createError = $state("");

  $effect(() => {
    const next = subscribePlans(courseId, lessonId);
    sub = next;
    return () => next.stop();
  });

  async function generatePlan() {
    if (creating) return;
    creating = true;
    createError = "";
    try {
      const planId = await createPlanStub({
        courseId,
        lessonId,
        existingPlans: sub?.plans ?? [],
        customFocus,
      });
      customFocus = "";
      navigate(`/c/${courseId}/l/${lessonId}/plans/${planId}`);
    } catch (err) {
      createError = err instanceof Error ? err.message : String(err);
    } finally {
      creating = false;
    }
  }
</script>

<div>
  {#if !sub || sub.loading}
    <p class="text-(--color-muted)">Loading plans…</p>
  {:else if sub.error}
    <p class="text-(--color-danger)">Failed to load plans: {sub.error.message}</p>
  {:else if sub.plans.length === 0}
    <div class="py-12 border border-dashed border-(--color-border) rounded-lg px-4">
      <p class="text-(--color-muted) text-sm">
        No plans for this lesson yet.
      </p>
      <div class="mt-4 flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          bind:value={customFocus}
          placeholder="Optional focus for the first plan"
          class="min-w-0 flex-1 rounded-md border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm focus:outline-none focus:border-(--color-accent) focus:ring-1 focus:ring-(--color-accent)"
          onkeydown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void generatePlan();
            }
          }}
        />
        <button
          type="button"
          onclick={() => void generatePlan()}
          disabled={creating}
          class="inline-flex items-center justify-center gap-1.5 rounded-md bg-(--color-accent) px-4 py-2 text-sm font-medium text-white hover:bg-(--color-accent-hover) disabled:opacity-50"
        >
          <Sparkles size={14} aria-hidden="true" />
          {creating ? "Generating..." : "Generate plan"}
        </button>
      </div>
      {#if createError}
        <p class="mt-2 text-sm text-(--color-danger)">{createError}</p>
      {/if}
    </div>
  {:else}
    <div class="mb-5 rounded-lg border border-(--color-border) bg-(--color-surface) p-3">
      <div class="flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          bind:value={customFocus}
          placeholder="Optional focus for the next plan"
          class="min-w-0 flex-1 rounded-md border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm focus:outline-none focus:border-(--color-accent) focus:ring-1 focus:ring-(--color-accent)"
          onkeydown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void generatePlan();
            }
          }}
        />
        <button
          type="button"
          onclick={() => void generatePlan()}
          disabled={creating}
          class="inline-flex items-center justify-center gap-1.5 rounded-md bg-(--color-accent) px-4 py-2 text-sm font-medium text-white hover:bg-(--color-accent-hover) disabled:opacity-50"
        >
          <Sparkles size={14} aria-hidden="true" />
          {creating ? "Generating..." : "Generate plan"}
        </button>
      </div>
      {#if createError}
        <p class="mt-2 text-sm text-(--color-danger)">{createError}</p>
      {/if}
    </div>

    <ul class="space-y-3">
      {#each sub.plans as plan (plan.id)}
        {@const href = `/c/${courseId}/l/${lessonId}/plans/${plan.id}`}
        <li>
          <a
            {href}
            onclick={linkClick(href)}
            class="block border border-(--color-border) rounded-lg p-4 bg-(--color-surface) hover:border-(--color-border-strong) hover:shadow-sm transition-all"
          >
            <div class="flex items-baseline justify-between gap-3">
              <h3 class="text-lg font-semibold tracking-tight text-(--color-text) inline-flex items-baseline gap-2">
                {plan.title}
                <ChevronRight size={14} aria-hidden="true" class="text-(--color-muted)/60 self-center" />
              </h3>
              <span class="text-xs text-(--color-muted) shrink-0">
                Plan {plan.planNumber}
                {#if plan.estimatedMinutes}· {plan.estimatedMinutes} min{/if}
              </span>
            </div>
            {#if plan.status && plan.status !== "ready"}
              <p class="mt-2 text-xs font-medium uppercase tracking-widest text-(--color-accent)">
                {plan.status}
              </p>
            {/if}
            {#if plan.subtitle}
              <p class="text-sm text-(--color-muted) mt-1">{plan.subtitle}</p>
            {/if}
            {#if plan.widgets && plan.widgets.length > 0}
              <p class="text-xs text-(--color-muted) mt-2">{plan.widgets.length} sections</p>
            {/if}
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</div>
