<script lang="ts">
  import { Eye, EyeOff } from "lucide-svelte";
  import GreekText from "../../ui/GreekText.svelte";

  type Line = { speaker: string; el?: string; en?: string; greek?: string; english?: string };
  let {
    lines = [],
    title,
    setting,
  }: { lines?: Line[]; title?: string; setting?: string } = $props();

  let revealed = $state<boolean[]>(lines.map(() => false));

  let allRevealed = $derived(revealed.every(Boolean));

  function toggleAll() {
    const next = !allRevealed;
    revealed = lines.map(() => next);
  }

  function toggleLine(i: number) {
    revealed[i] = !revealed[i];
  }
</script>

<div class="my-6">
  <div class="flex items-center justify-between mb-3">
    <div>
      {#if title}
        <h3 class="text-base font-semibold tracking-tight">{title}</h3>
      {/if}
      {#if setting}
        <p class="text-sm text-(--color-muted)">{setting}</p>
      {/if}
    </div>
    <button
      type="button"
      onclick={toggleAll}
      class="flex items-center gap-1.5 rounded-md border border-(--color-border) px-2.5 py-1 text-xs font-medium text-(--color-muted) hover:text-(--color-fg) hover:border-(--color-border-strong) transition-colors"
    >
      {#if allRevealed}
        <EyeOff size={13} aria-hidden="true" />
        Hide all
      {:else}
        <Eye size={13} aria-hidden="true" />
        Show all
      {/if}
    </button>
  </div>

  <ul class="space-y-3">
    {#each lines as line, i}
      <li class="border-l-2 border-(--color-border-strong) pl-4">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0 flex-1">
            <div class="text-xs font-medium tracking-wide text-(--color-muted) uppercase mb-0.5">
              {line.speaker}
            </div>
            <GreekText>{line.el ?? line.greek}</GreekText>
            {#if revealed[i]}
              <p class="text-sm text-(--color-muted) mt-0.5">{line.en ?? line.english}</p>
            {:else}
              <p class="text-sm text-(--color-border-strong) mt-0.5 select-none">
                {"▪".repeat(Math.min((line.en ?? line.english ?? "").split(" ").length, 8))}
              </p>
            {/if}
          </div>
          <button
            type="button"
            onclick={() => toggleLine(i)}
            class="mt-0.5 shrink-0 rounded p-0.5 text-(--color-muted) hover:text-(--color-fg) transition-colors"
            title={revealed[i] ? "Hide translation" : "Show translation"}
          >
            {#if revealed[i]}
              <EyeOff size={14} aria-hidden="true" />
            {:else}
              <Eye size={14} aria-hidden="true" />
            {/if}
          </button>
        </div>
      </li>
    {/each}
  </ul>
</div>
