<script lang="ts">
  import GreekText from "../../ui/GreekText.svelte";

  type Gloss = { el?: string; en?: string; greek?: string; english?: string };
  let {
    el,
    en,
    greek,
    english,
    glossary,
    title,
  }: {
    el?: string;
    en?: string;
    greek?: string;
    english?: string;
    glossary?: Gloss[];
    title?: string;
  } = $props();

  let translationVisible = $state(true);
  const greekText = $derived(el ?? greek ?? "");
  const englishText = $derived(en ?? english ?? "");
</script>

<section class="my-6 rounded-md border border-(--color-border) bg-(--color-surface-muted) px-4 py-4">
  {#if title}
    <h3 class="text-base font-semibold tracking-tight mb-3">{title}</h3>
  {/if}
  <div class="flex justify-end mb-2">
    <button
      type="button"
      onclick={() => (translationVisible = !translationVisible)}
      class="text-xs font-medium text-(--color-accent) hover:text-(--color-accent-hover)"
    >
      {translationVisible ? "Hide translation" : "Show translation"}
    </button>
  </div>
  <p class="font-serif text-lg leading-relaxed text-(--color-text) whitespace-pre-wrap">{greekText}</p>
  {#if translationVisible}
    <p class="mt-3 text-sm text-(--color-muted) leading-relaxed whitespace-pre-wrap">{englishText}</p>
  {/if}
  {#if glossary && glossary.length > 0}
    <details class="mt-4">
      <summary class="cursor-pointer text-xs font-medium text-(--color-muted) hover:text-(--color-text)">
        Glossary ({glossary.length})
      </summary>
      <ul class="mt-2 text-sm divide-y divide-(--color-border)">
        {#each glossary as g}
          <li class="py-1.5 flex justify-between gap-4">
            <GreekText>{g.el ?? g.greek}</GreekText>
            <span class="text-(--color-muted)">{g.en ?? g.english}</span>
          </li>
        {/each}
      </ul>
    </details>
  {/if}
</section>
