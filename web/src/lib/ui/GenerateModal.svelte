<script lang="ts">
  import { Sparkles, X } from "lucide-svelte";
  import type { Snippet } from "svelte";

  let {
    open = $bindable(false),
    title = "Generate",
    children,
  }: {
    open?: boolean;
    title?: string;
    children: Snippet;
  } = $props();

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") open = false;
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
  <!-- Backdrop -->
  <div
    class="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
    role="dialog"
    aria-modal="true"
    aria-label={title}
  >
    <div
      class="absolute inset-0 bg-black/25 backdrop-blur-[1px]"
      onclick={() => (open = false)}
    ></div>

    <!-- Panel -->
    <div class="relative z-10 w-full max-w-md rounded-t-2xl bg-white shadow-2xl sm:rounded-xl">
      <!-- Orange header -->
      <div class="flex items-center gap-2.5 rounded-t-2xl border-b border-amber-100 bg-amber-50 px-5 py-3.5 sm:rounded-t-xl">
        <Sparkles size={15} class="shrink-0 text-amber-500" aria-hidden="true" />
        <span class="font-semibold text-amber-900">{title}</span>
        <button
          type="button"
          onclick={() => (open = false)}
          class="ml-auto grid h-6 w-6 place-items-center rounded text-amber-400 hover:bg-amber-100 hover:text-amber-700"
          aria-label="Close"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>

      <!-- Content -->
      <div class="p-5">
        {@render children()}
      </div>
    </div>
  </div>
{/if}
