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

  return `Generate ${input.count} Modern Greek vocabulary entries.

Course: ${input.courseTitle}
Course description: ${input.courseDescription}
Original course request: ${input.courseSourcePrompt}
Lesson: ${input.lessonTitle}
Lesson overview: ${input.lessonDescription}
Original lesson request: ${input.lessonSourcePrompt}
User/requested focus: ${input.prompt}
${skillLevelLine(input.skillLevel)}
${chainContext}${requiredBlock}${existing}

Rules:
- Treat the previous generation turns as binding context, like earlier chat turns. Build on them; do not restart from a generic Greek lesson.
- lemma is the dictionary form: nominative singular for nouns, 1st-person present for verbs, natural fixed phrase for expressions.
- article is ο, η, or το for nouns, otherwise null.
- english_senses has 1-4 concise English meanings.
- category should be one of: noun_masculine, noun_feminine, noun_neuter, verb, adjective, adverb, phrase, expression, other.
- notes is optional and short.
- Prefer frequent, useful, context-relevant vocabulary.
- Avoid duplicates, near duplicates, and vocabulary unrelated to the lesson/course context.
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
