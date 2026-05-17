<script lang="ts">
  import { renderMarkdown } from "../markdown";
  let { markdown, class: className = "" }: { markdown: string; class?: string } = $props();
  const html = $derived(renderMarkdown(markdown));
</script>

<div class="markdown {className}">{@html html}</div>
