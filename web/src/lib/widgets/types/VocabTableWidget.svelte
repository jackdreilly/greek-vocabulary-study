<script lang="ts">
  import GreekText from "../../ui/GreekText.svelte";

  type Row = { el?: string; en?: string; greek?: string; english?: string; article?: string; example?: string };
  let { rows, vocabEntries, title }: { rows?: Row[]; vocabEntries?: Row[]; title?: string } = $props();
  const items = $derived(rows ?? vocabEntries ?? []);
  const showArticle = (article?: string) =>
    Boolean(article && !["n/a", "none", "-"].includes(article.trim().toLowerCase()));
</script>

{#if title}
  <h3 class="text-base font-semibold tracking-tight mt-6 mb-2">{title}</h3>
{/if}
<ul class="my-5 divide-y divide-(--color-border) border-y border-(--color-border)">
  {#each items as row}
    <li class="py-3">
      <div class="flex items-baseline justify-between gap-4">
        <div class="flex items-baseline gap-2">
          {#if showArticle(row.article)}
            <span class="text-sm text-(--color-muted)">{row.article}</span>
          {/if}
          <GreekText>{row.el ?? row.greek}</GreekText>
        </div>
        <span class="text-(--color-text)">{row.en ?? row.english}</span>
      </div>
      {#if row.example}
        <p class="text-sm text-(--color-muted) mt-1">{row.example}</p>
      {/if}
    </li>
  {/each}
</ul>
