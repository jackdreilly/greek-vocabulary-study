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
</script>

<label class="block">
  <span class="block text-xs font-medium text-(--color-muted) mb-1">{label}</span>
  <select
    bind:value
    class="w-full rounded-md border border-(--color-border) bg-(--color-surface) px-2 py-1.5 text-sm focus:outline-none focus:border-(--color-accent) focus:ring-1 focus:ring-(--color-accent)"
  >
    <option value="">{autoLabel}</option>
    {#each SKILL_LEVELS as level}
      <option value={level}>{SKILL_LEVEL_LABEL[level]} — {SKILL_LEVEL_HINT[level]}</option>
    {/each}
  </select>
</label>
