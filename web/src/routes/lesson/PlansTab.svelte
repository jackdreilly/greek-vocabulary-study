<script lang="ts">
  import { subscribeCourse } from "../../lib/data/courses.svelte";
  import { createPlanStub } from "../../lib/data/createPlan";
  import { subscribeLesson } from "../../lib/data/lessons.svelte";
  import { subscribePlans } from "../../lib/data/plans.svelte";
  import { navigate } from "../../lib/router.svelte";
  import { linkClick } from "../../lib/router.svelte";
  import { inferSkillLevel, SKILL_LEVEL_LABEL, type SkillLevel } from "../../lib/skillLevel";
  import SkillLevelPicker from "../../lib/ui/SkillLevelPicker.svelte";
  import { ChevronRight, Sparkles } from "lucide-svelte";
  import GenerateModal from "../../lib/ui/GenerateModal.svelte";

  type PlansSub = ReturnType<typeof subscribePlans>;
  type CourseSub = ReturnType<typeof subscribeCourse>;
  type LessonSub = ReturnType<typeof subscribeLesson>;

  let {
    courseId,
    lessonId,
    canGenerate = true,
    plansSub: providedPlansSub,
  }: { courseId: string; lessonId: string; canGenerate?: boolean; plansSub?: PlansSub } = $props();

  let planModalOpen = $state(false);

  let sub = $state<PlansSub>();
  let courseSub = $state<CourseSub>();
  let lessonSub = $state<LessonSub>();
  let customFocus = $state("");
  let planSkillLevel = $state<SkillLevel | "">("");
  let creating = $state(false);
  let createError = $state("");

  $effect(() => {
    if (providedPlansSub) {
      sub = providedPlansSub;
      return;
    }

    const next = subscribePlans(courseId, lessonId);
    sub = next;
    return () => next.stop();
  });

  $effect(() => {
    const nextCourse = subscribeCourse(courseId);
    const nextLesson = subscribeLesson(courseId, lessonId);
    courseSub = nextCourse;
    lessonSub = nextLesson;
    return () => {
      nextCourse.stop();
      nextLesson.stop();
    };
  });

  const inheritedLevel = $derived<SkillLevel | undefined>(
    (lessonSub?.lesson?.skillLevel as SkillLevel | undefined) ??
      (courseSub?.course?.skillLevel as SkillLevel | undefined) ??
      undefined,
  );

  async function generatePlan() {
    if (creating) return;
    creating = true;
    createError = "";
    try {
      const resolved: SkillLevel | undefined =
        planSkillLevel || inferSkillLevel(customFocus) || inheritedLevel;
      const planId = await createPlanStub({
        courseId,
        lessonId,
        existingPlans: sub?.plans ?? [],
        customFocus,
        skillLevel: resolved,
      });
      customFocus = "";
      planSkillLevel = "";
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
      <p class="text-(--color-muted) text-sm">No plans for this lesson yet.</p>
      {#if canGenerate}
        <button
          type="button"
          onclick={() => (planModalOpen = true)}
          disabled={creating}
          class="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-700 hover:border-amber-300 hover:bg-amber-100 disabled:opacity-50"
        >
          <Sparkles size={14} aria-hidden="true" />
          {creating ? "Generating..." : "Generate plan"}
        </button>
      {/if}
      {#if createError}
        <p class="mt-2 text-sm text-(--color-danger)">{createError}</p>
      {/if}
    </div>
  {:else}
    {#if canGenerate}
      <div class="mb-5">
        <button
          type="button"
          onclick={() => (planModalOpen = true)}
          disabled={creating}
          class="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:border-amber-300 hover:bg-amber-100 disabled:opacity-50"
        >
          <Sparkles size={12} aria-hidden="true" />
          {creating ? "Generating..." : "Generate plan"}
        </button>
        {#if createError}
          <p class="mt-1 text-sm text-(--color-danger)">{createError}</p>
        {/if}
      </div>
    {/if}

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

  <GenerateModal bind:open={planModalOpen} title="Generate plan">
    <div class="flex flex-col gap-3">
      <label class="block">
        <span class="mb-1 block text-sm font-medium text-(--color-text)">Focus (optional)</span>
        <input
          type="text"
          bind:value={customFocus}
          placeholder="e.g. verb conjugations, food vocabulary, cultural context"
          class="w-full rounded-md border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm focus:outline-none focus:border-(--color-accent) focus:ring-1 focus:ring-(--color-accent)"
        />
      </label>
      <SkillLevelPicker
        bind:value={planSkillLevel}
        autoLabel={inheritedLevel ? `Inherit from lesson/course (${SKILL_LEVEL_LABEL[inheritedLevel]})` : "Auto-detect from focus"}
      />
      {#if createError}
        <p class="text-sm text-(--color-danger)">{createError}</p>
      {/if}
      <button
        type="button"
        onclick={() => { planModalOpen = false; void generatePlan(); }}
        disabled={creating}
        class="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
      >
        <Sparkles size={14} aria-hidden="true" />
        {creating ? "Generating..." : "Generate plan"}
      </button>
    </div>
  </GenerateModal>
</div>
