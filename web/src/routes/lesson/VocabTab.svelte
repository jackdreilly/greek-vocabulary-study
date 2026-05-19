<script lang="ts">
  import { createVocabBatch } from "../../lib/data/createVocabBatch";
  import { aiAssistVocabEntry } from "../../lib/data/vocabAssist";
  import { subscribeEntries, subscribeLatestVocabBatches, entryPrimaryEnglish, entryAdditionalSenses } from "../../lib/data/lessons.svelte";
  import type { EntryDoc } from "../../lib/data/lessons.svelte";
  import {
    imageFromPexels,
    saveEntryEdit,
    searchPexelsImages,
    uploadAudio,
    deleteAudio,
  } from "../../lib/data/entryEdits";
  import { retryVocabBatchGeneration } from "../../lib/data/retryGeneration";
  import type { PexelsPhoto } from "../../lib/data/entryEdits";
  import { textMatchesSearch } from "../../lib/search";
  import GreekText from "../../lib/ui/GreekText.svelte";
  import AudioPlayButton from "../../lib/ui/AudioPlayButton.svelte";
  import { clearFocus, setFocus } from "../../lib/data/yiayiaFocus.svelte";
  import { Edit2, Loader2, Mic, MicOff, Plus, RefreshCw, Search, Sparkles, Trash2, Upload, Wand2, X } from "lucide-svelte";

  type EntriesSub = ReturnType<typeof subscribeEntries>;
  type VocabBatchSub = ReturnType<typeof subscribeLatestVocabBatches>;

  let {
    courseId,
    lessonId,
    entriesSub: providedEntriesSub,
    vocabBatchSub: providedVocabBatchSub,
  }: {
    courseId: string;
    lessonId: string;
    entriesSub?: EntriesSub;
    vocabBatchSub?: VocabBatchSub;
  } = $props();

  let sub = $state<EntriesSub>();
  let batchSub = $state<VocabBatchSub>();

  $effect(() => {
    if (providedEntriesSub && providedVocabBatchSub) {
      sub = providedEntriesSub;
      batchSub = providedVocabBatchSub;
      return () => clearFocus();
    }

    const next = subscribeEntries(courseId, lessonId);
    const nextBatch = subscribeLatestVocabBatches(courseId, lessonId);
    sub = next;
    batchSub = nextBatch;
    return () => {
      next.stop();
      nextBatch.stop();
      clearFocus();
    };
  });

  let search = $state("");
  let editing = $state<EntryDoc | null>(null);
  let draftLemma = $state("");
  let draftEnglish = $state("");
  let draftSenses = $state<string[]>([]);
  let draftImage = $state<EntryDoc["image"]>(null);
  let saving = $state(false);
  let saveError = $state<string | null>(null);
  let saved = $state(false);
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let pexelsOpen = $state(false);
  let pexelsQuery = $state("");
  let pexelsResults = $state<PexelsPhoto[]>([]);
  let pexelsLoading = $state(false);
  let pexelsError = $state<string | null>(null);
  let vocabPrompt = $state("");
  let generatingVocab = $state(false);
  let vocabError = $state<string | null>(null);
  let assistPrompt = $state("Improve this word and its definitions for a learner.");
  let assisting = $state(false);
  let assistError = $state<string | null>(null);
  let selectedEntryId = $state("");

  // Audio state
  let draftAudio = $state<EntryDoc["audio"]>(null);
  let audioCaptureState = $state<"idle" | "initializing" | "recording" | "stopping" | "uploading">("idle");
  let audioError = $state<string | null>(null);
  let audioRecordSeconds = $state(0);
  let mediaRecorder = $state<MediaRecorder | null>(null);
  let recordTimer: ReturnType<typeof setInterval> | null = null;

  const filtered = $derived(
    search.trim() === ""
      ? (sub?.entries ?? [])
      : (sub?.entries ?? []).filter((e) => {
          const haystack = [e.lemma, e.article, e.partOfSpeech, e.english, ...(e.senses ?? [])].join(" ");
          return textMatchesSearch(haystack, search);
        })
  );
  const latestBatch = $derived(batchSub?.latest ?? null);
  const batchRunning = $derived(latestBatch?.status === "initializing" || latestBatch?.status === "streaming");
  const batchMessages = $derived((latestBatch?.statusLog ?? []).slice(-4));
  const audioInitializing = $derived(audioCaptureState === "initializing");
  const audioRecording = $derived(audioCaptureState === "recording");
  const audioStopping = $derived(audioCaptureState === "stopping");
  const audioUploading = $derived(audioCaptureState === "uploading");
  const audioBusy = $derived(audioCaptureState !== "idle");

  $effect(() => {
    if (!selectedEntryId) return;
    const selected = filtered.find((entry) => entry.id === selectedEntryId);
    if (!selected) {
      selectedEntryId = "";
      clearFocus();
      return;
    }
    publishEntryFocus(selected);
  });

  function publishEntryFocus(entry: EntryDoc) {
    const senses = entry.senses?.length ? entry.senses : [entryPrimaryEnglish(entry)];
    setFocus({
      kind: "vocab",
      label: `Vocab: ${entry.lemma}`,
      courseId,
      lessonId,
      tab: "vocab",
      entryId: entry.id,
      words: [entry.lemma],
      title: [entry.article, entry.lemma].filter(Boolean).join(" "),
      summary: senses.filter(Boolean).join("; "),
      index: filtered.findIndex((item) => item.id === entry.id) + 1,
      total: filtered.length,
    });
  }

  function selectEntry(entry: EntryDoc) {
    selectedEntryId = entry.id;
  }

  function openEdit(entry: EntryDoc) {
    editing = entry;
    draftLemma = entry.lemma ?? "";
    draftEnglish = entryPrimaryEnglish(entry);
    draftSenses = entry.senses?.length ? [...entry.senses] : [entryPrimaryEnglish(entry)];
    draftImage = entry.image ?? null;
    draftAudio = entry.audio ?? null;
    saveError = null;
    pexelsOpen = false;
    pexelsResults = [];
    pexelsError = null;
    assistPrompt = "Improve this word and its definitions for a learner.";
    assistError = null;
    audioError = null;
  }

  function closeEdit() {
    if (saveTimer) clearTimeout(saveTimer);
    stopRecording();
    editing = null;
  }

  async function saveEdit() {
    if (!editing) return;
    if (!draftLemma.trim()) {
      saved = false;
      saveError = "Greek word is required.";
      return;
    }
    saving = true;
    saved = false;
    saveError = null;
    try {
      await saveEntryEdit({
        courseId,
        lessonId,
        entryId: editing.id,
        lemma: draftLemma,
        english: draftEnglish,
        senses: draftSenses,
        image: draftImage,
        audio: draftAudio,
      });
      saved = true;
    } catch (err) {
      saveError = err instanceof Error ? err.message : String(err);
    } finally {
      saving = false;
    }
  }

  function scheduleSave(delay = 500) {
    saved = false;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveEdit();
      saveTimer = null;
    }, delay);
  }

  async function searchImages() {
    if (!pexelsQuery.trim()) return;
    pexelsLoading = true;
    pexelsError = null;
    pexelsResults = [];
    try {
      pexelsResults = await searchPexelsImages(pexelsQuery);
    } catch (err) {
      pexelsError = err instanceof Error ? err.message : String(err);
    } finally {
      pexelsLoading = false;
    }
  }

  function openPexels() {
    pexelsQuery = draftEnglish.split(/[;,]/)[0]?.replace(/\(.*?\)/g, "").trim() || draftLemma || editing?.lemma || "";
    pexelsOpen = true;
    searchImages();
  }

  async function generateVocab() {
    generatingVocab = true;
    vocabError = null;
    try {
      await createVocabBatch({
        courseId,
        lessonId,
        prompt: vocabPrompt,
        count: 20,
      });
      vocabPrompt = "";
    } catch (err) {
      vocabError = err instanceof Error ? err.message : String(err);
    } finally {
      generatingVocab = false;
    }
  }

  async function startRecording() {
    if (audioBusy || !editing) return;
    audioError = null;
    audioCaptureState = "initializing";
    audioRecordSeconds = 0;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!editing || audioCaptureState !== "initializing") {
        stream.getTracks().forEach((t) => t.stop());
        audioCaptureState = "idle";
        return;
      }
      const chunks: BlobPart[] = [];
      const mimeType = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/ogg";
      const recorder = new MediaRecorder(stream, { mimeType });
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstart = () => {
        audioCaptureState = "recording";
        audioRecordSeconds = 0;
        recordTimer = setInterval(() => { audioRecordSeconds += 1; }, 1000);
      };
      recorder.onstop = async () => {
        if (recordTimer) { clearInterval(recordTimer); recordTimer = null; }
        stream.getTracks().forEach((t) => t.stop());
        if (!editing) {
          audioCaptureState = "idle";
          return;
        }
        audioCaptureState = "uploading";
        try {
          const blob = new Blob(chunks, { type: mimeType });
          draftAudio = await uploadAudio(courseId, lessonId, editing.id, blob);
          await saveEdit();
        } catch (err) {
          audioError = err instanceof Error ? err.message : String(err);
        } finally {
          audioCaptureState = "idle";
        }
      };
      recorder.onerror = (event) => {
        audioError = event.error?.message ?? "Recording failed.";
        audioCaptureState = "idle";
        stream.getTracks().forEach((t) => t.stop());
      };
      mediaRecorder = recorder;
      recorder.start();
    } catch (err) {
      audioError = err instanceof Error ? err.message : String(err);
      audioCaptureState = "idle";
    }
  }

  function stopRecording() {
    if (recordTimer) { clearInterval(recordTimer); recordTimer = null; }
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      audioCaptureState = "stopping";
      mediaRecorder.stop();
    } else {
      audioCaptureState = "idle";
    }
    mediaRecorder = null;
  }

  async function handleAudioFileUpload(files: FileList | null) {
    if (!files || files.length === 0 || !editing) return;
    const file = files[0];
    audioError = null;
    audioCaptureState = "uploading";
    try {
      draftAudio = await uploadAudio(courseId, lessonId, editing.id, file);
      await saveEdit();
    } catch (err) {
      audioError = err instanceof Error ? err.message : String(err);
    } finally {
      audioCaptureState = "idle";
    }
  }

  async function removeAudio() {
    if (!draftAudio) return;
    const old = draftAudio;
    draftAudio = null;
    scheduleSave(0);
    try {
      await deleteAudio(old.storagePath);
    } catch {
      // Ignore storage delete failures — Firestore is already updated
    }
  }

  async function assistDefinitions() {
    if (!editing || assisting) return;
    assisting = true;
    assistError = null;
    try {
      const result = await aiAssistVocabEntry({
        entry: editing,
        prompt: assistPrompt,
        currentLemma: draftLemma,
        currentSenses: draftSenses.filter((sense) => sense.trim()),
      });
      draftLemma = result.lemma;
      draftSenses = result.englishSenses.length ? result.englishSenses : draftSenses;
      draftEnglish = draftSenses[0] ?? draftEnglish;
      scheduleSave(0);
    } catch (err) {
      assistError = err instanceof Error ? err.message : String(err);
    } finally {
      assisting = false;
    }
  }
</script>

<div>
  <div class="mb-6 space-y-3">
    <div class="flex flex-col gap-2 sm:flex-row">
      <div class="relative min-w-0 flex-1">
        <Search
          size={16}
          aria-hidden="true"
          class="absolute left-3 top-1/2 -translate-y-1/2 text-(--color-muted) pointer-events-none"
        />
        <input
          type="search"
          placeholder="Search vocabulary..."
          bind:value={search}
          class="w-full pl-9 pr-3 py-2 text-sm border border-(--color-border) rounded-md bg-(--color-surface) focus:outline-none focus:border-(--color-accent) focus:ring-1 focus:ring-(--color-accent)"
        />
      </div>
    </div>
    <form
      class="rounded-lg border border-(--color-border) bg-(--color-surface) p-3"
      onsubmit={(event) => {
        event.preventDefault();
        void generateVocab();
      }}
    >
      <div class="flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          bind:value={vocabPrompt}
          placeholder="Generate more vocab: cafe ordering, prices, polite phrases..."
          class="min-w-0 flex-1 rounded-md border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm focus:outline-none focus:border-(--color-accent) focus:ring-1 focus:ring-(--color-accent)"
        />
        <button
          type="submit"
          disabled={generatingVocab || vocabPrompt.trim().length === 0}
          class="inline-flex items-center justify-center gap-1.5 rounded-md bg-(--color-accent) px-4 py-2 text-sm font-medium text-white hover:bg-(--color-accent-hover) disabled:opacity-50"
        >
          <Sparkles size={14} aria-hidden="true" />
          {generatingVocab ? "Generating..." : "Generate vocab"}
        </button>
      </div>
      {#if vocabError}
        <p class="mt-2 text-sm text-(--color-danger)">{vocabError}</p>
      {/if}
      {#if latestBatch}
        <div
          class="mt-3 rounded-md border px-3 py-2 text-sm {latestBatch.status === 'error'
            ? 'border-[#fecaca] bg-[#fef2f2] text-(--color-danger)'
            : batchRunning
              ? 'border-[#bfdbfe] bg-[#eff6ff] text-[#1d4ed8]'
              : 'border-[#bbf7d0] bg-[#f0fdf4] text-[#15803d]'}"
        >
          <div class="flex items-center justify-between gap-3">
            <span class="font-medium">
              {latestBatch.status === "error"
                ? "Vocabulary generation failed"
                : batchRunning
                  ? "Vocabulary generation running"
                  : "Vocabulary generation complete"}
            </span>
            <span class="text-xs uppercase tracking-wide opacity-75">{latestBatch.status}</span>
          </div>
          {#if latestBatch.error}
            <p class="mt-1">{latestBatch.error}</p>
          {:else if batchMessages.length}
            <ul class="mt-1 space-y-0.5">
              {#each batchMessages as item}
                <li>{item.message}</li>
              {/each}
            </ul>
          {/if}
          {#if latestBatch.status === "error"}
            <button
              type="button"
              onclick={() => void retryVocabBatchGeneration(courseId, lessonId, latestBatch.id)}
              class="mt-2 inline-flex items-center gap-1.5 rounded-md border border-current px-2 py-1 text-xs font-medium"
            >
              <RefreshCw size={12} aria-hidden="true" />
              Try again
            </button>
          {/if}
        </div>
      {/if}
    </form>
  </div>

  {#if !sub || sub.loading}
    <p class="text-(--color-muted)">Loading entries…</p>
  {:else if filtered.length === 0}
    <p class="text-(--color-muted)">No entries.</p>
  {:else}
    <ul class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {#each filtered as entry (entry.id)}
        <li
          class="min-h-32 rounded-lg border px-4 py-3 flex flex-col gap-3 transition-colors
            {selectedEntryId === entry.id
              ? 'border-(--color-accent)/70 bg-(--color-accent)/4 ring-1 ring-(--color-accent)/15'
              : 'border-(--color-border) bg-(--color-surface) hover:border-(--color-border-strong)'}"
        >
          <div class="flex items-start justify-between gap-3">
            <button
              type="button"
              aria-pressed={selectedEntryId === entry.id}
              onclick={() => selectEntry(entry)}
              class="flex min-w-0 flex-1 cursor-pointer items-baseline gap-2 rounded-sm text-left focus:outline-none"
            >
              {#if entry.article}
                <span class="text-(--color-muted) text-sm shrink-0">{entry.article}</span>
              {/if}
              <GreekText>{entry.lemma}</GreekText>
            </button>
            <div class="flex shrink-0 items-center gap-1.5">
              {#if entry.audio?.url}
                <AudioPlayButton
                  url={entry.audio.url}
                  label=""
                  iconSize={14}
                  class="shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-full text-(--color-muted) hover:bg-(--color-surface-muted) hover:text-(--color-accent) disabled:opacity-70"
                />
              {/if}
              <button
                type="button"
                onclick={() => openEdit(entry)}
                class="inline-flex items-center gap-1 text-xs text-(--color-muted) hover:text-(--color-text)"
                title="Edit"
              >
                <Edit2 size={12} aria-hidden="true" />
                Edit
              </button>
            </div>
          </div>
          <button
            type="button"
            aria-pressed={selectedEntryId === entry.id}
            onclick={() => selectEntry(entry)}
            class="block w-full cursor-pointer rounded-sm text-left focus:outline-none"
          >
            {#if entry.image}
              <img
                src={entry.image.thumbnail ?? entry.image.url}
                alt=""
                class="mb-3 aspect-video w-full rounded-md border border-(--color-border) object-cover"
                style="object-position: {entry.image.position ?? 'center'}"
              />
            {/if}
            <span class="block text-(--color-text) min-w-0">
              <span class="block leading-snug">{entryPrimaryEnglish(entry)}</span>
              {#if entryAdditionalSenses(entry).length > 0}
                <span class="mt-1 block text-xs text-(--color-muted) line-clamp-2">
                  {entryAdditionalSenses(entry).join("; ")}
                </span>
              {/if}
            </span>
          </button>
        </li>
      {/each}
    </ul>
    <p class="text-xs text-(--color-muted) mt-3">
      {filtered.length}
      {filtered.length === 1 ? "word" : "words"}
    </p>
  {/if}

  {#if editing}
    <div class="fixed inset-0 z-50 grid place-items-center bg-black/35 p-4">
      <section class="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-lg bg-(--color-bg) shadow-xl border border-(--color-border)">
        <header class="flex items-start justify-between gap-4 border-b border-(--color-border) px-5 py-4">
          <div>
            <h2 class="text-lg font-semibold tracking-tight">Edit vocabulary</h2>
            <div class="mt-1 flex items-baseline gap-2">
              {#if editing.article}
                <span class="text-sm text-(--color-muted)">{editing.article}</span>
              {/if}
              <GreekText>{draftLemma || editing.lemma}</GreekText>
            </div>
            <p class="mt-1 text-xs text-(--color-muted)">
              {saving ? "Saving..." : saved ? "Saved" : "Changes save automatically"}
            </p>
          </div>
          <button
            type="button"
            onclick={closeEdit}
            class="inline-flex items-center gap-1 text-sm text-(--color-muted) hover:text-(--color-text)"
            title="Close"
          >
            <X size={14} aria-hidden="true" />
            Close
          </button>
        </header>

        <div class="space-y-5 px-5 py-4">
          <label class="block">
            <span class="mb-1 block text-sm font-medium">Greek word</span>
            <input
              type="text"
              value={draftLemma}
              oninput={(e) => {
                draftLemma = (e.target as HTMLInputElement).value;
                scheduleSave();
              }}
              class="w-full rounded-md border border-(--color-border) bg-(--color-surface) px-3 py-2 font-serif text-lg"
            />
          </label>

          <label class="block">
            <span class="mb-1 block text-sm font-medium">Primary English</span>
            <input
              type="text"
              value={draftEnglish}
              oninput={(e) => {
                draftEnglish = (e.target as HTMLInputElement).value;
                scheduleSave();
              }}
              class="w-full rounded-md border border-(--color-border) bg-(--color-surface) px-3 py-2"
            />
          </label>

          <div>
            <div class="mb-2 flex items-center justify-between">
              <span class="text-sm font-medium">Meanings</span>
              <button
                type="button"
                onclick={() => {
                  draftSenses = [...draftSenses, ""];
                  scheduleSave();
                }}
                class="inline-flex items-center gap-1 text-sm text-(--color-accent) hover:text-(--color-accent-hover)"
              >
                <Plus size={14} aria-hidden="true" />
                Add
              </button>
            </div>
            <div class="space-y-2">
              {#each draftSenses as sense, i}
                <div class="flex gap-2">
                  <input
                    type="text"
                    value={sense}
                    oninput={(e) =>
                      {
                        draftSenses = draftSenses.map((s, idx) =>
                          idx === i ? (e.target as HTMLInputElement).value : s
                        );
                        scheduleSave();
                      }}
                    class="min-w-0 flex-1 rounded-md border border-(--color-border) bg-(--color-surface) px-3 py-2"
                  />
                  <button
                    type="button"
                    onclick={() => {
                      draftSenses = draftSenses.filter((_, idx) => idx !== i);
                      scheduleSave();
                    }}
                    class="rounded-md border border-(--color-border) px-3 text-sm text-(--color-muted) hover:text-(--color-danger)"
                  >
                    Remove
                  </button>
                </div>
              {/each}
            </div>
          </div>

          <div class="rounded-md border border-(--color-border) bg-(--color-surface-muted) p-3">
            <label class="block">
              <span class="mb-1 block text-sm font-medium">AI word assist</span>
              <input
                type="text"
                bind:value={assistPrompt}
                class="w-full rounded-md border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm"
              />
            </label>
            <button
              type="button"
              onclick={() => void assistDefinitions()}
              disabled={assisting || !assistPrompt.trim()}
              class="mt-2 inline-flex items-center gap-1.5 rounded-md bg-(--color-accent) px-3 py-2 text-sm font-medium text-white hover:bg-(--color-accent-hover) disabled:opacity-50"
            >
              <Wand2 size={14} aria-hidden="true" />
              {assisting ? "Asking AI..." : "Update word and meanings"}
            </button>
            {#if assistError}
              <p class="mt-2 text-sm text-(--color-danger)">{assistError}</p>
            {/if}
          </div>

          <div>
            <p class="mb-2 text-sm font-medium">Image</p>
            {#if draftImage}
              <div class="flex items-center gap-3">
                <img
                  src={draftImage.thumbnail ?? draftImage.url}
                  alt=""
                  class="h-20 w-28 rounded-md border border-(--color-border) object-cover"
                  style="object-position: {draftImage.position ?? 'center'}"
                />
                <div class="flex gap-2">
                  <button
                    type="button"
                    onclick={openPexels}
                    class="rounded-md border border-(--color-border) px-3 py-2 text-sm hover:bg-(--color-surface-muted)"
                  >
                    Replace
                  </button>
                  <button
                    type="button"
                    onclick={() => {
                      draftImage = null;
                      scheduleSave(0);
                    }}
                    class="inline-flex items-center gap-1.5 rounded-md border border-(--color-border) px-3 py-2 text-sm text-(--color-danger)"
                  >
                    <Trash2 size={14} aria-hidden="true" />
                    Remove
                  </button>
                </div>
              </div>
            {:else}
              <button
                type="button"
                onclick={openPexels}
                class="rounded-md border border-(--color-border) px-3 py-2 text-sm hover:bg-(--color-surface-muted)"
              >
                Add image from Pexels
              </button>
            {/if}

            {#if pexelsOpen}
              <div class="mt-3 rounded-md border border-(--color-border) bg-(--color-surface-muted) p-3">
                <div class="flex gap-2">
                  <input
                    type="text"
                    bind:value={pexelsQuery}
                    class="min-w-0 flex-1 rounded-md border border-(--color-border) bg-(--color-surface) px-3 py-2"
                    placeholder="Search Pexels"
                  />
                  <button
                    type="button"
                    onclick={searchImages}
                    disabled={pexelsLoading || !pexelsQuery.trim()}
                    class="rounded-md bg-(--color-accent) px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {pexelsLoading ? "Searching" : "Search"}
                  </button>
                </div>
                {#if pexelsError}
                  <p class="mt-2 text-sm text-(--color-danger)">{pexelsError}</p>
                {/if}
                {#if pexelsResults.length}
                  <div class="mt-3 grid grid-cols-3 gap-2">
                    {#each pexelsResults as photo}
                      <button
                        type="button"
                        onclick={() => {
                          draftImage = imageFromPexels(photo);
                          pexelsOpen = false;
                          scheduleSave(0);
                        }}
                        class="overflow-hidden rounded-md border-2 border-transparent hover:border-(--color-accent)"
                        title={photo.photographer}
                      >
                        <img
                          src={photo.src.small ?? photo.src.medium}
                          alt={photo.alt ?? photo.photographer ?? ""}
                          class="h-20 w-full object-cover"
                        />
                      </button>
                    {/each}
                  </div>
                  <p class="mt-2 text-right text-xs text-(--color-muted)">
                    Photos from <a href="https://www.pexels.com" target="_blank" rel="noreferrer" class="text-(--color-accent)">Pexels</a>
                  </p>
                {/if}
              </div>
            {/if}
          </div>

          <div>
            <p class="mb-2 text-sm font-medium">Pronunciation audio</p>
            {#if audioInitializing}
              <div class="flex items-center gap-2 text-sm text-(--color-muted)">
                <Loader2 size={14} aria-hidden="true" class="animate-spin" />
                Initializing microphone...
              </div>
            {:else if audioRecording || audioStopping}
              <div class="flex items-center gap-3">
                <span class="inline-flex items-center gap-2 text-sm text-(--color-danger) font-medium">
                  <span class="h-2 w-2 rounded-full bg-(--color-danger) animate-pulse"></span>
                  {audioStopping ? "Stopping recording..." : `Recording... ${audioRecordSeconds}s`}
                </span>
                <button
                  type="button"
                  onclick={stopRecording}
                  disabled={audioStopping}
                  class="inline-flex items-center gap-1.5 rounded-md border border-(--color-border) px-3 py-2 text-sm hover:bg-(--color-surface-muted) disabled:opacity-50"
                >
                  <MicOff size={14} aria-hidden="true" />
                  Stop
                </button>
              </div>
            {:else if audioUploading}
              <div class="flex items-center gap-2 text-sm text-(--color-muted)">
                <Loader2 size={14} aria-hidden="true" class="animate-spin" />
                Uploading audio...
              </div>
            {:else if draftAudio}
              <div class="flex items-center gap-3 flex-wrap">
                <AudioPlayButton
                  url={draftAudio.url}
                  class="inline-flex items-center gap-1.5 rounded-md border border-(--color-border) px-3 py-2 text-sm hover:bg-(--color-surface-muted) disabled:opacity-70"
                />
                <button
                  type="button"
                  onclick={() => void startRecording()}
                  disabled={audioBusy}
                  class="inline-flex items-center gap-1.5 rounded-md border border-(--color-border) px-3 py-2 text-sm hover:bg-(--color-surface-muted) disabled:opacity-50"
                >
                  <Mic size={14} aria-hidden="true" />
                  Re-record
                </button>
                <label class="inline-flex items-center gap-1.5 cursor-pointer rounded-md border border-(--color-border) px-3 py-2 text-sm hover:bg-(--color-surface-muted)">
                  <Upload size={14} aria-hidden="true" />
                  Replace file
                  <input
                    type="file"
                    accept="audio/*"
                    class="sr-only"
                    onchange={(e) => void handleAudioFileUpload((e.target as HTMLInputElement).files)}
                  />
                </label>
                <button
                  type="button"
                  onclick={() => void removeAudio()}
                  class="inline-flex items-center gap-1.5 rounded-md border border-(--color-border) px-3 py-2 text-sm text-(--color-danger)"
                >
                  <Trash2 size={14} aria-hidden="true" />
                  Remove
                </button>
              </div>
            {:else}
              <div class="flex gap-2 flex-wrap">
                <button
                  type="button"
                  onclick={() => void startRecording()}
                  class="inline-flex items-center gap-1.5 rounded-md border border-(--color-border) px-3 py-2 text-sm hover:bg-(--color-surface-muted)"
                >
                  <Mic size={14} aria-hidden="true" />
                  Record pronunciation
                </button>
                <label class="inline-flex items-center gap-1.5 cursor-pointer rounded-md border border-(--color-border) px-3 py-2 text-sm hover:bg-(--color-surface-muted)">
                  <Upload size={14} aria-hidden="true" />
                  Upload audio file
                  <input
                    type="file"
                    accept="audio/*"
                    class="sr-only"
                    onchange={(e) => void handleAudioFileUpload((e.target as HTMLInputElement).files)}
                  />
                </label>
              </div>
            {/if}
            {#if audioError}
              <p class="mt-2 text-sm text-(--color-danger)">{audioError}</p>
            {/if}
          </div>

          {#if saveError}
            <p class="rounded-md border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-sm text-(--color-danger)">
              {saveError}
            </p>
          {/if}
        </div>

        <footer class="flex justify-end gap-2 border-t border-(--color-border) px-5 py-4">
          <button
            type="button"
            onclick={closeEdit}
            class="rounded-md border border-(--color-border) px-4 py-2 text-sm hover:bg-(--color-surface-muted)"
          >
            Done
          </button>
        </footer>
      </section>
    </div>
  {/if}
</div>
