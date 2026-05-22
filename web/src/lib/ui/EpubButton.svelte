<script lang="ts">
  import { Download, Loader2 } from "lucide-svelte";
  import {
    createBookExportJob,
    subscribeBookExportJob,
    downloadFile,
    type BookExportScope,
  } from "../data/bookExport";

  let { scope }: { scope: BookExportScope } = $props();

  let pending = $state(false);
  let error = $state("");

  async function run() {
    if (pending) return;
    pending = true;
    error = "";
    try {
      const jobId = await createBookExportJob(scope);
      const unsubscribe = subscribeBookExportJob(jobId, (job) => {
        if (!job) return;
        if (job.status === "completed") {
          pending = false;
          unsubscribe();
          if (job.downloadUrl) downloadFile(job.downloadUrl, job.fileName || "greekflash.epub");
        } else if (job.status === "failed") {
          pending = false;
          error = job.error || "Export failed.";
          unsubscribe();
        }
      });
    } catch (err) {
      pending = false;
      error = err instanceof Error ? err.message : "Could not start export.";
    }
  }
</script>

<button
  type="button"
  onclick={run}
  disabled={pending}
  title={error || "Download as EPUB (e-reader / Kindle)"}
  class="inline-flex items-center gap-1 text-xs text-(--color-muted) hover:text-(--color-text) disabled:opacity-60 transition-colors"
>
  {#if pending}
    <Loader2 size={13} class="animate-spin" aria-hidden="true" />
    <span>Building…</span>
  {:else}
    <Download size={13} aria-hidden="true" />
    <span>EPUB</span>
  {/if}
</button>
{#if error}
  <span class="ml-1 text-xs text-(--color-danger)">{error}</span>
{/if}
