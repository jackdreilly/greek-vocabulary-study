<script lang="ts">
  import { linkClick } from "../router.svelte";

  type Props = {
    href: string;
    class?: string;
    children: import("svelte").Snippet;
  };

  let { href, class: className = "", children }: Props = $props();
</script>

<a
  {href}
  onclick={linkClick(href)}
  class="text-(--color-accent) hover:text-(--color-accent-hover) hover:underline {className}"
>
  {@render children()}
</a>
