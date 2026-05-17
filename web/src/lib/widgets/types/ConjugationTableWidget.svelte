<script lang="ts">
  import GreekText from "../../ui/GreekText.svelte";

  type Row = { form?: string; label?: string; cells: string[] };
  let {
    headers,
    columns,
    rows = [],
    interactivePractice = false,
    title,
    notes,
  }: {
    headers?: string[];
    columns?: string[];
    rows?: Row[];
    interactivePractice?: boolean;
    title?: string;
    notes?: string;
  } = $props();

  let practiceMode = $state(false);
  let revealedCells = $state<Set<string>>(new Set());
  const tableHeaders = $derived(headers ?? columns ?? []);

  function cellKey(rowIdx: number, colIdx: number) {
    return `${rowIdx}:${colIdx}`;
  }
</script>

<section class="my-6">
  {#if title}
    <h3 class="text-base font-semibold tracking-tight mb-2">{title}</h3>
  {/if}
  {#if interactivePractice}
    <div class="flex justify-end mb-2">
      <button
        type="button"
        onclick={() => {
          practiceMode = !practiceMode;
          revealedCells = new Set();
        }}
        class="text-xs font-medium text-(--color-accent) hover:text-(--color-accent-hover)"
      >
        {practiceMode ? "Show all" : "Practice mode"}
      </button>
    </div>
  {/if}
  <table class="w-full border-collapse text-sm">
    <thead>
      <tr>
        <th
          class="border border-(--color-border) bg-(--color-surface-muted) px-3 py-1.5 text-left font-semibold"
          >&nbsp;</th
        >
        {#each tableHeaders as h}
          <th
            class="border border-(--color-border) bg-(--color-surface-muted) px-3 py-1.5 text-left font-semibold"
          >
            {h}
          </th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {#each rows as row, rowIdx}
        <tr>
          <td class="border border-(--color-border) px-3 py-1.5 font-medium">
            {row.form ?? row.label}
          </td>
          {#each row.cells as cell, colIdx}
            {@const key = cellKey(rowIdx, colIdx)}
            {@const hidden = practiceMode && !revealedCells.has(key)}
            <td class="border border-(--color-border) px-3 py-1.5">
              {#if hidden}
                <button
                  type="button"
                  onclick={() => (revealedCells = new Set([...revealedCells, key]))}
                  class="text-(--color-muted) hover:text-(--color-text) italic w-full text-left"
                  aria-label="Reveal"
                >
                  ___
                </button>
              {:else}
                <GreekText>{cell}</GreekText>
              {/if}
            </td>
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>
  {#if notes}
    <p class="mt-2 text-sm text-(--color-muted)">{notes}</p>
  {/if}
</section>
