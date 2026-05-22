import { z } from "genkit";
import { getDecodingFor, getModelFor } from "./configResolver.js";
import { getAI } from "./genkitClient.js";
import { SKILL_LEVEL_LABELS, SkillLevelSchema, type SkillLevel } from "../schemas/common.js";

export const VocabSuggestionSchema = z.object({
  lemma: z.string(),
  article: z.string().optional(),
  english_senses: z.array(z.string()),
  category: z.string(),
  notes: z.string().optional(),
});

const GenerateVocabInputSchema = z.object({
  courseTitle: z.string().default("Greek course"),
  courseDescription: z.string().optional().default(""),
  courseSourcePrompt: z.string().optional().default(""),
  lessonTitle: z.string(),
  lessonDescription: z.string().optional().default(""),
  lessonSourcePrompt: z.string().optional().default(""),
  prompt: z.string(),
  chainContext: z.string().optional().default(""),
  count: z.number().int().min(1).max(80),
  existingLemmas: z.array(z.string()),
  skillLevel: SkillLevelSchema.optional(),
  requiredLemmas: z.array(z.string()).optional().default([]),
});

const GenerateVocabOutputSchema = z.object({
  suggestions: z.array(VocabSuggestionSchema),
});

export type VocabSuggestion = z.infer<typeof VocabSuggestionSchema>;
export type GenerateVocabInput = z.infer<typeof GenerateVocabInputSchema>;

function skillLevelLine(level: SkillLevel | undefined): string {
  if (!level) return "Skill level: not specified — default to A1-style content.";
  return `Skill level: ${level} — ${SKILL_LEVEL_LABELS[level]}. Every word must be appropriate for this exact level; do not introduce content above it.`;
}

export function buildVocabPrompt(input: GenerateVocabInput) {
  const existing = input.existingLemmas.length
    ? `\nDo not include these existing lemmas: ${input.existingLemmas.slice(0, 160).join(", ")}`
    : "";
  const chainContextValue = input.chainContext ?? "";
  const chainContext = chainContextValue.trim()
    ? `\nPrevious generation turns to preserve context:\n${chainContextValue}\n`
    : "";
  const requiredLemmas = (input.requiredLemmas ?? []).filter(Boolean);
  const requiredBlock = requiredLemmas.length
    ? `\nREQUIRED VOCABULARY (these were embedded in the lesson overview and MUST appear in the output, each as its own entry, in dictionary form):
${requiredLemmas.map((w) => `- ${w}`).join("\n")}
Include EVERY one of these words as a vocabulary entry (use their dictionary form: nominative singular for nouns, 1st-person singular present for verbs, fixed phrase for expressions). If a required item is a phrase, keep it as a single phrase entry. Then fill the remaining slots up to ${input.count} total with additional related vocabulary.`
    : "";

  return `Generate Modern Greek vocabulary entries for this lesson.

Course: ${input.courseTitle}
Course description: ${input.courseDescription}
Original course request: ${input.courseSourcePrompt}
Lesson: ${input.lessonTitle}
Lesson overview: ${input.lessonDescription}
Original lesson request: ${input.lessonSourcePrompt}
User/requested focus: ${input.prompt}
${skillLevelLine(input.skillLevel)}
${chainContext}${requiredBlock}${existing}

THE USER'S REQUESTED FOCUS IS THE TOP PRIORITY. Read "${input.prompt}" literally and satisfy it precisely:
- QUANTITY: produce about ${input.count} entries by default. If the requested focus explicitly states how many it wants (e.g. "3 expressions", "just a couple", "five idioms", "a dozen words"), output exactly that many instead — an explicit requested amount always overrides the default. When no amount is requested, produce ${input.count}.
- If it asks for a specific KIND of entry (e.g. "multi-word expressions", "idioms", "phrases", "slang", "proverbs", "funny expressions"), then EVERY entry must be exactly that kind. Do not pad the list with ordinary single words the user did not ask for.
- If it asks for a TONE or THEME (e.g. "funny", "romantic", "for ordering coffee"), every entry must clearly match it.
- If the focus and the lesson context ever conflict, follow the user's focus.

An "entry" is NOT limited to a single word. A lemma may be a single word, a multi-word expression, a fixed phrase, an idiom, a proverb, a collocation, or a short sentence — whatever best fits the request. When the user asks for expressions or phrases, put the full natural expression in the lemma (do not reduce it to one head word).

Rules:
- Treat the previous generation turns as binding context, like earlier chat turns. Build on them; do not restart from a generic Greek lesson.
- lemma is the natural form of the entry: dictionary form for plain words (nominative singular for nouns, 1st-person present for verbs); the full, natural surface form for expressions, idioms, and phrases.
- article is ο, η, or το for single nouns, otherwise null (null for verbs, adjectives, adverbs, expressions, phrases).
- english_senses has 1-4 concise English meanings or, for an expression/idiom, its meaning plus an optional literal gloss.
- category reflects what the entry actually is: noun_masculine, noun_feminine, noun_neuter, verb, adjective, adverb, phrase, expression, other. Use "expression" or "phrase" freely for multi-word entries.
- notes is optional and short — good for register, literal meaning of an idiom, or usage context.
- Prefer frequent, useful, context-relevant vocabulary that satisfies the requested focus.
- Avoid duplicates, near duplicates, and entries that drift away from the requested focus.
- Calibrate everything to the learner's skill level above.`;
}

export const generateVocabFlow = getAI().defineFlow(
  {
    name: "generateVocab",
    inputSchema: GenerateVocabInputSchema,
    outputSchema: GenerateVocabOutputSchema,
  },
  async (input) => {
    const model = await getModelFor("lessonGen");
    const decoding = await getDecodingFor("lessonGen");

    const { output } = await getAI().generate({
      model,
      output: { schema: GenerateVocabOutputSchema },
      config: {
        maxOutputTokens: 8000,
        ...decoding,
      },
      system:
        "You are a Modern Greek vocabulary expert. Generate accurate, learner-friendly vocabulary entries as strict JSON.",
      prompt: buildVocabPrompt(input),
    });

    if (!output) throw new Error("Vocab generation returned no output.");
    return output;
  },
);

export function normalizeArticle(article: unknown): string | undefined {
  if (typeof article !== "string") return undefined;
  const trimmed = article.trim();
  if (!trimmed || ["n/a", "none", "null", "-"].includes(trimmed.toLowerCase())) return undefined;
  return trimmed;
}

export function primaryEnglish(suggestion: VocabSuggestion): string {
  return suggestion.english_senses[0] ?? "";
}
