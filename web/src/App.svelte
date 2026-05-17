<script lang="ts">
  import { onMount } from "svelte";
  import { collection, getDocs } from "firebase/firestore";
  import { db, isEmulator } from "./lib/firebase";

  let connected = $state<"checking" | "online" | "offline">("checking");
  let env = $state(isEmulator() ? "emulator" : "production");

  onMount(async () => {
    try {
      await getDocs(collection(db, "ai_config"));
      connected = "online";
    } catch (err) {
      console.error("Firestore connect failed:", err);
      connected = "offline";
    }
  });
</script>

<main class="max-w-2xl mx-auto pt-24 px-6">
  <p class="text-xs tracking-widest uppercase text-(--color-muted) mb-2 font-medium">Greekflash</p>

  <h1 class="text-4xl sm:text-5xl font-semibold tracking-tight m-0">The rewrite is alive.</h1>

  <p class="text-(--color-muted) mt-3 text-base">
    Scaffolding ready. Backend: <code
      class="font-mono text-sm px-1.5 py-0.5 rounded bg-(--color-surface-muted) border border-(--color-border)"
      >fanari-b6bb4</code
    >.
  </p>

  <div
    class="mt-10 p-5 border border-(--color-border) rounded-lg bg-(--color-surface) shadow-xs"
  >
    <div class="flex justify-between items-center">
      <span class="text-sm text-(--color-muted)">Environment</span>
      <span
        class="text-xs px-2 py-0.5 rounded-full border border-(--color-border) bg-(--color-surface-muted) font-mono text-(--color-text)"
        >{env}</span
      >
    </div>
    <div class="flex justify-between items-center mt-3">
      <span class="text-sm text-(--color-muted)">Firestore</span>
      {#if connected === "checking"}
        <span class="inline-flex items-center gap-1.5 text-sm text-(--color-generating)">
          <span class="w-1.5 h-1.5 rounded-full bg-(--color-generating) animate-pulse"></span>
          checking…
        </span>
      {:else if connected === "online"}
        <span class="inline-flex items-center gap-1.5 text-sm text-(--color-success)">
          <span class="w-1.5 h-1.5 rounded-full bg-(--color-success)"></span>
          online
        </span>
      {:else}
        <span class="inline-flex items-center gap-1.5 text-sm text-(--color-danger)">
          <span class="w-1.5 h-1.5 rounded-full bg-(--color-danger)"></span>
          offline
        </span>
      {/if}
    </div>
  </div>
</main>
