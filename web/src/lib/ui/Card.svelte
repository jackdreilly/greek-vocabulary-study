<script lang="ts">
  type Props = {
    children: import("svelte").Snippet;
    href?: string;
    class?: string;
  };
  let { children, href, class: className = "" }: Props = $props();

  import { linkClick } from "../router.svelte";
</script>

{#if href}
  <a
    {href}
    onclick={linkClick(href)}
    class="block border border-(--color-border) rounded-lg bg-(--color-surface) hover:border-(--color-border-strong) hover:shadow-sm transition-all {className}"
  >
    {@render children()}
  </a>
{:else}
  <div class="border border-(--color-border) rounded-lg bg-(--color-surface) {className}">
    {@render children()}
  </div>
{/if}
