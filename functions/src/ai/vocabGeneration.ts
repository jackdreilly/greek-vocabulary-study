import { z } from "genkit";
import { getDecodingFor, getModelFor } from "./configResolver.js";
import { getAI } from "./genkitClient.js";

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
});

const GenerateVocabOutputSchema = z.object({
  suggestions: z.array(VocabSuggestionSchema),
});

export type VocabSuggestion = z.infer<typeof VocabSuggestionSchema>;
export type GenerateVocabInput = z.infer<typeof GenerateVocabInputSchema>;

export function buildVocabPrompt(input: GenerateVocabInput) {
  const existing = input.existingLemmas.length
    ? `\nDo not include these existing lemmas: ${input.existingLemmas.slice(0, 160).join(", ")}`
    : "";
  const chainContextValue = input.chainContext ?? "";
  const chainContext = chainContextValue.trim()
    ? `\nPrevious generation turns to preserve context:\n${chainContextValue}\n`
    : "";

  return `Generate ${input.count} Modern Greek vocabulary entries.

Course: ${input.courseTitle}
Course description: ${input.courseDescription}
Original course request: ${input.courseSourcePrompt}
Lesson: ${input.lessonTitle}
Lesson overview: ${input.lessonDescription}
Original lesson request: ${input.lessonSourcePrompt}
User/requested focus: ${input.prompt}
${chainContext}${existing}

Rules:
- Treat the previous generation turns as binding context, like earlier chat turns. Build on them; do not restart from a generic Greek lesson.
- lemma is the dictionary form: nominative singular for nouns, 1st-person present for verbs, natural fixed phrase for expressions.
- article is ο, η, or το for nouns, otherwise null.
- english_senses has 1-4 concise English meanings.
- category should be one of: noun_masculine, noun_feminine, noun_neuter, verb, adjective, adverb, phrase, expression, other.
- notes is optional and short.
- Prefer frequent, useful, context-relevant vocabulary.
- Avoid duplicates, near duplicates, and vocabulary unrelated to the lesson/course context.`;
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
