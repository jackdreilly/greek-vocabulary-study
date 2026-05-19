<script lang="ts">
  import { subscribeCourse } from "../lib/data/courses.svelte";
  import { createLessonStub } from "../lib/data/createLesson";
  import { linkClick } from "../lib/router.svelte";
  import { navigate } from "../lib/router.svelte";
  import { retryCourseGeneration } from "../lib/data/retryGeneration";
  import { extractLead, hasMoreThanLead } from "../lib/markdown";
  import { inferSkillLevel, SKILL_LEVEL_LABEL, type SkillLevel } from "../lib/skillLevel";
  import SkillLevelPicker from "../lib/ui/SkillLevelPicker.svelte";
  import StatusPill from "../lib/ui/StatusPill.svelte";
  import MarkdownBody from "../lib/ui/MarkdownBody.svelte";
  import { BookOpen, ChevronRight, RefreshCw, Sparkles } from "lucide-svelte";

  let { courseId }: { courseId: string } = $props();

  let sub = $state<ReturnType<typeof subscribeCourse>>();

  $effect(() => {
    const next = subscribeCourse(courseId);
    sub = next;
    return () => next.stop();
  });

  const lessons = $derived(
    Object.entries(sub?.course?.lessonSummaries ?? {})
      .map(([id, s]) => ({ id, ...s }))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  );

  const description = $derived(sub?.course?.description ?? "");
  const lead = $derived(extractLead(description));
  const hasMore = $derived(hasMoreThanLead(description));

  let expanded = $state(false);
  let lessonPrompt = $state("");
  let lessonSkillLevel = $state<SkillLevel | "">("");
  let creatingLesson = $state(false);
  let lessonError = $state<string | null>(null);
  // Reset expander whenever we change courses
  $effect(() => {
    courseId;
    expanded = false;
    lessonSkillLevel = "";
  });

  const courseSkillLevel = $derived<SkillLevel | undefined>(
    (sub?.course?.skillLevel as SkillLevel | undefined) ?? undefined,
  );

  async function createLesson() {
    creatingLesson = true;
    lessonError = null;
    try {
      const resolved: SkillLevel | undefined =
        lessonSkillLevel || inferSkillLevel(lessonPrompt) || courseSkillLevel;
      const lessonId = await createLessonStub({
        courseId,
        prompt: lessonPrompt,
        order: lessons.length + 1,
        skillLevel: resolved,
      });
      lessonPrompt = "";
      lessonSkillLevel = "";
      navigate(`/c/${courseId}/l/${lessonId}/overview`);
    } catch (err) {
      lessonError = err instanceof Error ? err.message : String(err);
    } finally {
      creatingLesson = false;
    }
  }
</script>

<div class="max-w-3xl mx-auto pt-12 pb-24 px-6">
  {#if !sub || sub.loading}
    <p class="text-(--color-muted)">Loading…</p>
  {:else if sub.error || !sub.course}
    <p class="text-(--color-danger)">Course not found.</p>
  {:else}
    <header class="mb-10">
      <div class="flex items-start justify-between gap-4">
        <h1 class="text-3xl font-semibold tracking-tight">{sub.course.title}</h1>
        {#if sub.course.status && sub.course.status !== "ready"}
          <StatusPill status={sub.course.status} />
        {/if}
      </div>
      {#if sub.course.subtitle}
        <p class="mt-2 text-base text-(--color-muted)">{sub.course.subtitle}</p>
      {/if}
      {#if courseSkillLevel}
        <p class="mt-3 inline-flex items-center gap-1.5 rounded-full border border-(--color-border) bg-(--color-surface-muted) px-2.5 py-0.5 text-xs font-medium text-(--color-muted)">
          Skill level: {SKILL_LEVEL_LABEL[courseSkillLevel]}
        </p>
      {/if}
    </header>

    {#if description}
      <section class="mb-12">
        {#if expanded}
          <MarkdownBody markdown={description} />
          <button
            type="button"
            onclick={() => (expanded = false)}
            class="mt-4 text-sm font-medium text-(--color-accent) hover:text-(--color-accent-hover)"
          >
            Show less
          </button>
        {:else if lead}
          <MarkdownBody markdown={lead} />
          {#if hasMore}
            <button
              type="button"
              onclick={() => (expanded = true)}
              class="mt-4 text-sm font-medium text-(--color-accent) hover:text-(--color-accent-hover)"
            >
              Read full overview →
            </button>
          {/if}
        {:else}
          <button
            type="button"
            onclick={() => (expanded = true)}
            class="text-sm font-medium text-(--color-accent) hover:text-(--color-accent-hover)"
          >
            Read course overview →
          </button>
        {/if}
      </section>
    {/if}

    {#if sub.course.status && sub.course.status !== "ready"}
      <section class="mb-12 border-y border-(--color-border) py-5">
        <h2 class="text-xs tracking-widest uppercase text-(--color-muted) mb-3 font-semibold">
          Status
        </h2>
        {#if sub.course.statusLog?.length}
          <ol class="space-y-2">
            {#each sub.course.statusLog.slice(-5) as item}
              <li class="text-sm text-(--color-muted)">{item.message}</li>
            {/each}
          </ol>
        {:else}
          <p class="text-sm text-(--color-muted)">Starting up...</p>
        {/if}
        {#if sub.course.status === "error"}
          <button
            type="button"
            onclick={() => void retryCourseGeneration(courseId)}
            class="mt-3 inline-flex items-center gap-1.5 rounded-md border border-(--color-border) px-3 py-2 text-sm hover:bg-(--color-surface-muted)"
          >
            <RefreshCw size={14} aria-hidden="true" />
            Try again
          </button>
        {/if}
      </section>
    {/if}

    <section>
      <div class="mb-3 flex items-center justify-between gap-3">
        <h2 class="text-xs tracking-widest uppercase text-(--color-muted) font-semibold">
          Lessons
        </h2>
      </div>
      <form
        class="mb-5 rounded-lg border border-(--color-border) bg-(--color-surface) p-3"
        onsubmit={(event) => {
          event.preventDefault();
          void createLesson();
        }}
      >
        <div class="flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            bind:value={lessonPrompt}
            placeholder="Add a lesson: ordering at a cafe, asking directions..."
            class="min-w-0 flex-1 rounded-md border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm focus:outline-none focus:border-(--color-accent) focus:ring-1 focus:ring-(--color-accent)"
          />
          <button
            type="submit"
            disabled={creatingLesson || lessonPrompt.trim().length === 0}
            class="inline-flex items-center justify-center gap-1.5 rounded-md bg-(--color-accent) px-4 py-2 text-sm font-medium text-white hover:bg-(--color-accent-hover) disabled:opacity-50"
          >
            <Sparkles size={14} aria-hidden="true" />
            {creatingLesson ? "Starting..." : "Generate lesson"}
          </button>
        </div>
        <div class="mt-2 max-w-md">
          <SkillLevelPicker
            bind:value={lessonSkillLevel}
            autoLabel={courseSkillLevel
              ? `Inherit from course (${SKILL_LEVEL_LABEL[courseSkillLevel]})`
              : "Auto-detect from prompt"}
          />
        </div>
        {#if lessonError}
          <p class="mt-2 text-sm text-(--color-danger)">{lessonError}</p>
        {/if}
      </form>
      <ul class="divide-y divide-(--color-border) border-y border-(--color-border)">
        {#each lessons as lesson, i (lesson.id)}
          <li>
            <a
              href="/c/{courseId}/l/{lesson.id}/overview"
              onclick={linkClick(`/c/${courseId}/l/${lesson.id}/overview`)}
              class="flex items-center justify-between gap-4 py-3.5 -mx-2 px-2 hover:bg-(--color-surface-muted) transition-colors rounded"
            >
              <div class="flex items-center gap-4 min-w-0">
                <span class="text-sm text-(--color-muted) tabular-nums w-6 text-right shrink-0">
                  {i + 1}
                </span>
                <span class="text-(--color-text) truncate">{lesson.title}</span>
              </div>
              <div class="flex shrink-0 items-center gap-2">
                {#if lesson.entryCount}
                  <span class="inline-flex items-center gap-1 text-xs text-(--color-muted)">
                    <BookOpen size={12} aria-hidden="true" />
                    {lesson.entryCount} words
                  </span>
                {/if}
                {#if lesson.status && lesson.status !== "ready"}
                  <StatusPill status={lesson.status} />
                {/if}
                <ChevronRight
                  size={16}
                  aria-hidden="true"
                  class="text-(--color-muted)/60"
                />
              </div>
            </a>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</div>
