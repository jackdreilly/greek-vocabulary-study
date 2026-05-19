/**
 * Shared schema primitives used across content / generation / config docs.
 * Each typed doc collection's schema lives in its own file alongside this one.
 */
import { z } from "genkit";
import { Timestamp } from "firebase-admin/firestore";

/**
 * Firestore Timestamp validator. We accept either a real Timestamp instance
 * (server reads) or a serialized form `{seconds, nanoseconds}` (client writes
 * via Firestore SDK). Either way, we normalize to a Timestamp on parse.
 */
export const TimestampSchema = z
  .union([
    z.instanceof(Timestamp),
    z.object({ seconds: z.number(), nanoseconds: z.number() }),
  ])
  .transform((v) => (v instanceof Timestamp ? v : new Timestamp(v.seconds, v.nanoseconds)));

export const StatusSchema = z.enum(["initializing", "streaming", "ready", "error", "reverting"]);
export type Status = z.infer<typeof StatusSchema>;

export const StatusLogEntrySchema = z.object({
  at: TimestampSchema,
  message: z.string(),
  source: z.enum(["system", "model"]),
});
export type StatusLogEntry = z.infer<typeof StatusLogEntrySchema>;

export const CountsSchema = z
  .object({
    lessons: z.number().int().nonnegative().optional(),
    entries: z.number().int().nonnegative().optional(),
    plans: z.number().int().nonnegative().optional(),
    games: z.number().int().nonnegative().optional(),
  })
  .strict();
export type Counts = z.infer<typeof CountsSchema>;

export const LanguagePairSchema = z.object({
  source: z.literal("en"),
  target: z.literal("el"),
});
export type LanguagePair = z.infer<typeof LanguagePairSchema>;

/**
 * Skill level for a course or lesson — an ordered ladder from absolute beginner
 * to advanced. The "sub-A1" levels (tourist, year_1, year_2) each represent
 * roughly 3 months of intensive self-guided study (~500 words per level jump)
 * and slot in before the standard CEFR levels.
 *
 * Used as binding context for downstream AI generation (vocab, plans, games)
 * so material stays bounded to the learner's level.
 */
export const SkillLevelSchema = z.enum([
  "tourist",
  "year_1",
  "year_2",
  "A1",
  "A2",
  "B1",
  "B2",
  "C1",
  "C2",
]);
export type SkillLevel = z.infer<typeof SkillLevelSchema>;

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

/** Human-facing description for each skill level — used in prompts and UI. */
export const SKILL_LEVEL_LABELS: Record<SkillLevel, string> = {
  tourist: "Tourist — ~250-500 words; survival travel phrases (ordering food, greetings, numbers, asking directions). Learner may not even know the alphabet yet.",
  year_1: "1st year — ~500-1000 words; comfortable with the alphabet, present tense, articles, basic everyday situations. Roughly first year of self-guided study.",
  year_2: "2nd year — ~1000-1500 words; past/future tenses, common conjunctions, longer simple sentences. Roughly second year of self-guided study.",
  A1: "A1 (beginner) — ~1500-2500 words; can handle short, predictable exchanges and basic personal info.",
  A2: "A2 (elementary) — ~2500-3500 words; can describe routines and immediate needs in simple Greek.",
  B1: "B1 (intermediate) — ~3500-5000 words; can handle most everyday topics and follow connected speech.",
  B2: "B2 (upper intermediate) — ~5000-7000 words; can discuss abstract ideas, opinions, and nuanced situations.",
  C1: "C1 (advanced) — ~7000+ words; can read literature, hold professional conversations, use idioms naturally.",
  C2: "C2 (mastery) — near-native; sophisticated register, rare vocabulary, literary and technical fluency.",
};

/** Short display name for each level (for chips/dropdowns). */
export const SKILL_LEVEL_SHORT: Record<SkillLevel, string> = {
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
