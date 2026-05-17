<script lang="ts">
  import { subscribeCourse } from "../lib/data/courses.svelte";
  import { linkClick } from "../lib/router.svelte";
  import { extractLead, hasMoreThanLead } from "../lib/markdown";
  import StatusPill from "../lib/ui/StatusPill.svelte";
  import MarkdownBody from "../lib/ui/MarkdownBody.svelte";

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
  // Reset expander whenever we change courses
  $effect(() => {
    courseId;
    expanded = false;
  });
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
    </header>

    {#if lead}
      <section class="mb-12">
        <MarkdownBody markdown={expanded ? description : lead} />
        {#if hasMore}
          <button
            type="button"
            onclick={() => (expanded = !expanded)}
            class="mt-4 text-sm font-medium text-(--color-accent) hover:text-(--color-accent-hover)"
          >
            {expanded ? "Show less" : "Read full overview →"}
          </button>
        {/if}
      </section>
    {/if}

    {#if lessons.length === 0 && sub.course.status !== "ready"}
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
      </section>
    {/if}

    <section>
      <h2 class="text-xs tracking-widest uppercase text-(--color-muted) mb-3 font-semibold">
        Lessons
      </h2>
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
