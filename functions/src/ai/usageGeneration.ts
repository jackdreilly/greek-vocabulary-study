import { z } from "genkit";
import { getDecodingFor, getModelFor } from "./configResolver.js";
import { getAI } from "./genkitClient.js";
import { SKILL_LEVEL_LABELS, SkillLevelSchema, type SkillLevel } from "../schemas/common.js";

export const SentenceUsageSchema = z.object({
  el: z.string(),
  en: z.string(),
});

const GenerateUsageInputSchema = z.object({
  lemma: z.string(),
  article: z.string().optional(),
  english: z.string(),
  senses: z.array(z.string()).default([]),
  category: z.string().optional(),
  skillLevel: SkillLevelSchema.optional(),
});

const GenerateUsageOutputSchema = z.object({
  usages: z.array(SentenceUsageSchema).length(3),
});

export type GenerateUsageInput = z.infer<typeof GenerateUsageInputSchema>;
export type SentenceUsage = z.infer<typeof SentenceUsageSchema>;

function skillLevelLine(level: SkillLevel | undefined): string {
  if (!level) return "Use beginner-friendly everyday language.";
  return `Learner level: ${level} — ${SKILL_LEVEL_LABELS[level]}`;
}

export function buildUsagePrompt(input: GenerateUsageInput): string {
  return `Write exactly three natural Modern Greek sentence usages for the vocabulary entry below.

Entry: ${input.article ? `${input.article} ` : ""}${input.lemma}
Meaning: ${input.english}
Other meanings: ${input.senses.join("; ")}
Category: ${input.category ?? "unspecified"}
${skillLevelLine(input.skillLevel)}

Rules:
- Use the target entry naturally and correctly in every Greek sentence.
- Keep each sentence distinct, useful, and appropriate to the learner level.
- Provide a concise, accurate English translation for each sentence.
- Return exactly three usages and no extra commentary.`;
}

export const generateUsageFlow = getAI().defineFlow(
  {
    name: "generateSentenceUsages",
    inputSchema: GenerateUsageInputSchema,
    outputSchema: GenerateUsageOutputSchema,
  },
  async (input) => {
    const model = await getModelFor("usageGen");
    const decoding = await getDecodingFor("usageGen");
    const { output } = await getAI().generate({
      model,
      output: { schema: GenerateUsageOutputSchema },
      config: { maxOutputTokens: 1200, ...decoding },
      system: "You are a Modern Greek teacher. Return only strict JSON matching the requested schema.",
      prompt: buildUsagePrompt(input),
    });
    if (!output) throw new Error("Sentence usage generation returned no output.");
    return output;
  },
);
