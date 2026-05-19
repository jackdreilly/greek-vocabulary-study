<script lang="ts">
  import { doc, onSnapshot } from "firebase/firestore";
  import type { DocumentData } from "firebase/firestore";
  import { db } from "../lib/firebase";
  import { retryPlanGeneration } from "../lib/data/retryGeneration";
  import { linkClick } from "../lib/router.svelte";
  import WidgetRenderer from "../lib/widgets/WidgetRenderer.svelte";
  import { ArrowLeft, RefreshCw } from "lucide-svelte";
  import { clearFocus, setFocus } from "../lib/data/yiayiaFocus.svelte";

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

  // Expose plan's covered words to Yiayia.
  $effect(() => {
    if (plan) {
      const words: string[] = plan.coveredWords ?? [];
      setFocus({
        kind: "plan",
        label: `Plan: ${plan.title ?? ""}`,
        courseId,
        lessonId,
        tab: "plans",
        planId,
        words,
        title: plan.title ?? "",
        summary: [plan.subtitle, (plan.coveredConcepts ?? []).join(", ")].filter(Boolean).join("\n"),
        index: typeof plan.planNumber === "number" ? plan.planNumber : undefined,
      });
    }
    return () => clearFocus();
  });
</script>

<div class="max-w-2xl mx-auto pt-10 pb-24 px-6">
  <a
    href={backHref}
    onclick={linkClick(backHref)}
    class="inline-flex items-center gap-1.5 text-sm text-(--color-muted) hover:text-(--color-text) mb-6"
  >
    <ArrowLeft size={14} aria-hidden="true" />
    Back to plans
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
      {#if plan.status && plan.status !== "ready"}
        <div
          class="mt-4 rounded-md border px-4 py-3 text-sm {plan.status === 'error'
            ? 'border-[#fecaca] bg-[#fef2f2] text-(--color-danger)'
            : 'border-[#bfdbfe] bg-[#eff6ff] text-[#1d4ed8]'}"
        >
          <p class="font-medium capitalize">{plan.status}</p>
          {#if plan.statusLog?.length}
            <ol class="mt-1 space-y-1">
              {#each plan.statusLog.slice(-5) as item}
                <li>{item.message}</li>
              {/each}
            </ol>
          {/if}
          {#if plan.status === "error"}
            <button
              type="button"
              onclick={() => void retryPlanGeneration(courseId, lessonId, planId)}
              class="mt-3 inline-flex items-center gap-1.5 rounded-md border border-current px-3 py-2 text-sm font-medium"
            >
              <RefreshCw size={14} aria-hidden="true" />
              Try again
            </button>
          {/if}
        </div>
      {/if}
      {#if plan.error}
        <p class="mt-3 rounded-md bg-[#fef2f2] px-4 py-3 text-sm text-(--color-danger)">
          {plan.error}
        </p>
      {/if}
    </header>

    {#if (plan.widgets ?? []).length === 0 && plan.status !== "error"}
      <div class="rounded-lg border border-dashed border-(--color-border) px-5 py-10 text-center text-sm text-(--color-muted)">
        Sections will appear here as they are generated.
      </div>
    {/if}

    <article>
      {#each plan.widgets ?? [] as widget, i}
        <WidgetRenderer {widget} />
      {/each}
    </article>
  {/if}
</div>
