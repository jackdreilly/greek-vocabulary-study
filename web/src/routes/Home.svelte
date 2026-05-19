<script lang="ts">
  import { onDestroy } from "svelte";
  import { subscribeCourses } from "../lib/data/courses.svelte";
  import { createCourseStub } from "../lib/data/createCourse";
  import { navigate } from "../lib/router.svelte";
  import { textMatchesSearch } from "../lib/search";
  import { inferSkillLevel, type SkillLevel } from "../lib/skillLevel";
  import Card from "../lib/ui/Card.svelte";
  import SkillLevelPicker from "../lib/ui/SkillLevelPicker.svelte";
  import StatusPill from "../lib/ui/StatusPill.svelte";
  import { BookOpen, GraduationCap, Hash, Search, Sparkles } from "lucide-svelte";
  import GenerateModal from "../lib/ui/GenerateModal.svelte";
  import { subscribeAIConfig } from "../lib/data/aiConfig.svelte";

  const sub = subscribeCourses();
  onDestroy(sub.stop);

  const aiSub = subscribeAIConfig();
  const canGenerate = $derived(aiSub.config.features.contentGeneration ?? true);

  let courseModalOpen = $state(false);
  let sourcePrompt = $state("");
  let skillLevel = $state<SkillLevel | "">("");
  let courseSearch = $state("");
  let creating = $state(false);
  let createError = $state<string | null>(null);
  const filteredCourses = $derived(
    courseSearch.trim() === ""
      ? sub.courses
      : sub.courses.filter((course) => {
          const haystack = [course.title, course.subtitle, course.description].join(" ");
          return textMatchesSearch(haystack, courseSearch);
        })
  );

  async function createCourse() {
    creating = true;
    createError = null;
    try {
      const resolvedLevel: SkillLevel | undefined =
        skillLevel || inferSkillLevel(sourcePrompt) || undefined;
      const courseId = await createCourseStub(sourcePrompt, { skillLevel: resolvedLevel });
      sourcePrompt = "";
      skillLevel = "";
      navigate(`/c/${courseId}`);
    } catch (err) {
      createError = err instanceof Error ? err.message : String(err);
    } finally {
      creating = false;
    }
  }
</script>

<div class="max-w-3xl mx-auto pt-16 pb-24 px-6">
  <header class="mb-12">
    <p class="text-xs tracking-widest uppercase text-(--color-muted) mb-2 font-semibold">
      Fanari Go
    </p>
    <h1 class="text-4xl font-semibold tracking-tight">Greek vocabulary, with help.</h1>
  </header>

  <div class="mb-8 relative">
    <Search
      size={16}
      aria-hidden="true"
      class="absolute left-3 top-1/2 -translate-y-1/2 text-(--color-muted) pointer-events-none"
    />
    <input
      type="search"
      bind:value={courseSearch}
      placeholder="Search courses..."
      class="w-full rounded-md border border-(--color-border) bg-(--color-surface) pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-(--color-accent) focus:ring-1 focus:ring-(--color-accent)"
    />
  </div>

  {#if canGenerate}
    <div class="mb-10 border-y border-(--color-border) py-5">
      <p class="mb-2 text-sm font-medium">New course</p>
      <button
        type="button"
        onclick={() => (courseModalOpen = true)}
        disabled={creating}
        class="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm font-semibold text-amber-700 hover:border-amber-300 hover:bg-amber-100 disabled:opacity-50"
      >
        <Sparkles size={13} aria-hidden="true" />
        {creating ? "Starting..." : "Generate course"}
      </button>
      {#if createError}
        <p class="mt-2 text-sm text-(--color-danger)">{createError}</p>
      {/if}
    </div>
  {/if}

  <GenerateModal bind:open={courseModalOpen} title="Generate course">
    <form
      onsubmit={(e) => {
        e.preventDefault();
        courseModalOpen = false;
        void createCourse();
      }}
    >
      <div class="flex flex-col gap-3">
        <label class="block">
          <span class="mb-1 block text-sm font-medium text-(--color-text)">What is the course about?</span>
          <input
            type="text"
            bind:value={sourcePrompt}
            placeholder="Greek for cooking, island travel, rebetiko lyrics..."
            class="w-full rounded-md border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm focus:outline-none focus:border-(--color-accent) focus:ring-1 focus:ring-(--color-accent)"
          />
        </label>
        <SkillLevelPicker bind:value={skillLevel} />
        {#if createError}
          <p class="text-sm text-(--color-danger)">{createError}</p>
        {/if}
        <button
          type="submit"
          disabled={creating || sourcePrompt.trim().length === 0}
          class="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
        >
          <Sparkles size={14} aria-hidden="true" />
          {creating ? "Starting..." : "Generate course"}
        </button>
      </div>
    </form>
  </GenerateModal>

  {#if sub.loading}
    <p class="text-(--color-muted)">Loading courses…</p>
  {:else if sub.error}
    <p class="text-(--color-danger)">Failed to load courses: {sub.error.message}</p>
  {:else if sub.courses.length === 0}
    <p class="text-(--color-muted)">No courses yet.</p>
  {:else if filteredCourses.length === 0}
    <p class="text-(--color-muted)">No matching courses.</p>
  {:else}
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {#each filteredCourses as course (course.id)}
        <Card href="/c/{course.id}" class="p-5">
          <div class="flex items-start justify-between gap-3">
            <div class="flex items-start gap-2.5 min-w-0">
              <GraduationCap
                size={18}
                aria-hidden="true"
                class="shrink-0 text-(--color-muted) mt-0.5"
              />
              <h2 class="text-lg font-semibold tracking-tight text-(--color-text)">
                {course.title ?? "(untitled)"}
              </h2>
            </div>
            {#if course.status && course.status !== "ready"}
              <StatusPill status={course.status} />
            {/if}
          </div>
          {#if course.subtitle}
            <p class="mt-1 text-sm text-(--color-muted) line-clamp-2">{course.subtitle}</p>
          {/if}
          <div class="mt-4 flex items-center gap-3 text-xs text-(--color-muted)">
            {#if course.counts?.lessons}
              <span class="inline-flex items-center gap-1">
                <BookOpen size={12} aria-hidden="true" />
                {course.counts.lessons} lessons
              </span>
            {/if}
            {#if course.counts?.entries}
              <span class="inline-flex items-center gap-1">
                <Hash size={12} aria-hidden="true" />
                {course.counts.entries} words
              </span>
            {/if}
          </div>
        </Card>
      {/each}
    </div>
  {/if}
</div>
