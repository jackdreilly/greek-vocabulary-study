<script lang="ts">
  import { onDestroy } from "svelte";
  import { subscribeLesson } from "../lib/data/lessons.svelte";
  import { linkClick, route } from "../lib/router.svelte";
  import VocabTab from "./lesson/VocabTab.svelte";
  import OverviewTab from "./lesson/OverviewTab.svelte";
  import ComingSoon from "./lesson/ComingSoon.svelte";

  let { courseId, lessonId, tab }: { courseId: string; lessonId: string; tab: string } = $props();

  let sub = $state<ReturnType<typeof subscribeLesson>>(subscribeLesson(courseId, lessonId));

  $effect(() => {
    const next = subscribeLesson(courseId, lessonId);
    sub = next;
    return () => next.stop();
  });

  onDestroy(() => sub.stop());

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
  {#if sub.loading}
    <p class="text-(--color-muted)">Loading lesson…</p>
  {:else if sub.error || !sub.lesson}
    <p class="text-(--color-danger)">Lesson not found.</p>
  {:else}
    <header class="mb-6">
      <h1 class="text-2xl sm:text-3xl font-semibold tracking-tight">{sub.lesson.title}</h1>
      {#if sub.lesson.subtitle}
        <p class="mt-2 text-(--color-muted)">{sub.lesson.subtitle}</p>
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
      <ComingSoon name="Flashcards" />
    {:else if tab === "games"}
      <ComingSoon name="Games" />
    {:else if tab === "plans"}
      <ComingSoon name="Plans" />
    {/if}
  {/if}
</div>
