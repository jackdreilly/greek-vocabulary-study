<script lang="ts">
  import MarkdownBody from "../../ui/MarkdownBody.svelte";
  let { title, markdown }: { title?: string; markdown: string } = $props();
</script>

{#if title}
  <h3 class="mt-6 mb-2 text-base font-semibold text-(--color-text)">{title}</h3>
{/if}
<MarkdownBody {markdown} class="my-4" />
