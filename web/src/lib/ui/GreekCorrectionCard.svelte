<script lang="ts">
  import type { GreekCorrection } from "../data/yiayia";
  import { CheckCircle2, Loader2, Sparkles } from "lucide-svelte";

  let {
    correction = null,
    pending = false,
    userText = "",
  }: {
    correction?: GreekCorrection | null;
    pending?: boolean;
    userText?: string;
  } = $props();

  const naturalPhrasings = $derived(correction?.naturalPhrasings ?? []);
  const isPerfect = $derived(
    !!correction
      && correction.tips.length === 0
      && naturalPhrasings.length === 0
      && (!userText || correction.correctedText.trim() === userText.trim()),
  );
</script>

{#if pending}
  <div class="gc-checking">
    <Loader2 size={12} aria-hidden="true" class="gc-spin" />
    <span>Checking your Greek…</span>
  </div>
{:else if correction}
  <div class="greek-correction">
    <div class="gc-header">🇬🇷 Greek correction</div>

    {#if isPerfect}
      <div class="gc-perfect">
        <CheckCircle2 size={13} aria-hidden="true" />
        Looks great — no corrections needed!
      </div>
    {:else}
      {#if correction.correctedText && correction.correctedText.trim() !== userText.trim()}
        <div class="gc-corrected">✓ {correction.correctedText}</div>
      {/if}

      {#each correction.tips as tip}
        <div class="gc-tip">
          <span class="gc-badge gc-badge-{tip.type}">{tip.type.replace("_", " ")}</span>
          <span class="gc-change">
            <span class="gc-original">{tip.original}</span>
            <span class="gc-arrow">→</span>
            <span class="gc-fixed">{tip.corrected}</span>
          </span>
          <span class="gc-explanation">{tip.explanation}</span>
        </div>
      {/each}

      {#if naturalPhrasings.length > 0}
        <div class="gc-natural-header">
          <Sparkles size={11} aria-hidden="true" />
          More natural ways to say it
        </div>
        {#each naturalPhrasings as suggestion}
          <div class="gc-natural">
            <div class="gc-natural-greek">{suggestion.greek}</div>
            <div class="gc-natural-en">{suggestion.english}</div>
            <div class="gc-natural-why">{suggestion.why}</div>
          </div>
        {/each}
      {/if}
    {/if}
  </div>
{/if}

<style>
  .greek-correction {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0.55rem 0.65rem;
    background: #f0fdf4;
    border: 1px solid #bbf7d0;
    border-radius: 8px;
    margin-bottom: 0.5rem;
  }
  .gc-header {
    font-size: 0.7rem;
    font-weight: 700;
    color: #15803d;
    letter-spacing: 0.02em;
    text-transform: uppercase;
  }
  .gc-corrected {
    font-size: 0.88rem;
    font-weight: 600;
    color: #166534;
  }
  .gc-tip {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    padding: 0.35rem 0.5rem;
    background: #ffffff;
    border: 1px solid #d1fae5;
    border-radius: 6px;
  }
  .gc-badge {
    display: inline-block;
    width: fit-content;
    font-size: 0.6rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    padding: 0.1em 0.45em;
    border-radius: 3px;
  }
  .gc-badge-spelling   { background: #fef3c7; color: #92400e; }
  .gc-badge-grammar    { background: #dbeafe; color: #1e40af; }
  .gc-badge-accent     { background: #ede9fe; color: #5b21b6; }
  .gc-badge-vocabulary { background: #d1fae5; color: #065f46; }
  .gc-badge-word_order { background: #f1f5f9; color: #334155; }
  .gc-change {
    font-size: 0.82rem;
    font-family: ui-monospace, "SF Mono", monospace;
    color: #374151;
  }
  .gc-original {
    color: #dc2626;
    text-decoration: line-through;
  }
  .gc-arrow {
    margin: 0 0.25rem;
    color: #9ca3af;
  }
  .gc-fixed {
    color: #15803d;
    font-weight: 600;
  }
  .gc-explanation {
    font-size: 0.75rem;
    color: #4b5563;
    line-height: 1.45;
  }
  .gc-perfect {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.82rem;
    color: #15803d;
    font-style: italic;
  }
  .gc-natural-header {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    margin-top: 0.2rem;
    font-size: 0.68rem;
    font-weight: 700;
    color: #6d28d9;
    letter-spacing: 0.02em;
    text-transform: uppercase;
  }
  .gc-natural {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    padding: 0.35rem 0.5rem;
    background: #faf5ff;
    border: 1px solid #e9d5ff;
    border-radius: 6px;
  }
  .gc-natural-greek {
    font-size: 0.9rem;
    font-weight: 600;
    color: #5b21b6;
  }
  .gc-natural-en {
    font-size: 0.78rem;
    color: #6b7280;
  }
  .gc-natural-why {
    font-size: 0.72rem;
    color: #4b5563;
    font-style: italic;
    line-height: 1.4;
  }
  .gc-checking {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    margin-bottom: 0.4rem;
    font-size: 0.72rem;
    color: #6b7280;
  }
  :global(.gc-spin) {
    animation: gc-spin 0.9s linear infinite;
  }
  @keyframes gc-spin {
    to { transform: rotate(360deg); }
  }
</style>
