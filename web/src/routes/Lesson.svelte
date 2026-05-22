<script lang="ts">
  import {
    subscribeEntries,
    subscribeGames,
    subscribeLatestGameBatches,
    subscribeLatestVocabBatches,
    subscribeLesson,
  } from "../lib/data/lessons.svelte";
  import { subscribePlans } from "../lib/data/plans.svelte";
  import { linkClick, route } from "../lib/router.svelte";
  import VocabTab from "./lesson/VocabTab.svelte";
  import FlashcardsTab from "./lesson/FlashcardsTab.svelte";
  import OverviewTab from "./lesson/OverviewTab.svelte";
  import PlansTab from "./lesson/PlansTab.svelte";
  import GamesTab from "./lesson/GamesTab.svelte";
  import StatusPill from "../lib/ui/StatusPill.svelte";
  import EpubButton from "../lib/ui/EpubButton.svelte";
  import { retryLessonGeneration } from "../lib/data/retryGeneration";
  import { subscribeAIConfig } from "../lib/data/aiConfig.svelte";
  import { RefreshCw } from "lucide-svelte";

  const aiSub = subscribeAIConfig();
  const canGenerate = $derived(aiSub.config.features.contentGeneration ?? true);

  let { courseId, lessonId, tab }: { courseId: string; lessonId: string; tab: string } = $props();

  let sub = $state<ReturnType<typeof subscribeLesson>>();
  let entriesSub = $state<ReturnType<typeof subscribeEntries>>();
  let gamesSub = $state<ReturnType<typeof subscribeGames>>();
  let plansSub = $state<ReturnType<typeof subscribePlans>>();
  let vocabBatchSub = $state<ReturnType<typeof subscribeLatestVocabBatches>>();
  let gameBatchSub = $state<ReturnType<typeof subscribeLatestGameBatches>>();

  $effect(() => {
    const next = subscribeLesson(courseId, lessonId);
    sub = next;
    return () => next.stop();
  });

  // Warm the likely next tabs while the user is reading the overview.
  $effect(() => {
    const nextEntries = subscribeEntries(courseId, lessonId);
    const nextGames = subscribeGames(courseId, lessonId);
    const nextPlans = subscribePlans(courseId, lessonId);
    const nextVocabBatch = subscribeLatestVocabBatches(courseId, lessonId);
    const nextGameBatch = subscribeLatestGameBatches(courseId, lessonId);
    entriesSub = nextEntries;
    gamesSub = nextGames;
    plansSub = nextPlans;
    vocabBatchSub = nextVocabBatch;
    gameBatchSub = nextGameBatch;
    return () => {
      nextEntries.stop();
      nextGames.stop();
      nextPlans.stop();
      nextVocabBatch.stop();
      nextGameBatch.stop();
    };
  });

  const tabs = [
    { key: "overview", label: "Overview" },
    { key: "vocab", label: "Vocabulary" },
    { key: "cards", label: "Flashcards" },
    { key: "games", label: "Games" },
    { key: "plans", label: "Plans" },
  ] as const;

  const isLocked = $derived(tab === "cards" || tab === "games");

  function tabHref(key: string) {
    return `/c/${courseId}/l/${lessonId}/${key}`;
  }
</script>

<div
  class="w-full max-w-3xl mx-auto px-4 sm:px-6 flex flex-col {isLocked
    ? 'flex-1 min-h-0 overflow-hidden pt-3 pb-3'
    : 'pt-12 pb-24'}"
>
  {#if !sub || sub.loading}
    <p class="text-(--color-muted)">Loading lesson…</p>
  {:else if sub.error || !sub.lesson}
    <p class="text-(--color-danger)">Lesson not found.</p>
  {:else}
    <header class={isLocked ? "mb-2 flex-shrink-0" : "mb-6"}>
      <div class="flex items-center justify-between gap-4">
        <h1 class="{isLocked ? 'text-lg sm:text-xl font-bold' : 'text-2xl sm:text-3xl font-semibold'} tracking-tight">{sub.lesson.title}</h1>
        <div class="flex items-center gap-3 shrink-0">
          {#if !isLocked && sub.lesson.status === "ready"}
            <EpubButton scope={{ type: "lesson", courseId, lessonId }} />
          {/if}
          {#if sub.lesson.status && sub.lesson.status !== "ready"}
            <StatusPill status={sub.lesson.status} />
          {/if}
        </div>
      </div>
      {#if sub.lesson.subtitle && !isLocked}
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
              class="mt-3 inline-flex items-center gap-1.5 rounded-md border border-current px-3 py-2 text-sm font-medium"
            >
              <RefreshCw size={14} aria-hidden="true" />
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

    <nav class="flex gap-6 border-b border-(--color-border) flex-shrink-0 {isLocked ? 'mb-3' : 'mb-8'}" aria-label="Lesson sections">
      {#each tabs as t}
        {@const active = t.key === tab}
        <a
          href={tabHref(t.key)}
          onclick={linkClick(tabHref(t.key))}
          class="{isLocked ? 'pb-2' : 'pb-3'} -mb-px text-sm border-b-2 transition-colors
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
      <VocabTab {courseId} {lessonId} {entriesSub} {vocabBatchSub} {canGenerate} />
    {:else if tab === "cards"}
      <FlashcardsTab {courseId} {lessonId} {entriesSub} />
    {:else if tab === "games"}
      <GamesTab {courseId} {lessonId} {gamesSub} lessonSub={sub} {gameBatchSub} {canGenerate} />
    {:else if tab === "plans"}
      <PlansTab {courseId} {lessonId} {plansSub} {canGenerate} />
    {/if}
  {/if}
</div>
