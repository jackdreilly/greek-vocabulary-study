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
const PLAN_GENERATION_MODEL = 'googleai/gemini-3-flash-preview';
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
  id: z.number(),
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
  prompt: z.string().catch(''),
  instructions: z.string().catch(''),
  expectedAnswer: z.string().catch(''),
  acceptableAnswers: z.array(z.string()).catch([]),
  direction: z.enum(['greek_to_english', 'english_to_greek', 'free_response']).catch('free_response'),
  passage: z.string().optional(),
  question: z.string().optional(),
  requiredWords: z.array(z.string()).catch([]),
  vocabulary: z
    .array(
      z.object({
        greek: z.string(),
        english: z.string(),
      }),
    )
    .catch([]),
  sourceEntryIds: z.array(z.number()).catch([]),
  coverage: z
    .object({
      summary: z.string(),
      words: z.array(z.string()),
      themes: z.array(z.string()),
    })
    .catch({
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
  exercise: GameExerciseSchema.nullish(),
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
      sampleLimit: z.number().min(0).max(20).optional().default(10),
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
      query: z.string().optional().default(''),
      category: z.string().optional().default(''),
      limit: z.number().min(1).max(50).optional().default(12),
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
      perTypeLimit: z.number().min(1).max(20).optional().default(8),
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
      config: { maxOutputTokens: 8192 },
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

const PlanWidgetTypeSchema = z.enum([
  'heading',
  'prose',
  'callout',
  'vocab_table',
  'conjugation_table',
  'comparison_table',
  'reading_passage',
  'dialogue',
  'mini_quiz',
  'word_tree',
  'fill_in_blanks',
]);

const QuizQuestionSchema = z.object({
  question: z.string(),
  options: z.array(z.string()),
  answerIndex: z.number().int(),
  explanation: z.string().catch(''),
});

const TableRowSchema = z.object({
  label: z.string().catch(''),
  cells: z.array(z.string()),
});

const PlanWidgetSchema = z.object({
  type: PlanWidgetTypeSchema,

  // heading: { level: 1-3, text }
  level: z.number().int().optional(),
  text: z.string().optional(),

  // prose: { body } (plain prose or light markdown: **bold**, *italic*, simple lists)
  body: z.string().optional(),

  // callout: { calloutKind, title, body }
  calloutKind: z
    .enum(['pattern', 'history', 'etymology', 'tip', 'cultural', 'mnemonic'])
    .optional(),
  title: z.string().optional(),

  // vocab_table: a clean reference table of lesson words
  vocabEntries: z
    .array(
      z.object({
        greek: z.string(),
        article: z.string().optional(),
        english: z.string(),
        example: z.string().optional(),
      }),
    )
    .optional(),

  // conjugation_table & comparison_table: { lemma?, tense?, columns, rows, notes? }
  lemma: z.string().optional(),
  tense: z.string().optional(),
  columns: z.array(z.string()).optional(),
  rows: z.array(TableRowSchema).optional(),
  notes: z.string().optional(),

  // reading_passage: { title?, greek, english, glossary? }
  greek: z.string().optional(),
  english: z.string().optional(),
  glossary: z
    .array(z.object({ greek: z.string(), english: z.string() }))
    .optional(),

  // dialogue: { title?, setting?, lines: [{ speaker, greek, english }] }
  setting: z.string().optional(),
  lines: z
    .array(
      z.object({
        speaker: z.string(),
        greek: z.string(),
        english: z.string().catch(''),
      }),
    )
    .optional(),

  // mini_quiz: { title, questions: [{ question, options, answerIndex, explanation }] }
  questions: z.array(QuizQuestionSchema).optional(),

  // fill_in_blanks: { title, instructions, blankItems: [{ sentence (with "___"), answer, english }] }
  instructions: z.string().optional(),
  blankItems: z
    .array(
      z.object({
        sentence: z.string(),
        answer: z.string(),
        english: z.string().catch(''),
      }),
    )
    .optional(),

  // word_tree: a root word with derived/related branches
  rootGreek: z.string().optional(),
  rootEnglish: z.string().optional(),
  rootGloss: z.string().optional(),
  branches: z
    .array(
      z.object({
        greek: z.string(),
        english: z.string(),
        relation: z.string().catch(''),
      }),
    )
    .optional(),
});

const LessonPlanSchema = z.object({
  id: z.string(),
  lessonId: z.number(),
  planNumber: z.number().int(),
  title: z.string(),
  subtitle: z.string().catch(''),
  estimatedMinutes: z.number().int().catch(8),
  coveredWords: z.array(z.string()).catch([]),
  coveredConcepts: z.array(z.string()).catch([]),
  widgets: z.array(PlanWidgetSchema),
});

const PreviousPlanSummarySchema = z.object({
  planNumber: z.number().int().min(1),
  title: z.string(),
  subtitle: z.string().default(''),
  coveredWords: z.array(z.string()).default([]),
  coveredConcepts: z.array(z.string()).default([]),
});

const GenerateLessonPlanInputSchema = z.object({
  lessonId: z.number(),
  lessonTitle: z.string(),
  planNumber: z.number().int().min(1).default(1),
  previousPlans: z.array(PreviousPlanSummarySchema).max(50).default([]),
  entries: z.array(LessonEntrySchema).max(160).default([]),
  preferences: LearningPreferencesSchema.default({ responseLanguage: 'english', cefrLevel: 'A2' }),
  customFocus: z.string().max(5000).default(''),
});

const GenerateLessonPlanOutputSchema = z.object({
  plan: LessonPlanSchema,
});

const generateLessonPlanFlow = getAI().defineFlow(
  {
    name: 'generateLessonPlan',
    inputSchema: GenerateLessonPlanInputSchema,
    outputSchema: GenerateLessonPlanOutputSchema,
  },
  async (input) => {
    const preferences = normalizePreferences(input.preferences);
    const previousList = input.previousPlans.length
      ? input.previousPlans
          .map(
            (plan) =>
              `Plan #${plan.planNumber} "${plan.title}" — concepts: [${plan.coveredConcepts.join(
                ', ',
              )}]; words: [${plan.coveredWords.join(', ')}]`,
          )
          .join('\n')
      : '(none yet)';

    const customFocusLine = input.customFocus?.trim()
      ? `\nUSER-REQUESTED FOCUS: "${input.customFocus.trim()}" — prioritise this angle when choosing the plan's theme.`
      : '';

    const prompt = `Design Plan #${input.planNumber} for lesson ${input.lessonId}: ${input.lessonTitle}.${customFocusLine}

A "Plan" is a 1–2 textbook-page pedagogical module woven from lesson vocabulary. It must feel
like reading a beautifully designed language textbook — engaging, structured, and varied —
while staying anchored to the lesson's actual vocab. Every plan is one focused theme/angle.

Learner preferences:
${preferenceContext(preferences)}

PREVIOUSLY GENERATED PLANS for this lesson (DO NOT REPEAT their concepts or word focus):
${previousList}

WORKFLOW:
1. Call getLessonOverview to scan the lesson and pick an UNCOVERED angle (a thematic cluster,
   a grammar pattern, a verb family, a register, a register/cultural slice…).
2. Call searchLessonWords with targeted queries/categories to pull the exact words you need
   for this plan's theme. Aim for 12–24 lesson words at the heart of the plan.
3. Call getExerciseCoverage if useful to avoid overlap with practice exercises.
4. Compose 6–12 widgets that flow like a coherent textbook section.

WIDGET TYPES (use a varied mix, NOT all of one kind):
- heading: { type, level (2|3), text } — section dividers; start with a level-2 heading.
- prose: { type, body } — explanatory paragraphs. Light markdown allowed (**bold**, *italic*,
   simple "- " bullet lists). Keep paragraphs tight (≤4 sentences each).
- callout: { type, calloutKind, title, body } — kinds: pattern (grammar/morphology rule),
   history (≤2 sentences of brief historical/etymological context), etymology, tip, cultural,
   mnemonic. Use sparingly: at most 1 history and 1 etymology per plan.
- vocab_table: { type, title, vocabEntries: [{ greek, article?, english, example? }] }
   Grouped reference of key words for this plan. 6–12 rows. Examples should be a 3–6 word Greek phrase.
- conjugation_table: { type, title, lemma, tense?, columns, rows: [{ label, cells }], notes? }
   For verbs: columns like ["Singular","Plural"], rows labeled "1st / εγώ", "2nd / εσύ", etc.
   For nouns: columns like ["Singular","Plural"], rows labeled "Nominative", "Genitive", "Accusative", "Vocative".
   Only include if the lemma genuinely has the relevant paradigm in Modern Greek.
- comparison_table: { type, title, columns, rows, notes? } — side-by-side contrasts
   (e.g. masculine vs feminine vs neuter forms, formal vs informal register).
- reading_passage: { type, title, greek, english, glossary?: [{ greek, english }] }
   A 4–8 sentence Greek passage using the plan's target vocab in realistic context. Provide a
   natural English translation. Glossary holds 4–10 trickier words from the passage.
- dialogue: { type, title, setting?, lines: [{ speaker, greek, english }] } — a 4–10 line
   short conversation. Speakers should be named (e.g. "Μαρία", "Δάσκαλος").
- mini_quiz: { type, title, questions: [{ question, options (2–4), answerIndex, explanation }] }
   3–5 multiple-choice questions that test the plan's content. Mix Greek->English, English->Greek,
   meaning-in-context, and pattern recognition. Explanations should teach, not just confirm.
- word_tree: { type, rootGreek, rootEnglish, rootGloss?, branches: [{ greek, english, relation }] }
   Center on a productive root (e.g. γράφ-, μαθ-) and show derived words from the lesson + close cousins.
   relation = short label like "verb", "agent noun", "adjective", "abstract noun".
- fill_in_blanks: { type, title, instructions, blankItems: [{ sentence, answer, english }] }
   Interactive 3–5 cloze items. Sentence MUST contain "___" exactly once where the answer goes.
   Answer is the surface form that fills the blank.

PEDAGOGY (BE INVENTIVE):
- Lead with a hook (a vivid prose paragraph or short scene-setting passage), not a dry definition.
- Tie words together by SHARED ROOT, SHARED SEMANTIC FIELD, or SHARED PATTERN — never a random pile.
- Whenever you teach a pattern, immediately follow with a callout (kind=pattern) crystallising it,
   then a small interactive widget (quiz or fill_in_blanks) that USES that pattern.
- For verb-heavy plans include exactly one conjugation_table for a representative verb.
- For noun-heavy plans consider a comparison_table contrasting genders/cases.
- Include at most one tiny historical_context or etymology callout: 1–2 sentences, e.g. the
   Ancient root behind a modern word. Never more than 2 historical/etymology callouts total.
- Add at least one truly INTERACTIVE widget (mini_quiz or fill_in_blanks). At least one.
- End with a "wrap-up" mini_quiz OR a short reflection prose paragraph.

OUTPUT RULES:
- Return JSON matching the schema exactly. No extra keys, no markdown wrapper.
- id must be "l${input.lessonId}-plan-${input.planNumber}".
- lessonId = ${input.lessonId}, planNumber = ${input.planNumber}.
- coveredWords: list the Greek lemmas (no articles) this plan focuses on (8–24 entries).
- coveredConcepts: short tags describing the angles you covered (e.g. "present tense -ω verbs",
   "classroom objects", "agent nouns -της", "diminutives -ακι"). 3–8 tags.
- estimatedMinutes: realistic reading + interaction time (typically 6–12).
- Total prose+passage word count should land near 350–700 words of reading material
   (this is the "1–2 textbook pages" target).
- Honor responseLanguage for instructional/explanatory text (prose, callouts, glossary,
   instructions, explanations). Greek target content (passages, dialogue lines greek field,
   table cells with Greek forms, vocab entries) always stays Greek.

Small fallback vocabulary sample (use the tools for the real list):
${entrySummary(input.entries.slice(0, 40)) || '(use the tools)'}`;

    const { output } = await getAI().generate({
      model: PLAN_GENERATION_MODEL,
      output: { schema: GenerateLessonPlanOutputSchema },
      config: { maxOutputTokens: 16384 },
      system:
        'You design beautiful, structured Modern Greek lesson plans as JSON only. Each plan is one coherent textbook-style module woven from lesson vocabulary. Be inventive, varied, and pedagogically tight. Prefer targeted tool calls over relying on the small fallback sample.',
      prompt,
      tools: [getLessonOverviewTool, getExerciseCoverageTool, searchLessonWordsTool],
    });

    if (!output) throw new Error('Plan generation returned no output.');
    return output;
  },
);

const VocabSuggestionSchema = z.object({
  lemma: z.string(),
  article: z.string().nullable().catch(null),
  english_senses: z.array(z.string()),
  category: z.string().catch('Ουσιαστικά'),
  notes: z.string().catch(''),
});

const GenerateVocabSuggestionsInputSchema = z.object({
  lessonId: z.number(),
  lessonTitle: z.string(),
  prompt: z.string().max(500),
  existingLemmas: z.array(z.string()).max(300).default([]),
});

const GenerateVocabSuggestionsOutputSchema = z.object({
  suggestions: z.array(VocabSuggestionSchema),
});

const generateVocabSuggestionsFlow = getAI().defineFlow(
  {
    name: 'generateVocabSuggestions',
    inputSchema: GenerateVocabSuggestionsInputSchema,
    outputSchema: GenerateVocabSuggestionsOutputSchema,
  },
  async (input) => {
    const existingList = input.existingLemmas.length
      ? `\nDo NOT include any of these already-existing words: ${input.existingLemmas.slice(0, 100).join(', ')}`
      : '';

    const { output } = await getAI().generate({
      model: GAME_GENERATION_MODEL,
      output: { schema: GenerateVocabSuggestionsOutputSchema },
      config: { maxOutputTokens: 8192 },
      system: 'You are a Modern Greek vocabulary expert. Generate accurate, learner-friendly Greek vocabulary entries as JSON.',
      prompt: `Generate Modern Greek vocabulary entries for a lesson called "${input.lessonTitle}" (lesson ${input.lessonId}).

User request: ${input.prompt}${existingList}

Rules:
- lemma: the dictionary form (nominative singular for nouns, infinitive/1st-person-singular for verbs)
- article: Greek article (ο, η, το) for nouns, null for verbs/adjectives/other
- english_senses: 1–4 clear, concise English meanings. Prefer specific definitions over vague ones.
- category: one of Ουσιαστικά (nouns), Ρήματα (verbs), Επίθετα (adjectives), Εκφράσεις (phrases/expressions)
- notes: optional short note about usage, register, or form (leave empty string if none)

How many entries to return:
- If the user asks for a specific word or two, return just those (1–2 entries).
- If the user asks for a large set or a broad topic, return up to 100 entries.
- If unclear, return around 20 entries.
Include only high-quality, accurate entries.`,
    });

    if (!output) throw new Error('Vocab generation returned no output.');
    return output;
  },
);

const GenerateLessonContentInputSchema = z.object({
  prompt: z.string().max(600),
  courseName: z.string().max(200).default(''),
  existingLessonTitles: z.array(z.string()).max(60).default([]),
  generateCourseName: z.boolean().default(false),
});

const GenerateLessonContentOutputSchema = z.object({
  lessonTitle: z.string(),
  courseName: z.string().catch(''),
  entries: z.array(VocabSuggestionSchema),
});

const generateLessonContentFlow = getAI().defineFlow(
  {
    name: 'generateLessonContent',
    inputSchema: GenerateLessonContentInputSchema,
    outputSchema: GenerateLessonContentOutputSchema,
  },
  async (input) => {
    const existingLine = input.existingLessonTitles.length
      ? `\nExisting lessons in this course (do NOT duplicate them): ${input.existingLessonTitles.slice(0, 40).join('; ')}`
      : '';
    const courseNameLine = input.courseName
      ? `\nCourse: "${input.courseName}"`
      : '';
    const courseNameRequest = input.generateCourseName
      ? '\nAlso generate a concise course name (3–6 words) that describes this collection of lessons.'
      : '';

    const { output } = await getAI().generate({
      model: GAME_GENERATION_MODEL,
      output: { schema: GenerateLessonContentOutputSchema },
      config: { maxOutputTokens: 8192 },
      system: 'You are a Modern Greek curriculum designer. Create well-structured lesson content with accurate vocabulary as JSON.',
      prompt: `Design a new Modern Greek vocabulary lesson.${courseNameLine}${existingLine}${courseNameRequest}

User request: ${input.prompt}

Rules:
- lessonTitle: a clear, descriptive title (4–8 words), e.g. "At the Restaurant: Ordering Food"
- courseName: ${input.generateCourseName ? 'a short, clear course name describing the overall theme (3–6 words)' : 'leave as empty string ""'}
- entries: 100–200 words. Each entry:
  - lemma: dictionary form (nominative singular for nouns, 1st-person present for verbs)
  - article: ο / η / το for nouns, null for verbs/adjectives/other
  - english_senses: 1–4 concise English meanings
  - category: Ουσιαστικά | Ρήματα | Επίθετα | Εκφράσεις
  - notes: brief usage note or empty string

Return only vocabulary genuinely relevant to the request. Prioritise frequent, learner-useful words.`,
    });

    if (!output) throw new Error('Lesson generation returned no output.');
    return output;
  },
);

export const generateLessonContent = onCallGenkit(
  {
    secrets: [GOOGLE_GENAI_API_KEY],
    cors: true,
    timeoutSeconds: 90,
    memory: '512MiB',
  },
  generateLessonContentFlow,
);

export const generateVocabSuggestions = onCallGenkit(
  {
    secrets: [GOOGLE_GENAI_API_KEY],
    cors: true,
    timeoutSeconds: 60,
    memory: '512MiB',
  },
  generateVocabSuggestionsFlow,
);

const AiAssistVocabEntryInputSchema = z.object({
  lemma: z.string(),
  article: z.string().nullable().default(null),
  currentSenses: z.array(z.string()).default([]),
  prompt: z.string().max(500),
});

const AiAssistVocabEntryOutputSchema = z.object({
  english_senses: z.array(z.string()),
});

const aiAssistVocabEntryFlow = getAI().defineFlow(
  {
    name: 'aiAssistVocabEntry',
    inputSchema: AiAssistVocabEntryInputSchema,
    outputSchema: AiAssistVocabEntryOutputSchema,
  },
  async (input) => {
    const articleDisplay = input.article ? `${input.article} ` : '';
    const { output } = await getAI().generate({
      model: GAME_GENERATION_MODEL,
      output: { schema: AiAssistVocabEntryOutputSchema },
      system: 'You are a Modern Greek vocabulary editor. Update English definitions for Greek words as JSON.',
      prompt: `Greek word: ${articleDisplay}${input.lemma}
Current English definitions: ${input.currentSenses.length ? input.currentSenses.map((s, i) => `${i + 1}. ${s}`).join('; ') : '(none)'}

User request: ${input.prompt}

Return an updated list of English definitions (english_senses array). Keep definitions concise and accurate. 1–6 entries.`,
    });

    if (!output) throw new Error('AI assist returned no output.');
    return output;
  },
);

export const aiAssistVocabEntry = onCallGenkit(
  {
    secrets: [GOOGLE_GENAI_API_KEY],
    cors: true,
    timeoutSeconds: 30,
    memory: '256MiB',
  },
  aiAssistVocabEntryFlow,
);

export const generateLessonPlan = onCallGenkit(
  {
    secrets: [GOOGLE_GENAI_API_KEY],
    cors: true,
    timeoutSeconds: 300,
    memory: '1GiB',
  },
  generateLessonPlanFlow,
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
