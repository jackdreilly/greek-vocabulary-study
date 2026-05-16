import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { enableFirebaseTelemetry } from '@genkit-ai/firebase';
import { googleAI } from '@genkit-ai/google-genai';
import { genkit, z } from 'genkit';
import { defineSecret } from 'firebase-functions/params';
import { onCallGenkit } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2/options';

if (!admin.apps.length) {
  const projectId =
    process.env.GCLOUD_PROJECT || process.env.FIREBASE_CONFIG?.match(/"projectId":"([^"]+)"/)?.[1] || '';
  admin.initializeApp(projectId ? { projectId } : {});
}

setGlobalOptions({
  region: 'us-central1',
  maxInstances: 10,
});

const GOOGLE_GENAI_API_KEY = defineSecret('GOOGLE_GENAI_API_KEY');
const GAME_GENERATION_MODEL = 'googleai/gemini-3-flash-preview';
const GAME_SCORING_MODEL = 'googleai/gemini-3.1-flash-lite-preview';
const YIAYIA_CHAT_MODEL = 'googleai/gemini-3.1-flash-lite-preview';
const VOCAB_DATABASE_ID = 'greek-vocab';

let _ai: ReturnType<typeof genkit> | null = null;
function getAI(): ReturnType<typeof genkit> {
  if (!_ai) {
    enableFirebaseTelemetry();
    _ai = genkit({
      plugins: [googleAI({ apiKey: optionalSecret(GOOGLE_GENAI_API_KEY) })],
    });
  }
  return _ai;
}

function optionalSecret(secret: { value(): string }): string | undefined {
  try {
    const value = secret.value();
    return value || undefined;
  } catch {
    return undefined;
  }
}

const LessonEntrySchema = z.object({
  id: z.union([z.string(), z.number()]),
  lemma: z.string(),
  article: z.string().nullable().optional(),
  english: z.string().nullable().optional(),
  english_senses: z.array(z.string()).optional(),
  category: z.string().optional(),
});

const GameTypeSchema = z.enum([
  'missing_word',
  'reading_comprehension',
  'story_prompt',
  'sentence_translation',
  'word_translation',
]);

const GameExerciseSchema = z.object({
  id: z.string(),
  type: GameTypeSchema,
  title: z.string(),
  prompt: z.string().default(''),
  instructions: z.string().default(''),
  expectedAnswer: z.string().default(''),
  acceptableAnswers: z.array(z.string()).default([]),
  direction: z.enum(['greek_to_english', 'english_to_greek', 'free_response']).default('free_response'),
  passage: z.string().optional(),
  question: z.string().optional(),
  requiredWords: z.array(z.string()).default([]),
  vocabulary: z
    .array(
      z.object({
        greek: z.string(),
        english: z.string(),
      }),
    )
    .default([]),
  sourceEntryIds: z.array(z.union([z.string(), z.number()])).default([]),
  coverage: z
    .object({
      summary: z.string(),
      words: z.array(z.string()).max(12),
      themes: z.array(z.string()).max(8),
    })
    .default({
      summary: '',
      words: [],
      themes: [],
    }),
  rubric: z.string(),
});

const LearningPreferencesSchema = z.object({
  responseLanguage: z.enum(['english', 'greek']).default('english'),
  cefrLevel: z.enum(['A1', 'A2', 'B1', 'B2', 'C1']).default('A2'),
});

const GenerateLessonGamesInputSchema = z.object({
  lessonId: z.number(),
  lessonTitle: z.string(),
  countPerType: z.number().min(1).max(10).default(5),
  previousExerciseDigests: z.array(z.string()).default([]),
  entries: z.array(LessonEntrySchema).min(0).max(120).default([]),
  preferences: LearningPreferencesSchema.default({ responseLanguage: 'english', cefrLevel: 'A2' }),
});

const GenerateLessonGamesOutputSchema = z.object({
  exercises: z.array(GameExerciseSchema),
});

const ScoreGameAnswerInputSchema = z.object({
  lessonId: z.number(),
  lessonTitle: z.string(),
  exercise: GameExerciseSchema,
  answer: z.string(),
  preferences: LearningPreferencesSchema.default({ responseLanguage: 'english', cefrLevel: 'A2' }),
});

const ScoreGameAnswerOutputSchema = z.object({
  accepted: z.boolean(),
  score: z.number().min(0).max(1),
  verdict: z.enum(['correct', 'almost', 'incorrect']),
  feedback: z.string(),
  betterAnswer: z.string(),
  shortReason: z.string(),
  greekCorrection: z
    .object({
      correctedText: z.string(),
      tips: z.array(
        z.object({
          type: z.enum(['spelling', 'grammar', 'accent', 'vocabulary', 'word_order']),
          original: z.string(),
          corrected: z.string(),
          explanation: z.string(),
        }),
      ),
    })
    .nullable(),
});

const YiayiaMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
});

const YiayiaChatInputSchema = z.object({
  lessonId: z.number(),
  lessonTitle: z.string(),
  exercise: GameExerciseSchema.optional(),
  entries: z.array(LessonEntrySchema).max(80).default([]),
  messages: z.array(YiayiaMessageSchema).min(1).max(16),
  preferences: LearningPreferencesSchema.default({ responseLanguage: 'english', cefrLevel: 'A2' }),
  aiModel: z.enum(['lite', 'flash']).default('lite'),
});

const YIAYIA_SYSTEM = `You are YiaYia AI, a warm but concise Greek tutor in a vocabulary practice app.
You help learners with the current lesson and question. Explain Modern Greek clearly, encourage practice, and keep answers focused.
Always respond in English unless the learner explicitly asks for Greek. If they write Greek, treat it as practice and gently coach them.
Never reveal hidden answer keys before the learner has made a real attempt.`;

function stripCombiningMarks(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

function normalizeStudyText(text: string): string {
  return stripCombiningMarks(String(text || '').toLocaleLowerCase('el'))
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function deterministicMatch(answer: string, expected: string[]): boolean {
  const normalized = normalizeStudyText(answer);
  return Boolean(normalized && expected.some((candidate) => normalizeStudyText(candidate) === normalized));
}

function vocabDb() {
  return getFirestore(VOCAB_DATABASE_ID);
}

function compactText(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizePreferences(
  preferences: Partial<z.infer<typeof LearningPreferencesSchema>> | undefined | null,
): z.infer<typeof LearningPreferencesSchema> {
  const responseLanguage = preferences?.responseLanguage === 'greek' ? 'greek' : 'english';
  const level = preferences?.cefrLevel;
  const cefrLevel = level === 'A1' || level === 'A2' || level === 'B1' || level === 'B2' || level === 'C1' ? level : 'A2';
  return { responseLanguage, cefrLevel };
}

function preferenceContext(preferencesInput: Partial<z.infer<typeof LearningPreferencesSchema>> | undefined | null): string {
  const preferences = normalizePreferences(preferencesInput);
  const responseLanguage =
    preferences.responseLanguage === 'greek'
      ? 'Respond in Modern Greek. Keep wording clear and learner-friendly; avoid dense academic Greek unless the level is C1.'
      : 'Respond in English while preserving Greek examples where useful.';
  const levelNotes: Record<z.infer<typeof LearningPreferencesSchema>['cefrLevel'], string> = {
    A1: 'A1 beginner: use short sentences, common vocabulary, lots of scaffolding, and simple present-tense examples.',
    A2: 'A2 elementary: keep sentences simple but allow everyday connectors, basic cases, and common verb forms.',
    B1: 'B1 intermediate: include natural short paragraphs, more forms, and concise grammar labels.',
    B2: 'B2 upper-intermediate: use richer vocabulary, idioms, and more precise grammar explanations.',
    C1: 'C1 advanced: allow nuanced Greek, register notes, etymology, and compact high-level explanations.',
  };
  return [`Learner level: ${preferences.cefrLevel}. ${levelNotes[preferences.cefrLevel]}`, responseLanguage].join('\n');
}

function cleanEntryForTool(entry: FirebaseFirestore.DocumentData): z.infer<typeof LessonEntrySchema> & {
  subsection?: string | null;
} {
  const senses = Array.isArray(entry.english_senses)
    ? entry.english_senses.map((sense: unknown) => compactText(sense)).filter(Boolean).slice(0, 3)
    : compactText(entry.english)
      ? compactText(entry.english).split(/\s*;\s*/).filter(Boolean).slice(0, 3)
      : [];
  return {
    id: entry.id ?? '',
    lemma: compactText(entry.lemma || entry.term || entry.dictionary_headword),
    article: entry.article ? compactText(entry.article) : null,
    english: compactText(entry.english),
    english_senses: senses,
    category: compactText(entry.category),
    subsection: entry.subsection ? compactText(entry.subsection) : null,
  };
}

function entryMatchesQuery(entry: ReturnType<typeof cleanEntryForTool>, query: string): boolean {
  if (!query) return true;
  const haystack = normalizeStudyText(
    [
      entry.lemma,
      entry.article,
      entry.english,
      ...(entry.english_senses || []),
      entry.category,
      entry.subsection,
    ].join(' '),
  );
  return haystack.includes(normalizeStudyText(query));
}

async function fetchLessonEntries(lessonId: number): Promise<Array<ReturnType<typeof cleanEntryForTool>>> {
  const snapshot = await vocabDb().collection('entries').where('theme_id', '==', lessonId).get();
  return snapshot.docs.map((doc) => cleanEntryForTool(doc.data())).filter((entry) => entry.lemma);
}

const getLessonOverviewTool = getAI().defineTool(
  {
    name: 'getLessonOverview',
    description:
      'Fetch compact metadata for a GreekFlash lesson: title, counts, categories, and a small representative word sample. Use before generating lesson exercises.',
    inputSchema: z.object({
      lessonId: z.number(),
      sampleLimit: z.number().min(0).max(20).default(10),
    }),
    outputSchema: z.object({
      lessonId: z.number(),
      title: z.string(),
      entryCount: z.number(),
      translatedCount: z.number(),
      categories: z.record(z.number()),
      sampleWords: z.array(LessonEntrySchema),
    }),
  },
  async ({ lessonId, sampleLimit }) => {
    const [themeDoc, entries] = await Promise.all([
      vocabDb().collection('themes').doc(String(lessonId)).get(),
      fetchLessonEntries(lessonId),
    ]);
    const categories: Record<string, number> = {};
    let translatedCount = 0;
    for (const entry of entries) {
      if (entry.english || entry.english_senses?.length) translatedCount += 1;
      const category = entry.category || 'Uncategorized';
      categories[category] = (categories[category] || 0) + 1;
    }
    const theme = themeDoc.exists ? themeDoc.data() || {} : {};
    return {
      lessonId,
      title: compactText(theme.title) || `Lesson ${lessonId}`,
      entryCount: entries.length,
      translatedCount,
      categories,
      sampleWords: entries
        .filter((entry) => entry.english || entry.english_senses?.length)
        .slice(0, sampleLimit),
    };
  },
);

const searchLessonWordsTool = getAI().defineTool(
  {
    name: 'searchLessonWords',
    description:
      'Search lesson vocabulary by Greek, English, or category. Returns only a small capped list, so call it with targeted terms such as "teacher", "write", "exam", or category names.',
    inputSchema: z.object({
      lessonId: z.number(),
      query: z.string().default(''),
      category: z.string().default(''),
      limit: z.number().min(1).max(50).default(12),
    }),
    outputSchema: z.object({
      lessonId: z.number(),
      query: z.string(),
      category: z.string().optional(),
      matches: z.array(LessonEntrySchema),
    }),
  },
  async ({ lessonId, query, category, limit }) => {
    const normalizedCategory = normalizeStudyText(category);
    const matches = (await fetchLessonEntries(lessonId))
      .filter((entry) => entry.english || entry.english_senses?.length)
      .filter((entry) => !normalizedCategory || normalizeStudyText(entry.category || '').includes(normalizedCategory))
      .filter((entry) => entryMatchesQuery(entry, query))
      .slice(0, limit);
    return {
      lessonId,
      query,
      category,
      matches,
    };
  },
);

const getExerciseCoverageTool = getAI().defineTool(
  {
    name: 'getExerciseCoverage',
    description:
      'Fetch compact coverage and deduplication data for generated lesson games: counts by game type, recently used prompts, required words, and source entry ids. Use this to avoid repeating game types, words, and prompts.',
    inputSchema: z.object({
      lessonId: z.number(),
      perTypeLimit: z.number().min(1).max(20).default(8),
    }),
    outputSchema: z.object({
      lessonId: z.number(),
      countsByType: z.record(z.number()),
      usedWords: z.array(z.object({ word: z.string(), count: z.number() })),
      usedSourceEntryIds: z.array(z.object({ id: z.string(), count: z.number() })),
      recentByType: z.record(
        z.array(
          z.object({
            id: z.string(),
            type: GameTypeSchema,
            coverageSummary: z.string(),
            prompt: z.string(),
            question: z.string(),
            expectedAnswer: z.string(),
            requiredWords: z.array(z.string()),
            coverageWords: z.array(z.string()),
            coverageThemes: z.array(z.string()),
            sourceEntryIds: z.array(z.string()),
          }),
        ),
      ),
    }),
  },
  async ({ lessonId, perTypeLimit }) => {
    const snapshot = await vocabDb().collection('lesson_ai_exercises').where('lessonId', '==', lessonId).get();
    const countsByType: Record<string, number> = {};
    const wordCounts = new Map<string, number>();
    const sourceCounts = new Map<string, number>();
    const recentByType: Record<string, Array<{
      id: string;
      type: z.infer<typeof GameTypeSchema>;
      coverageSummary: string;
      prompt: string;
      question: string;
      expectedAnswer: string;
      requiredWords: string[];
      coverageWords: string[];
      coverageThemes: string[];
      sourceEntryIds: string[];
      updatedAt: number;
    }>> = {};

    for (const doc of snapshot.docs) {
      const data = doc.data();
      if (data.status === 'removed') continue;
      const parsedType = GameTypeSchema.safeParse(data.type);
      if (!parsedType.success) continue;
      const type = parsedType.data;
      countsByType[type] = (countsByType[type] || 0) + 1;
      const requiredWords = Array.isArray(data.requiredWords)
        ? data.requiredWords.map((word: unknown) => compactText(word)).filter(Boolean).slice(0, 12)
        : [];
      const coverageWords = Array.isArray(data.coverage?.words)
        ? data.coverage.words.map((word: unknown) => compactText(word)).filter(Boolean).slice(0, 12)
        : [];
      const coverageThemes = Array.isArray(data.coverage?.themes)
        ? data.coverage.themes.map((theme: unknown) => compactText(theme)).filter(Boolean).slice(0, 8)
        : [];
      for (const word of [...requiredWords, ...coverageWords]) {
        wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
      }
      const sourceEntryIds = Array.isArray(data.sourceEntryIds)
        ? data.sourceEntryIds.map((id: unknown) => compactText(id)).filter(Boolean).slice(0, 12)
        : [];
      for (const id of sourceEntryIds) {
        sourceCounts.set(id, (sourceCounts.get(id) || 0) + 1);
      }
      recentByType[type] = [
        ...(recentByType[type] || []),
        {
          id: compactText(data.id || doc.id),
          type,
          coverageSummary: compactText(data.coverage?.summary).slice(0, 220),
          prompt: compactText(data.prompt).slice(0, 220),
          question: compactText(data.question).slice(0, 180),
          expectedAnswer: compactText(data.expectedAnswer).slice(0, 180),
          requiredWords,
          coverageWords,
          coverageThemes,
          sourceEntryIds,
          updatedAt: Number(data.updatedAt || data.createdAt || 0),
        },
      ];
    }

    const trimmedRecentByType: Record<string, Array<{
      id: string;
      type: z.infer<typeof GameTypeSchema>;
      coverageSummary: string;
      prompt: string;
      question: string;
      expectedAnswer: string;
      requiredWords: string[];
      coverageWords: string[];
      coverageThemes: string[];
      sourceEntryIds: string[];
    }>> = {};
    for (const [type, items] of Object.entries(recentByType)) {
      trimmedRecentByType[type] = items
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .slice(0, perTypeLimit)
        .map(({ updatedAt: _updatedAt, ...item }) => item);
    }

    return {
      lessonId,
      countsByType,
      usedWords: [...wordCounts.entries()]
        .map(([word, count]) => ({ word, count }))
        .sort((left, right) => right.count - left.count || left.word.localeCompare(right.word, 'el'))
        .slice(0, 80),
      usedSourceEntryIds: [...sourceCounts.entries()]
        .map(([id, count]) => ({ id, count }))
        .sort((left, right) => right.count - left.count || left.id.localeCompare(right.id))
        .slice(0, 80),
      recentByType: trimmedRecentByType,
    };
  },
);

function entrySummary(entries: Array<z.infer<typeof LessonEntrySchema>>): string {
  return entries
    .map((entry) => {
      const senses = entry.english_senses?.length ? entry.english_senses : entry.english ? [entry.english] : [];
      return `- ${entry.article ? `${entry.article} ` : ''}${entry.lemma}: ${senses.slice(0, 2).join('; ')}`;
    })
    .join('\n');
}

const generateLessonGamesFlow = getAI().defineFlow(
  {
    name: 'generateLessonGames',
    inputSchema: GenerateLessonGamesInputSchema,
    outputSchema: GenerateLessonGamesOutputSchema,
  },
  async (input) => {
    const preferences = normalizePreferences(input.preferences);
    const prompt = `Generate Greek practice questions for lesson ${input.lessonId}: ${input.lessonTitle}.

Learner preferences:
${preferenceContext(preferences)}

Before producing the JSON, use the available Firebase tools:
- getLessonOverview to understand the lesson area without loading everything.
- getExerciseCoverage to inspect already covered game types, words, themes, and recent prompts.
- searchLessonWords with targeted queries/categories to fetch only the vocabulary clusters you need.

Create exactly ${input.countPerType} exercises for each type:
- missing_word: a Greek sentence with one lesson word blanked out.
- reading_comprehension: a short Greek passage and one question about it.
- story_prompt: ask the learner to write a short Greek story using a handful of related lesson words.
- sentence_translation: translate one sentence, mixing Greek-to-English and English-to-Greek.
- word_translation: translate an individual lesson word, mixing both directions.

Use only lesson vocabulary as the main target language. Prefer natural classroom/school situations.
Avoid duplicates and avoid these already generated digests:
${input.previousExerciseDigests.join('\n') || '(none)'}

Return stable lowercase ids prefixed with "l${input.lessonId}-". Include sourceEntryIds where possible.
Every exercise must include coverage:
- summary: one short phrase naming what the question covers.
- words: the main Greek words practiced, max 12.
- themes: broad micro-themes like classroom objects, study habits, exams, reading, teachers.
For answer keys, include concise expectedAnswer plus acceptableAnswers. For open-ended tasks, expectedAnswer should be the target criteria.
Rubrics should be short and concrete.
Write exercise instructions/prompts at the selected learner level. If responseLanguage is greek, write learner-facing instructions in Greek; otherwise write instructions in English. Greek target sentences/passages should always remain Greek.

Small fallback vocabulary sample from the client, if tools are unavailable:
${entrySummary(input.entries.slice(0, 30)) || '(use the tools)'}`;

    const { output } = await getAI().generate({
      model: GAME_GENERATION_MODEL,
      output: { schema: GenerateLessonGamesOutputSchema },
      system:
        'You generate high-quality Modern Greek lesson exercises as JSON only. Keep Greek natural, age-neutral, and suitable for a learner. Prefer targeted tool calls over asking for or relying on broad lesson dumps.',
      prompt,
      tools: [getLessonOverviewTool, getExerciseCoverageTool, searchLessonWordsTool],
    });

    if (!output) throw new Error('Game generation returned no output.');
    return output;
  },
);

const scoreGameAnswerFlow = getAI().defineFlow(
  {
    name: 'scoreGameAnswer',
    inputSchema: ScoreGameAnswerInputSchema,
    outputSchema: ScoreGameAnswerOutputSchema,
  },
  async (input) => {
    const expected = [input.exercise.expectedAnswer, ...(input.exercise.acceptableAnswers || [])].filter(Boolean);
    const exact = deterministicMatch(input.answer, expected);
    const preferences = normalizePreferences(input.preferences);
    const { output } = await getAI().generate({
      model: GAME_SCORING_MODEL,
      output: { schema: ScoreGameAnswerOutputSchema },
      system:
        'You grade answers for a Greek vocabulary app. Be encouraging, concrete, and strict enough to help learning. Accept Greeklish only when it clearly matches Greek. Return JSON only. Use lesson vocabulary tools only when the exercise context is not enough to judge the answer.',
      prompt: `Lesson: ${input.lessonTitle}
Lesson id: ${input.lessonId}
Learner preferences:
${preferenceContext(preferences)}
Exercise type: ${input.exercise.type}
Direction: ${input.exercise.direction}
Prompt: ${input.exercise.prompt}
Passage: ${input.exercise.passage || ''}
Question: ${input.exercise.question || ''}
Expected answer or criteria: ${input.exercise.expectedAnswer}
Acceptable answers: ${expected.join(' || ')}
Rubric: ${input.exercise.rubric}
Learner answer: ${input.answer}
Deterministic normalized match: ${exact ? 'yes' : 'no'}

Rules:
- If deterministic normalized match is yes, accepted must be true, verdict correct, and score at least 0.96.
- For story prompts, grade use of required words, understandable Greek, and relevance. Do not require perfection.
- For reading questions, accept short answers if they show comprehension.
- Include greekCorrection when the learner wrote Greek; otherwise null.
- Feedback, shortReason, and betterAnswer commentary should follow the response language preference. Keep betterAnswer itself in the target answer language when it is an answer key.`,
      tools: [getLessonOverviewTool, searchLessonWordsTool],
    });

    if (!output) throw new Error('Scoring returned no output.');
    if (exact) {
      return {
        ...output,
        accepted: true,
        verdict: 'correct' as const,
        score: Math.max(output.score, 0.96),
        betterAnswer: output.betterAnswer || input.exercise.expectedAnswer,
        shortReason: output.shortReason || 'Exact match',
      };
    }
    return output;
  },
);

const yiayiaChatFlow = getAI().defineFlow(
  {
    name: 'yiayiaChat',
    inputSchema: YiayiaChatInputSchema,
    outputSchema: z.string(),
    streamSchema: z.string(),
  },
  async (input, { sendChunk }) => {
    const preferences = normalizePreferences(input.preferences);
    const messages = input.messages.map((message) => ({
      role: message.role === 'assistant' ? ('model' as const) : ('user' as const),
      content: [{ text: message.content }],
    }));
    const exerciseContext = input.exercise
      ? `Current exercise:
Type: ${input.exercise.type}
Prompt: ${input.exercise.prompt}
Question: ${input.exercise.question || ''}
Required words: ${input.exercise.requiredWords.join(', ')}
Visible vocabulary: ${input.exercise.vocabulary.map((item) => `${item.greek}=${item.english}`).join(', ')}`
      : '';

    const model = input.aiModel === 'flash' ? GAME_GENERATION_MODEL : YIAYIA_CHAT_MODEL;
    const { stream } = await getAI().generateStream({
      model,
      system: [
        YIAYIA_SYSTEM,
        preferenceContext(preferences),
        `Lesson: ${input.lessonId} ${input.lessonTitle}`,
        exerciseContext,
      ].join('\n\n'),
      messages,
      tools: [getLessonOverviewTool, searchLessonWordsTool, getExerciseCoverageTool],
    });

    let fullText = '';
    for await (const chunk of stream) {
      const text = chunk.text;
      if (text) {
        fullText += text;
        if (sendChunk) sendChunk(text);
      }
    }
    return fullText;
  },
);

export const generateLessonGames = onCallGenkit(
  {
    secrets: [GOOGLE_GENAI_API_KEY],
    cors: true,
    timeoutSeconds: 300,
    memory: '1GiB',
  },
  generateLessonGamesFlow,
);

export const scoreGameAnswer = onCallGenkit(
  {
    secrets: [GOOGLE_GENAI_API_KEY],
    cors: true,
    timeoutSeconds: 120,
    memory: '512MiB',
  },
  scoreGameAnswerFlow,
);

export const yiayiaChat = onCallGenkit(
  {
    secrets: [GOOGLE_GENAI_API_KEY],
    cors: true,
    timeoutSeconds: 120,
    memory: '512MiB',
  },
  yiayiaChatFlow,
);
