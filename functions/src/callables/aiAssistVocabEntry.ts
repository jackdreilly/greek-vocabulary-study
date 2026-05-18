import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "genkit";
import { getDecodingFor, getModelFor } from "../ai/configResolver.js";
import { geminiApiKey, getAI } from "../ai/genkitClient.js";

const AiAssistVocabEntryInputSchema = z.object({
  lemma: z.string().min(1).max(120),
  article: z.string().optional().default(""),
  currentSenses: z.array(z.string()).default([]),
  prompt: z.string().min(1).max(800),
});

const AiAssistVocabEntryOutputSchema = z.object({
  lemma: z.string().min(1).max(120),
  english_senses: z.array(z.string()),
});

const aiAssistVocabEntryFlow = getAI().defineFlow(
  {
    name: "aiAssistVocabEntry",
    inputSchema: AiAssistVocabEntryInputSchema,
    outputSchema: AiAssistVocabEntryOutputSchema,
  },
  async (input) => {
    const model = await getModelFor("lessonGen");
    const decoding = await getDecodingFor("lessonGen");
    const articleDisplay = input.article ? `${input.article} ` : "";

    const { output } = await getAI().generate({
      model,
      output: { schema: AiAssistVocabEntryOutputSchema },
      config: {
        maxOutputTokens: 1200,
        ...decoding,
      },
      system:
        "You are a Modern Greek vocabulary editor. Return a corrected Greek lemma and concise, accurate English definitions as strict JSON.",
      prompt: `Greek word: ${articleDisplay}${input.lemma}
Current English definitions: ${
        input.currentSenses.length
          ? input.currentSenses.map((sense, index) => `${index + 1}. ${sense}`).join("; ")
          : "(none)"
      }

User request: ${input.prompt}

Return JSON with:
- lemma: the corrected actual Greek word or phrase. Keep it unchanged unless the user request or obvious typo calls for an edit.
- english_senses: 1-6 concise English definitions. Prefer useful learner-facing definitions over long dictionary prose.`,
    });

    if (!output) throw new Error("AI assist returned no output.");
    return output;
  },
);

export const aiAssistVocabEntry = onCall({ secrets: [geminiApiKey] }, async (request) => {
  const parsed = AiAssistVocabEntryInputSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", parsed.error.issues.map((issue) => issue.message).join("; "));
  }

  try {
    return await aiAssistVocabEntryFlow(parsed.data);
  } catch (err) {
    throw new HttpsError("internal", err instanceof Error ? err.message : String(err));
  }
});
