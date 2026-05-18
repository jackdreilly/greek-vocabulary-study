<script lang="ts">
  import GreekText from "../../ui/GreekText.svelte";

  type Item = { sentence: string; answer: string; hint?: string; english?: string };
  let {
    items,
    blankItems,
    title,
    instructions,
  }: { items?: Item[]; blankItems?: Item[]; title?: string; instructions?: string } = $props();

  let answers = $state<Record<number, string>>({});
  let submitted = $state(false);
  const blanks = $derived(items ?? blankItems ?? []);
  const answeredCount = $derived(
    blanks.filter((_, idx) => (answers[idx] ?? "").trim().length > 0).length
  );
  const correctCount = $derived(
    blanks.filter((item, idx) => normalize(answers[idx] ?? "") === normalize(item.answer)).length
  );

  function normalize(s: string) {
    return s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .trim();
  }
</script>

{#if title}
  <h3 class="text-base font-semibold tracking-tight mt-6 mb-2">{title}</h3>
{/if}
{#if instructions}
  <p class="text-sm text-(--color-muted) mb-3">{instructions}</p>
{/if}
<ol class="my-6 space-y-3 list-decimal pl-5">
  {#each blanks as item, idx}
    {@const parts = item.sentence.split("___")}
    {@const userAnswer = answers[idx] ?? ""}
    {@const correct = submitted && normalize(userAnswer) === normalize(item.answer)}
    <li class="leading-loose">
      <span class="font-serif text-lg">
        {parts[0]}
        <input
          type="text"
          value={userAnswer}
          oninput={(e) => {
            answers = { ...answers, [idx]: (e.target as HTMLInputElement).value };
            submitted = false;
          }}
          class="inline-block min-w-[6rem] px-2 py-0.5 border-b-2 bg-transparent font-serif text-lg
            {submitted
            ? correct
              ? 'border-[#16a34a] text-[#15803d]'
              : 'border-(--color-danger) text-(--color-danger)'
            : 'border-(--color-border-strong) focus:border-(--color-accent)'}
            outline-none"
          placeholder=" "
        />{parts.slice(1).join("___")}
      </span>
      {#if item.hint}
        <span class="block text-xs text-(--color-muted) mt-0.5">Hint: {item.hint}</span>
      {/if}
      {#if item.english}
        <span class="block text-xs text-(--color-muted) mt-0.5">{item.english}</span>
      {/if}
      {#if submitted && !correct}
        <span class="block text-xs text-(--color-muted) mt-0.5">
          Answer: <GreekText>{item.answer}</GreekText>
        </span>
      {/if}
    </li>
  {/each}
</ol>

<div class="mt-3 flex flex-wrap items-center gap-3">
  <button
    type="button"
    onclick={() => (submitted = true)}
    disabled={answeredCount === 0}
    class="rounded-md bg-(--color-accent) px-4 py-2 text-sm font-medium text-white hover:bg-(--color-accent-hover) disabled:opacity-50"
  >
    Check answers
  </button>
  {#if submitted}
    <span class="text-sm text-(--color-muted)">
      {correctCount} / {blanks.length} correct
    </span>
  {/if}
</div>
