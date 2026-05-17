<script lang="ts">
  import { onDestroy } from "svelte";
  import { subscribeCourses } from "../lib/data/courses.svelte";
  import Card from "../lib/ui/Card.svelte";

  const sub = subscribeCourses();
  onDestroy(sub.stop);
</script>

<div class="max-w-3xl mx-auto pt-16 pb-24 px-6">
  <header class="mb-12">
    <p class="text-xs tracking-widest uppercase text-(--color-muted) mb-2 font-semibold">
      Greekflash
    </p>
    <h1 class="text-4xl font-semibold tracking-tight">Greek vocabulary, with help.</h1>
  </header>

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
