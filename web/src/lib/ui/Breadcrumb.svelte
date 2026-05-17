<script lang="ts">
  import { linkClick } from "../router.svelte";

  export type Crumb = { label: string; href?: string };
  let { crumbs }: { crumbs: Crumb[] } = $props();
</script>

<nav class="flex items-center gap-1.5 text-sm text-(--color-muted) overflow-hidden">
  {#each crumbs as crumb, i}
    {#if crumb.href}
      <a
        href={crumb.href}
        onclick={linkClick(crumb.href)}
        class="hover:text-(--color-text) truncate"
      >
        {crumb.label}
      </a>
    {:else}
      <span class="text-(--color-text) truncate">{crumb.label}</span>
    {/if}
    {#if i < crumbs.length - 1}
      <span class="text-(--color-border) shrink-0">/</span>
    {/if}
  {/each}
</nav>
