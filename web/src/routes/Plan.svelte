<script lang="ts">
  import { doc, onSnapshot } from "firebase/firestore";
  import type { DocumentData } from "firebase/firestore";
  import { db } from "../lib/firebase";
  import { linkClick } from "../lib/router.svelte";
  import WidgetRenderer from "../lib/widgets/WidgetRenderer.svelte";

  type PlanDoc = DocumentData & { id: string };

  let {
    courseId,
    lessonId,
    planId,
  }: { courseId: string; lessonId: string; planId: string } = $props();

  let plan = $state<PlanDoc | null>(null);
  let loading = $state(true);
  let error = $state<Error | null>(null);

  $effect(() => {
    loading = true;
    plan = null;
    error = null;
    const ref = doc(db, "courses", courseId, "lessons", lessonId, "plans", planId);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        plan = snap.exists()
          ? ({ id: snap.id, ...(snap.data() as DocumentData) } as PlanDoc)
          : null;
        loading = false;
      },
      (err) => {
        error = err;
        loading = false;
      }
    );
    return () => unsub();
  });

  const backHref = $derived(`/c/${courseId}/l/${lessonId}/plans`);
</script>

<div class="max-w-2xl mx-auto pt-10 pb-24 px-6">
  <a
    href={backHref}
    onclick={linkClick(backHref)}
    class="inline-flex items-center gap-1.5 text-sm text-(--color-muted) hover:text-(--color-text) mb-6"
  >
    ← Back to plans
  </a>

  {#if loading}
    <p class="text-(--color-muted)">Loading plan…</p>
  {:else if error || !plan}
    <p class="text-(--color-danger)">Plan not found.</p>
  {:else}
    <header class="mb-8">
      <p class="text-xs tracking-widest uppercase text-(--color-muted) mb-2 font-semibold">
        Plan {plan.planNumber}
        {#if plan.estimatedMinutes}· {plan.estimatedMinutes} min{/if}
      </p>
      <h1 class="text-3xl font-semibold tracking-tight">{plan.title}</h1>
      {#if plan.subtitle}
        <p class="mt-2 text-(--color-muted)">{plan.subtitle}</p>
      {/if}
    </header>

    <article>
      {#each plan.widgets ?? [] as widget, i}
        <WidgetRenderer {widget} />
      {/each}
    </article>
  {/if}
</div>
