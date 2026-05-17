<script lang="ts">
  import { subscribePlans } from "../../lib/data/plans.svelte";
  import { linkClick } from "../../lib/router.svelte";

  let { courseId, lessonId }: { courseId: string; lessonId: string } = $props();

  let sub = $state<ReturnType<typeof subscribePlans>>();

  $effect(() => {
    const next = subscribePlans(courseId, lessonId);
    sub = next;
    return () => next.stop();
  });

</script>

<div>
  {#if !sub || sub.loading}
    <p class="text-(--color-muted)">Loading plans…</p>
  {:else if sub.error}
    <p class="text-(--color-danger)">Failed to load plans: {sub.error.message}</p>
  {:else if sub.plans.length === 0}
    <div class="text-center py-16 border border-dashed border-(--color-border) rounded-lg">
      <p class="text-(--color-muted) text-sm">
        No plans for this lesson yet.
      </p>
    </div>
  {:else}
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
              <h3 class="text-lg font-semibold tracking-tight text-(--color-text)">
                {plan.title}
              </h3>
              <span class="text-xs text-(--color-muted) shrink-0">
                Plan {plan.planNumber}
                {#if plan.estimatedMinutes}· {plan.estimatedMinutes} min{/if}
              </span>
            </div>
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
