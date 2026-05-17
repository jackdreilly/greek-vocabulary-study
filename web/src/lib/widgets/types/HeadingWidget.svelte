<script lang="ts">
  let { level = 1, text }: { level?: 1 | 2 | 3; text: string } = $props();
</script>

{#if level === 1}
  <h2 class="text-2xl font-semibold tracking-tight mt-10 mb-3">{text}</h2>
{:else if level === 2}
  <h3 class="text-xl font-semibold tracking-tight mt-8 mb-2">{text}</h3>
{:else}
  <h4 class="text-base font-semibold tracking-tight mt-6 mb-2">{text}</h4>
{/if}
