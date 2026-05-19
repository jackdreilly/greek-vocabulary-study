<script lang="ts">
  import { onDestroy } from "svelte";
  import {
    MODEL_OPTIONS,
    SURFACES,
    SURFACE_COPY,
    FEATURE_COPY,
  } from "../lib/aiConfig";
  import type { AIConfig, Decoding, Surface } from "../lib/aiConfig";
  import {
    resetAIConfig,
    saveAIConfig,
    subscribeAIConfig,
  } from "../lib/data/aiConfig.svelte";

  const sub = subscribeAIConfig();
  onDestroy(() => sub.stop());

  let draft = $state<AIConfig>($state.snapshot(sub.config));
  let dirty = $state(false);
  let saving = $state(false);
  let saved = $state(false);
  let saveError = $state<string | null>(null);
  let expanded = $state<Record<string, boolean>>({});

  $effect(() => {
    if (!dirty) draft = $state.snapshot(sub.config);
  });

  const current = $derived(draft);
  const featureKeys = $derived(Object.keys(current.features));

  function markDirty() {
    dirty = true;
    saved = false;
    saveError = null;
  }

  function updateModel(surface: Surface, model: string) {
    if (!draft) return;
    draft.models[surface] = { ...draft.models[surface], model };
    markDirty();
  }

  function updateCustomModel(surface: Surface, model: string) {
    if (!draft) return;
    draft.models[surface] = { ...draft.models[surface], model: model.trim() };
    markDirty();
  }

  function updateDecoding(surface: Surface, key: keyof Decoding, value: string) {
    if (!draft) return;
    const next = { ...(draft.decoding[surface] ?? {}) };
    if (value.trim() === "") {
      delete next[key];
    } else {
      next[key] = key === "maxOutputTokens" || key === "topK" ? Number.parseInt(value, 10) : Number(value);
    }
    draft.decoding = { ...draft.decoding, [surface]: next };
    markDirty();
  }

  function updateFeature(key: string, value: boolean) {
    draft.features = { ...draft.features, [key]: value };
    markDirty();
  }

  function formatUpdatedAt(value: unknown) {
    if (!value) return "Never";
    if (value instanceof Date) return value.toLocaleString();
    if (typeof value === "object" && value && "toDate" in value) {
      return (value as { toDate: () => Date }).toDate().toLocaleString();
    }
    return String(value);
  }

  async function save() {
    if (!draft) return;
    saving = true;
    saveError = null;
    try {
      await saveAIConfig(draft);
      dirty = false;
      saved = true;
    } catch (err) {
      saveError = err instanceof Error ? err.message : String(err);
    } finally {
      saving = false;
    }
  }

  async function reset() {
    saving = true;
    saveError = null;
    try {
      await resetAIConfig();
      dirty = false;
      saved = true;
    } catch (err) {
      saveError = err instanceof Error ? err.message : String(err);
    } finally {
      saving = false;
    }
  }
</script>

<div class="max-w-4xl mx-auto pt-12 pb-24 px-6">
  <header class="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
    <div>
      <p class="text-xs tracking-widest uppercase text-(--color-muted) mb-2 font-semibold">Admin</p>
      <h1 class="text-3xl font-semibold tracking-tight">AI Configuration</h1>
      <p class="mt-2 text-sm text-(--color-muted)">
        Last updated: {formatUpdatedAt(current.updatedAt)} by {current.updatedBy ?? "unknown"}
      </p>
    </div>
    <div class="flex items-center gap-2">
      <button
        type="button"
        onclick={reset}
        disabled={saving}
        class="inline-flex items-center gap-2 rounded-md border border-(--color-border) px-3 py-2 text-sm text-(--color-text) hover:bg-(--color-surface-muted) disabled:opacity-50"
      >
        Reset
      </button>
      <button
        type="button"
        onclick={save}
        disabled={saving || !dirty}
        class="inline-flex items-center gap-2 rounded-md bg-(--color-accent) px-3 py-2 text-sm font-medium text-white hover:bg-(--color-accent-hover) disabled:opacity-50"
      >
        {#if saved && !dirty}
          Saved
        {:else}
          {saving ? "Saving" : "Save"}
        {/if}
      </button>
    </div>
  </header>

  {#if sub.loading}
    <p class="text-(--color-muted)">Loading config...</p>
  {:else if sub.error}
    <p class="text-(--color-danger)">Failed to load config: {sub.error.message}</p>
  {:else}
    {#if saveError}
      <p class="mb-4 rounded-md border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-sm text-(--color-danger)">
        {saveError}
      </p>
    {/if}

    <section class="grid grid-cols-1 lg:grid-cols-2 gap-3">
      {#each SURFACES as surface}
        {@const choice = current.models[surface]}
        {@const decoding = current.decoding[surface] ?? {}}
        {@const knownModel = MODEL_OPTIONS.includes(choice.model as (typeof MODEL_OPTIONS)[number])}
        <article class="rounded-lg border border-(--color-border) bg-(--color-surface) p-4">
          <div class="mb-4">
            <h2 class="text-base font-semibold tracking-tight">{surface}</h2>
            <p class="text-sm text-(--color-muted)">{SURFACE_COPY[surface]}</p>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label class="text-sm">
              <span class="block text-xs font-medium text-(--color-muted) mb-1">Provider</span>
              <select
                value={choice.provider}
                onchange={() => markDirty()}
                class="w-full rounded-md border border-(--color-border) bg-(--color-surface) px-3 py-2"
              >
                <option value="googleai">googleai</option>
              </select>
            </label>
            <label class="text-sm">
              <span class="block text-xs font-medium text-(--color-muted) mb-1">Model</span>
              <select
                value={knownModel ? choice.model : "custom"}
                onchange={(e) => {
                  const value = (e.target as HTMLSelectElement).value;
                  if (value !== "custom") updateModel(surface, value);
                }}
                class="w-full rounded-md border border-(--color-border) bg-(--color-surface) px-3 py-2"
              >
                {#each MODEL_OPTIONS as model}
                  <option value={model}>{model}</option>
                {/each}
                <option value="custom">Custom...</option>
              </select>
            </label>
          </div>

          {#if !knownModel}
            <label class="mt-3 block text-sm">
              <span class="block text-xs font-medium text-(--color-muted) mb-1">Custom model</span>
              <input
                type="text"
                value={choice.model}
                oninput={(e) => updateCustomModel(surface, (e.target as HTMLInputElement).value)}
                class="w-full rounded-md border border-(--color-border) bg-(--color-surface) px-3 py-2"
              />
            </label>
          {/if}

          <button
            type="button"
            onclick={() => (expanded = { ...expanded, [surface]: !expanded[surface] })}
            class="mt-4 inline-flex items-center gap-1.5 text-sm text-(--color-muted) hover:text-(--color-text)"
          >
            <span aria-hidden="true">{expanded[surface] ? "^" : "v"}</span>
            Decoding overrides
          </button>

          {#if expanded[surface]}
            <div class="mt-3 grid grid-cols-2 gap-3">
              {#each ["temperature", "maxOutputTokens", "topK", "topP"] as key}
                <label class="text-sm">
                  <span class="block text-xs font-medium text-(--color-muted) mb-1">{key}</span>
                  <input
                    type="number"
                    min="0"
                    step={key === "temperature" || key === "topP" ? "0.1" : "1"}
                    value={decoding[key as keyof Decoding] ?? ""}
                    oninput={(e) =>
                      updateDecoding(surface, key as keyof Decoding, (e.target as HTMLInputElement).value)}
                    class="w-full rounded-md border border-(--color-border) bg-(--color-surface) px-3 py-2"
                  />
                </label>
              {/each}
            </div>
          {/if}
        </article>
      {/each}
    </section>

    <section class="mt-8">
      <h2 class="text-xs tracking-widest uppercase text-(--color-muted) mb-3 font-semibold">
        Feature Flags
      </h2>
      <div class="divide-y divide-(--color-border) border-y border-(--color-border)">
        {#each featureKeys as key}
          <label class="flex items-center justify-between gap-4 py-3">
            <span>
              <span class="block text-sm font-medium">{key}</span>
              <span class="block text-sm text-(--color-muted)">{FEATURE_COPY[key] ?? "Runtime feature flag."}</span>
            </span>
            <input
              type="checkbox"
              checked={current.features[key]}
              onclick={() => updateFeature(key, !current.features[key])}
              class="size-4 accent-(--color-accent)"
            />
          </label>
        {/each}
      </div>
    </section>
  {/if}
</div>
