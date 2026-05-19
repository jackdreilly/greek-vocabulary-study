/**
 * Skill levels for courses and lessons. Sub-A1 levels each represent ~3 months
 * of intensive self-guided study (~500 words per jump) and slot in before CEFR.
 * Mirrored from `functions/src/schemas/common.ts`.
 */
export type SkillLevel =
  | "tourist"
  | "year_1"
  | "year_2"
  | "A1"
  | "A2"
  | "B1"
  | "B2"
  | "C1"
  | "C2";

export const SKILL_LEVELS: SkillLevel[] = [
  "tourist",
  "year_1",
  "year_2",
  "A1",
  "A2",
  "B1",
  "B2",
  "C1",
  "C2",
];

export const SKILL_LEVEL_LABEL: Record<SkillLevel, string> = {
  tourist: "Tourist",
  year_1: "1st year",
  year_2: "2nd year",
  A1: "A1",
  A2: "A2",
  B1: "B1",
  B2: "B2",
  C1: "C1",
  C2: "C2",
};

export const SKILL_LEVEL_HINT: Record<SkillLevel, string> = {
  tourist: "Survival travel phrases.",
  year_1: "Alphabet & present tense — ~1st year.",
  year_2: "Past/future tenses — ~2nd year.",
  A1: "Short predictable exchanges.",
  A2: "Routines & immediate needs.",
  B1: "Most everyday topics.",
  B2: "Abstract ideas & opinions.",
  C1: "Advanced — literature & nuance.",
  C2: "Mastery — near-native.",
};

export function skillLevelLabel(level: SkillLevel | undefined | null): string {
  if (!level) return "";
  return SKILL_LEVEL_LABEL[level] ?? "";
}

/** Heuristic skill-level inference from a free-text course/lesson prompt. */
export function inferSkillLevel(prompt: string): SkillLevel | undefined {
  const lower = prompt.toLowerCase();
  // Explicit CEFR mentions take priority.
  const cefrMatch = lower.match(/\b([abc][12])\b/i);
  if (cefrMatch) {
    const code = cefrMatch[1].toUpperCase() as SkillLevel;
    if (SKILL_LEVELS.includes(code)) return code;
  }
  if (/\b(tourist|vacation|holiday|trip to greece|island trip|visit greece)\b/.test(lower)) {
    return "tourist";
  }
  if (/\b(first year|1st year|year one|year 1)\b/.test(lower)) {
    return "year_1";
  }
  if (/\b(second year|2nd year|year two|year 2)\b/.test(lower)) {
    return "year_2";
  }
  if (/\b(complete beginner|never studied|no greek|absolute beginner|brand new|alphabet)\b/.test(lower)) {
    return "year_1";
  }
  if (/\b(beginner|just starting|new to greek)\b/.test(lower)) {
    return "A1";
  }
  if (/\b(intermediate)\b/.test(lower)) return "B1";
  if (/\b(upper intermediate)\b/.test(lower)) return "B2";
  if (/\b(advanced)\b/.test(lower)) return "C1";
  if (/\b(near.?native|mastery|fluent)\b/.test(lower)) return "C2";
  return undefined;
}
