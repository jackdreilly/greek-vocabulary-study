<script lang="ts">
  type Item = {
    q?: string;
    question?: string;
    options: string[];
    correctIndex?: number;
    answerIndex?: number;
    explanation?: string;
  };
  let { items, questions, title }: { items?: Item[]; questions?: Item[]; title?: string } = $props();

  let selections = $state<Record<number, number>>({});
  const quizItems = $derived(items ?? questions ?? []);
</script>

{#if title}
  <h3 class="text-base font-semibold tracking-tight mt-6 mb-2">{title}</h3>
{/if}
<ol class="my-6 space-y-5 list-decimal pl-5">
  {#each quizItems as item, qIdx}
    {@const correctIndex = item.correctIndex ?? item.answerIndex}
    <li>
      <p class="font-medium mb-2">{item.q ?? item.question}</p>
      <ul class="space-y-1.5">
        {#each item.options as opt, optIdx}
          {@const selected = selections[qIdx] === optIdx}
          {@const correct = correctIndex === optIdx}
          {@const showResult = selections[qIdx] !== undefined}
          <li>
            <button
              type="button"
              onclick={() => (selections = { ...selections, [qIdx]: optIdx })}
              class="w-full text-left px-3 py-1.5 border rounded transition-colors
                {showResult && correct
                ? 'bg-[#f0fdf4] border-[#bbf7d0] text-[#15803d]'
                : showResult && selected
                  ? 'bg-[#fef2f2] border-[#fecaca] text-(--color-danger)'
                  : 'bg-(--color-surface) border-(--color-border) hover:border-(--color-border-strong)'}"
            >
              {opt}
            </button>
          </li>
        {/each}
      </ul>
      {#if selections[qIdx] !== undefined && item.explanation}
        <p class="mt-2 text-sm text-(--color-muted)">{item.explanation}</p>
      {/if}
    </li>
  {/each}
</ol>
