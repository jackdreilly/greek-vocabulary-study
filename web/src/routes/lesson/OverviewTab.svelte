<script lang="ts">
  import MarkdownBody from "../../lib/ui/MarkdownBody.svelte";

  let { markdown }: { markdown: string | undefined | null } = $props();
</script>

{#if markdown && markdown.trim()}
  <article class="max-w-2xl">
    <MarkdownBody {markdown} />
  </article>
{:else}
  <p class="text-(--color-muted)">No overview yet.</p>
{/if}
