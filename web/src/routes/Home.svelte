<script lang="ts">
  import { onDestroy } from "svelte";
  import { subscribeCourses } from "../lib/data/courses.svelte";
  import { createCourseStub } from "../lib/data/createCourse";
  import { navigate } from "../lib/router.svelte";
  import Card from "../lib/ui/Card.svelte";
  import StatusPill from "../lib/ui/StatusPill.svelte";
  import { BookOpen, GraduationCap, Hash, Search, Sparkles } from "lucide-svelte";

  const sub = subscribeCourses();
  onDestroy(sub.stop);

  let sourcePrompt = $state("");
  let courseSearch = $state("");
  let creating = $state(false);
  let createError = $state<string | null>(null);
  const filteredCourses = $derived(
    courseSearch.trim() === ""
      ? sub.courses
      : sub.courses.filter((course) => {
          const q = courseSearch.trim().toLowerCase();
          return (
            course.title?.toLowerCase().includes(q) ||
            course.subtitle?.toLowerCase().includes(q) ||
            course.description?.toLowerCase().includes(q)
          );
        })
  );

  async function createCourse() {
    creating = true;
    createError = null;
    try {
      const courseId = await createCourseStub(sourcePrompt);
      sourcePrompt = "";
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

  <form
    class="mb-10 border-y border-(--color-border) py-5"
    onsubmit={(e) => {
      e.preventDefault();
      createCourse();
    }}
  >
    <label class="block text-sm font-medium mb-2" for="course-prompt">New course</label>
    <div class="flex flex-col sm:flex-row gap-2">
      <input
        id="course-prompt"
        type="text"
        bind:value={sourcePrompt}
        placeholder="Greek for cooking, island travel, rebetiko lyrics..."
        class="min-w-0 flex-1 rounded-md border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm focus:outline-none focus:border-(--color-accent) focus:ring-1 focus:ring-(--color-accent)"
      />
      <button
        type="submit"
        disabled={creating || sourcePrompt.trim().length === 0}
        class="inline-flex items-center justify-center gap-1.5 rounded-md bg-(--color-accent) px-4 py-2 text-sm font-medium text-white hover:bg-(--color-accent-hover) disabled:opacity-50"
      >
        <Sparkles size={14} aria-hidden="true" />
        {creating ? "Starting" : "Generate"}
      </button>
    </div>
    {#if createError}
      <p class="mt-2 text-sm text-(--color-danger)">{createError}</p>
    {/if}
  </form>

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
