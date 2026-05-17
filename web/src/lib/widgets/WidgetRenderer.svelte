<script lang="ts">
  import type { Component as SvelteComponent } from "svelte";
  import HeadingWidget from "./types/HeadingWidget.svelte";
  import ProseWidget from "./types/ProseWidget.svelte";
  import CalloutWidget from "./types/CalloutWidget.svelte";
  import VocabTableWidget from "./types/VocabTableWidget.svelte";
  import ConjugationTableWidget from "./types/ConjugationTableWidget.svelte";
  import ComparisonTableWidget from "./types/ComparisonTableWidget.svelte";
  import ReadingPassageWidget from "./types/ReadingPassageWidget.svelte";
  import DialogueWidget from "./types/DialogueWidget.svelte";
  import MiniQuizWidget from "./types/MiniQuizWidget.svelte";
  import FillInBlanksWidget from "./types/FillInBlanksWidget.svelte";
  import WordTreeWidget from "./types/WordTreeWidget.svelte";

  // Widget is typed loosely here because the discriminated union — and its
  // type-import from `data/plans.svelte` — has been observed to interact
  // badly with Svelte 5's reactivity tracking in this file's discriminator
  // template. Each child widget component does its own narrowed typing.
  let { widget }: { widget: { type: string; [k: string]: any } } = $props();

  const widgetComponents: Record<string, SvelteComponent<any>> = {
    heading: HeadingWidget,
    prose: ProseWidget,
    callout: CalloutWidget,
    vocab_table: VocabTableWidget,
    conjugation_table: ConjugationTableWidget,
    comparison_table: ComparisonTableWidget,
    reading_passage: ReadingPassageWidget,
    dialogue: DialogueWidget,
    mini_quiz: MiniQuizWidget,
    fill_in_blanks: FillInBlanksWidget,
    word_tree: WordTreeWidget,
  };

  let Component = $derived(widgetComponents[widget.type]);
</script>

{#if Component}
  <Component {...widget} />
{/if}
