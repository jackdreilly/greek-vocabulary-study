<script lang="ts">
  import { onDestroy } from "svelte";
  import { subscribeCourses } from "../lib/data/courses.svelte";
  import { createCourseStub } from "../lib/data/createCourse";
  import { navigate } from "../lib/router.svelte";
  import Card from "../lib/ui/Card.svelte";

  const sub = subscribeCourses();
  onDestroy(sub.stop);

  let sourcePrompt = $state("");
  let creating = $state(false);
  let createError = $state<string | null>(null);

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
        class="rounded-md bg-(--color-accent) px-4 py-2 text-sm font-medium text-white hover:bg-(--color-accent-hover) disabled:opacity-50"
      >
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
  {:else}
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {#each sub.courses as course (course.id)}
        <Card href="/c/{course.id}" class="p-5">
          <h2 class="text-lg font-semibold tracking-tight text-(--color-text)">
            {course.title ?? "(untitled)"}
          </h2>
          {#if course.subtitle}
            <p class="mt-1 text-sm text-(--color-muted) line-clamp-2">{course.subtitle}</p>
          {/if}
          <div class="mt-4 flex items-center gap-3 text-xs text-(--color-muted)">
            {#if course.counts?.lessons}
              <span>{course.counts.lessons} lessons</span>
            {/if}
          </div>
        </Card>
      {/each}
    </div>
  {/if}
</div>
