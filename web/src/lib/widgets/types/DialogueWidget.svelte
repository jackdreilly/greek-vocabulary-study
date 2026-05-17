<script lang="ts">
  import GreekText from "../../ui/GreekText.svelte";

  type Line = { speaker: string; el?: string; en?: string; greek?: string; english?: string };
  let { lines = [], title, setting }: { lines?: Line[]; title?: string; setting?: string } = $props();
</script>

{#if title}
  <h3 class="text-base font-semibold tracking-tight mt-6 mb-2">{title}</h3>
{/if}
{#if setting}
  <p class="text-sm text-(--color-muted) -mt-1 mb-3">{setting}</p>
{/if}
<ul class="my-6 space-y-3">
  {#each lines as line}
    <li class="border-l-2 border-(--color-border-strong) pl-4">
      <div class="text-xs font-medium tracking-wide text-(--color-muted) uppercase mb-0.5">
        {line.speaker}
      </div>
      <GreekText>{line.el ?? line.greek}</GreekText>
      <p class="text-sm text-(--color-muted) mt-0.5">{line.en ?? line.english}</p>
    </li>
  {/each}
</ul>
