<script lang="ts">
  import MarkdownBody from "../../ui/MarkdownBody.svelte";
  let { markdown, body }: { markdown?: string; body?: string } = $props();
  const content = $derived(markdown ?? body ?? "");
</script>

<MarkdownBody markdown={content} class="my-4" />
