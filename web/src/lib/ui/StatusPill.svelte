<script lang="ts">
  type Status = "initializing" | "streaming" | "ready" | "error" | "reverting" | string;
  let { status }: { status: Status } = $props();

  const cls = $derived(
    {
      ready: "text-[#15803d] border-[#bbf7d0] bg-[#f0fdf4]",
      streaming: "text-[#b45309] border-[#fde68a] bg-[#fffbeb]",
      initializing: "text-(--color-muted) border-(--color-border) bg-(--color-surface-muted)",
      error: "text-(--color-danger) border-[#fecaca] bg-[#fef2f2]",
      reverting: "text-(--color-muted) border-(--color-border) bg-(--color-surface-muted)",
    }[status] ?? "text-(--color-muted) border-(--color-border) bg-(--color-surface-muted)"
  );
</script>

<span
  class="inline-block text-[11px] tracking-wide px-2 py-0.5 rounded-full border font-medium {cls}"
>
  {status}
</span>
