<script lang="ts">
  import { subscribeEntries } from "../../lib/data/lessons.svelte";
  import type { EntryDoc } from "../../lib/data/lessons.svelte";
  import {
    imageFromPexels,
    saveEntryEdit,
    searchPexelsImages,
  } from "../../lib/data/entryEdits";
  import type { PexelsPhoto } from "../../lib/data/entryEdits";
  import GreekText from "../../lib/ui/GreekText.svelte";

  let { courseId, lessonId }: { courseId: string; lessonId: string } = $props();

  let sub = $state<ReturnType<typeof subscribeEntries>>();

  $effect(() => {
    const next = subscribeEntries(courseId, lessonId);
    sub = next;
    return () => next.stop();
  });

  let search = $state("");
  let editing = $state<EntryDoc | null>(null);
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

  const filtered = $derived(
    search.trim() === ""
      ? (sub?.entries ?? [])
      : (sub?.entries ?? []).filter((e) => {
          const q = search.trim().toLowerCase();
          return (
            e.lemma?.toLowerCase().includes(q) ||
            e.english?.toLowerCase().includes(q) ||
            e.senses?.some((s: string) => s.toLowerCase().includes(q))
          );
        })
  );

  function openEdit(entry: EntryDoc) {
    editing = entry;
    draftEnglish = entry.english ?? "";
    draftSenses = entry.senses?.length ? [...entry.senses] : [entry.english ?? ""];
    draftImage = entry.image ?? null;
    saveError = null;
    pexelsOpen = false;
    pexelsResults = [];
    pexelsError = null;
  }

  function closeEdit() {
    if (saveTimer) clearTimeout(saveTimer);
    editing = null;
  }

  async function saveEdit() {
    if (!editing) return;
    saving = true;
    saved = false;
    saveError = null;
    try {
      await saveEntryEdit({
        courseId,
        lessonId,
        entryId: editing.id,
        english: draftEnglish,
        senses: draftSenses,
        image: draftImage,
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
    pexelsQuery = draftEnglish.split(/[;,]/)[0]?.replace(/\(.*?\)/g, "").trim() || editing?.lemma || "";
    pexelsOpen = true;
    searchImages();
  }
</script>

<div>
  <input
    type="search"
    placeholder="Search vocabulary…"
    bind:value={search}
    class="w-full max-w-sm px-3 py-2 text-sm border border-(--color-border) rounded-md bg-(--color-surface) focus:outline-none focus:border-(--color-accent) focus:ring-1 focus:ring-(--color-accent) mb-6"
  />

  {#if !sub || sub.loading}
    <p class="text-(--color-muted)">Loading entries…</p>
  {:else if filtered.length === 0}
    <p class="text-(--color-muted)">No entries.</p>
  {:else}
    <ul class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {#each filtered as entry (entry.id)}
        <li
          class="min-h-32 border border-(--color-border) rounded-lg bg-(--color-surface) px-4 py-3 flex flex-col gap-3"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="flex items-baseline gap-2 min-w-0">
              {#if entry.article}
                <span class="text-(--color-muted) text-sm shrink-0">{entry.article}</span>
              {/if}
              <GreekText>{entry.lemma}</GreekText>
            </div>
            <button
              type="button"
              onclick={() => openEdit(entry)}
              class="text-xs text-(--color-muted) hover:text-(--color-text)"
            >
              Edit
            </button>
          </div>
          {#if entry.image}
            <img
              src={entry.image.thumbnail ?? entry.image.url}
              alt=""
              class="aspect-video w-full rounded-md border border-(--color-border) object-cover"
              style="object-position: {entry.image.position ?? 'center'}"
            />
          {/if}
          <div class="text-(--color-text) min-w-0">
            <div class="leading-snug">{entry.english}</div>
            {#if entry.senses && entry.senses.length > 1}
              <div class="text-xs text-(--color-muted) mt-1 line-clamp-2">
                {entry.senses.slice(1).join("; ")}
              </div>
            {/if}
          </div>
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
              <GreekText>{editing.lemma}</GreekText>
            </div>
            <p class="mt-1 text-xs text-(--color-muted)">
              {saving ? "Saving..." : saved ? "Saved" : "Changes save automatically"}
            </p>
          </div>
          <button type="button" onclick={closeEdit} class="text-sm text-(--color-muted) hover:text-(--color-text)">
            Close
          </button>
        </header>

        <div class="space-y-5 px-5 py-4">
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
                class="text-sm text-(--color-accent) hover:text-(--color-accent-hover)"
              >
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
                    class="rounded-md border border-(--color-border) px-3 py-2 text-sm text-(--color-danger)"
                  >
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
