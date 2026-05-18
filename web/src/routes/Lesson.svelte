<script lang="ts">
  import { subscribeLesson } from "../lib/data/lessons.svelte";
  import { linkClick, route } from "../lib/router.svelte";
  import VocabTab from "./lesson/VocabTab.svelte";
  import FlashcardsTab from "./lesson/FlashcardsTab.svelte";
  import OverviewTab from "./lesson/OverviewTab.svelte";
  import PlansTab from "./lesson/PlansTab.svelte";
  import GamesTab from "./lesson/GamesTab.svelte";
  import StatusPill from "../lib/ui/StatusPill.svelte";
  import { retryLessonGeneration } from "../lib/data/retryGeneration";

  let { courseId, lessonId, tab }: { courseId: string; lessonId: string; tab: string } = $props();

  let sub = $state<ReturnType<typeof subscribeLesson>>();

  $effect(() => {
    const next = subscribeLesson(courseId, lessonId);
    sub = next;
    return () => next.stop();
  });

  const tabs = [
    { key: "overview", label: "Overview" },
    { key: "vocab", label: "Vocabulary" },
    { key: "cards", label: "Flashcards" },
    { key: "games", label: "Games" },
    { key: "plans", label: "Plans" },
  ] as const;

  function tabHref(key: string) {
    return `/c/${courseId}/l/${lessonId}/${key}`;
  }
</script>

<div class="max-w-3xl mx-auto pt-12 pb-24 px-6">
  {#if !sub || sub.loading}
    <p class="text-(--color-muted)">Loading lesson…</p>
  {:else if sub.error || !sub.lesson}
    <p class="text-(--color-danger)">Lesson not found.</p>
  {:else}
    <header class="mb-6">
      <div class="flex items-start justify-between gap-4">
        <h1 class="text-2xl sm:text-3xl font-semibold tracking-tight">{sub.lesson.title}</h1>
        {#if sub.lesson.status && sub.lesson.status !== "ready"}
          <StatusPill status={sub.lesson.status} />
        {/if}
      </div>
      {#if sub.lesson.subtitle}
        <p class="mt-2 text-(--color-muted)">{sub.lesson.subtitle}</p>
      {/if}
      {#if sub.lesson.status && sub.lesson.status !== "ready"}
        <div
          class="mt-4 rounded-md border px-4 py-3 text-sm {sub.lesson.status === 'error'
            ? 'border-[#fecaca] bg-[#fef2f2] text-(--color-danger)'
            : 'border-[#bfdbfe] bg-[#eff6ff] text-[#1d4ed8]'}"
        >
          {#if sub.lesson.statusLog?.length}
            <ol class="space-y-1">
              {#each sub.lesson.statusLog.slice(-5) as item}
                <li>{item.message}</li>
              {/each}
            </ol>
          {:else}
            Generating lesson...
          {/if}
          {#if sub.lesson.status === "error"}
            <button
              type="button"
              onclick={() => void retryLessonGeneration(courseId, lessonId)}
              class="mt-3 rounded-md border border-current px-3 py-2 text-sm font-medium"
            >
              Try again
            </button>
          {/if}
        </div>
      {/if}
      {#if sub.lesson.error}
        <p class="mt-3 rounded-md bg-[#fef2f2] px-4 py-3 text-sm text-(--color-danger)">
          {sub.lesson.error}
        </p>
      {/if}
    </header>

    <nav class="flex gap-6 border-b border-(--color-border) mb-8" aria-label="Lesson sections">
      {#each tabs as t}
        {@const active = t.key === tab}
        <a
          href={tabHref(t.key)}
          onclick={linkClick(tabHref(t.key))}
          class="pb-3 -mb-px text-sm border-b-2 transition-colors
            {active
            ? 'text-(--color-text) border-(--color-accent) font-medium'
            : 'text-(--color-muted) border-transparent hover:text-(--color-text)'}"
        >
          {t.label}
        </a>
      {/each}
    </nav>

    {#if tab === "overview"}
      <OverviewTab markdown={sub.lesson.description} />
    {:else if tab === "vocab"}
      <VocabTab {courseId} {lessonId} />
    {:else if tab === "cards"}
      <FlashcardsTab {courseId} {lessonId} />
    {:else if tab === "games"}
      <GamesTab {courseId} {lessonId} />
    {:else if tab === "plans"}
      <PlansTab {courseId} {lessonId} />
    {/if}
  {/if}
</div>
