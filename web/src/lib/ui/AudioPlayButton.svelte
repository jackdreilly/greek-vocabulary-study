<script lang="ts">
  import { Loader2, Volume2 } from "lucide-svelte";

  let {
    url,
    label = "Play",
    iconSize = 14,
    class: className = "",
  }: {
    url: string;
    label?: string;
    iconSize?: number;
    class?: string;
  } = $props();

  let status = $state<"idle" | "loading" | "playing">("idle");
  let audio: HTMLAudioElement | null = null;

  function resetAudio() {
    if (!audio) return;
    audio.pause();
    audio.src = "";
    audio.load();
    audio = null;
  }

  async function play(event: MouseEvent) {
    event.stopPropagation();
    if (status === "loading") return;

    resetAudio();
    status = "loading";
    const next = new Audio(url);
    audio = next;

    next.onplaying = () => {
      if (audio === next) status = "playing";
    };
    next.onwaiting = () => {
      if (audio === next) status = "loading";
    };
    next.onended = () => {
      if (audio === next) status = "idle";
    };
    next.onerror = () => {
      if (audio === next) status = "idle";
    };

    try {
      await next.play();
      if (audio === next) status = "playing";
    } catch {
      if (audio === next) status = "idle";
    }
  }

  $effect(() => {
    url;
    return () => resetAudio();
  });
</script>

<button
  type="button"
  onclick={play}
  disabled={status === "loading"}
  class={className}
  title="Play pronunciation"
  aria-label="Play pronunciation"
  aria-busy={status === "loading"}
>
  {#if status === "loading"}
    <Loader2 size={iconSize} aria-hidden="true" class="animate-spin" />
  {:else}
    <Volume2 size={iconSize} aria-hidden="true" />
  {/if}
  {#if label}
    <span>{status === "loading" ? "Loading..." : label}</span>
  {/if}
</button>
