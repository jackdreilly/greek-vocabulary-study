<script lang="ts">
  let { name }: { name: string } = $props();
</script>

<div class="text-center py-16 border border-dashed border-(--color-border) rounded-lg">
  <p class="text-(--color-muted) text-sm">
    <span class="font-medium text-(--color-text)">{name}</span>
    will live here. Coming in the next slice.
  </p>
</div>
