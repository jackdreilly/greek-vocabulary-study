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

<main class="max-w-2xl mx-auto pt-24 px-8">
  <p class="text-xs tracking-widest uppercase text-(--color-muted) mb-3">Greekflash</p>
  <h1 class="font-serif text-5xl leading-tight font-medium tracking-tight m-0">
    The rewrite is alive.
  </h1>
  <p class="text-(--color-muted) mt-3">
    Scaffolding ready. Backend: <code>fanari-b6bb4</code>.
  </p>

  <div class="mt-10 p-6 border border-(--color-border) rounded-lg bg-(--color-surface)">
    <div class="flex justify-between items-baseline">
      <span class="text-sm text-(--color-muted)">Environment</span>
      <span class="font-mono text-sm">{env}</span>
    </div>
    <div class="flex justify-between items-baseline mt-2">
      <span class="text-sm text-(--color-muted)">Firestore</span>
      <span class="font-mono text-sm">
        {#if connected === "checking"}
          <span class="text-(--color-generating)">checking…</span>
        {:else if connected === "online"}
          <span class="text-(--color-greek)">online</span>
        {:else}
          <span class="text-(--color-danger)">offline</span>
        {/if}
      </span>
    </div>
  </div>
</main>
