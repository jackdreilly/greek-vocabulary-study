<script lang="ts">
  import { SKILL_LEVELS, SKILL_LEVEL_HINT, SKILL_LEVEL_LABEL, type SkillLevel } from "../skillLevel";

  let {
    value = $bindable<SkillLevel | "">(""),
    label = "Skill level",
    autoLabel = "Auto-detect from prompt",
  }: {
    value?: SkillLevel | "";
    label?: string;
    autoLabel?: string;
  } = $props();

  const ICON: Record<string, string> = {
    "":      "✨",
    tourist: "🌴",
    year_1:  "🌱",
    year_2:  "🌿",
    A1:      "🐣",
    A2:      "🌊",
    B1:      "⭐",
    B2:      "🔥",
    C1:      "💫",
    C2:      "👑",
  };

  const ALL: (SkillLevel | "")[] = ["", ...SKILL_LEVELS];

  function optionLabel(level: SkillLevel | "") {
    if (level === "") return `${ICON[""]}  Auto`;
    const hint = SKILL_LEVEL_HINT[level];
    return `${ICON[level]}  ${SKILL_LEVEL_LABEL[level]} — ${hint}`;
  }

  const hint = $derived(value ? SKILL_LEVEL_HINT[value] : autoLabel);
</script>

<div>
  {#if label}
    <span class="mb-1 block text-xs font-medium text-(--color-muted)">{label}</span>
  {/if}
  <div class="relative">
    <select
      bind:value
      class="w-full appearance-none rounded-md border border-(--color-border) bg-(--color-surface) py-1.5 px-3 pr-7 text-sm text-(--color-text) focus:border-(--color-accent) focus:outline-none focus:ring-1 focus:ring-(--color-accent)"
    >
      {#each ALL as level}
        <option value={level}>{optionLabel(level)}</option>
      {/each}
    </select>
    <span class="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-(--color-muted) opacity-60">
      <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><path d="M1 3l4 4 4-4"/></svg>
    </span>
  </div>
  {#if hint}
    <p class="mt-1 text-[11px] text-(--color-muted)">{hint}</p>
  {/if}
</div>
