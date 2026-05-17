<script lang="ts">
  import GreekText from "../../ui/GreekText.svelte";

  type Branch = { el?: string; en?: string; greek?: string; english?: string; relation: string };
  let {
    root,
    rootGreek,
    rootEnglish,
    rootGloss,
    branches = [],
  }: {
    root?: { el: string; en: string };
    rootGreek?: string;
    rootEnglish?: string;
    rootGloss?: string;
    branches?: Branch[];
  } = $props();

  const rootEl = $derived(root?.el ?? rootGreek);
  const rootEn = $derived(root?.en ?? rootGloss ?? rootEnglish);
</script>

<section class="my-6">
  {#if rootEl}
    <div class="text-center">
      <GreekText size="lg">{rootEl}</GreekText>
      {#if rootEn}
        <p class="text-sm text-(--color-muted)">{rootEn}</p>
      {/if}
    </div>
  {/if}
  <ul class="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
    {#each branches as b}
      <li class="border border-(--color-border) rounded-md px-3 py-2 bg-(--color-surface)">
        <div class="flex items-baseline justify-between gap-2">
          <GreekText>{b.el ?? b.greek}</GreekText>
          <span class="text-xs text-(--color-muted) shrink-0">{b.relation}</span>
        </div>
        <p class="text-sm text-(--color-muted)">{b.en ?? b.english}</p>
      </li>
    {/each}
  </ul>
</section>
