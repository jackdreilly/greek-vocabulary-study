<script lang="ts">
  import { onDestroy } from "svelte";
  import { subscribeCourse } from "../lib/data/courses.svelte";
  import { linkClick } from "../lib/router.svelte";
  import StatusPill from "../lib/ui/StatusPill.svelte";

  let { courseId }: { courseId: string } = $props();

  let sub = $state<ReturnType<typeof subscribeCourse>>(subscribeCourse(courseId));

  $effect(() => {
    const next = subscribeCourse(courseId);
    sub = next;
    return () => next.stop();
  });

  onDestroy(() => sub.stop());

  const lessons = $derived(
    Object.entries(sub.course?.lessonSummaries ?? {})
      .map(([id, s]) => ({ id, ...s }))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  );
</script>

<div class="max-w-3xl mx-auto pt-12 pb-24 px-6">
  {#if sub.loading}
    <p class="text-(--color-muted)">Loading…</p>
  {:else if sub.error || !sub.course}
    <p class="text-(--color-danger)">Course not found.</p>
  {:else}
    <header class="mb-10">
      <h1 class="text-3xl font-semibold tracking-tight">{sub.course.title}</h1>
      {#if sub.course.subtitle}
        <p class="mt-2 text-base text-(--color-muted)">{sub.course.subtitle}</p>
      {/if}
    </header>

    <section>
      <h2 class="text-xs tracking-widest uppercase text-(--color-muted) mb-3 font-semibold">
        Lessons
      </h2>
      <ul class="divide-y divide-(--color-border) border-y border-(--color-border)">
        {#each lessons as lesson, i (lesson.id)}
          <li>
            <a
              href="/c/{courseId}/l/{lesson.id}/vocab"
              onclick={linkClick(`/c/${courseId}/l/${lesson.id}/vocab`)}
              class="flex items-center justify-between gap-4 py-3.5 px-1 hover:bg-(--color-surface-muted) transition-colors -mx-1 px-2 rounded"
            >
              <div class="flex items-center gap-4 min-w-0">
                <span class="text-sm text-(--color-muted) tabular-nums w-6 text-right shrink-0">
                  {i + 1}
                </span>
                <span class="text-(--color-text) truncate">{lesson.title}</span>
              </div>
              {#if lesson.status && lesson.status !== "ready"}
                <StatusPill status={lesson.status} />
              {/if}
            </a>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</div>
