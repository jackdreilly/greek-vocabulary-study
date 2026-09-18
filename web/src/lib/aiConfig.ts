export const SURFACES = [
  "courseGen",
  "lessonGen",
  "planGen",
  "gameScoring",
  "yiayiaChat",
  "yiayiaAdmin",
  "usageGen",
  "embeddings",
] as const;

export type Surface = (typeof SURFACES)[number];

export type ModelChoice = {
  provider: "googleai";
  model: string;
  genkitId?: string;
};

export type Decoding = {
  temperature?: number;
  maxOutputTokens?: number;
  topK?: number;
  topP?: number;
};

export type AIConfig = {
  models: Record<Surface, ModelChoice>;
  decoding: Record<string, Decoding>;
  features: Record<string, boolean>;
  updatedAt?: unknown;
  updatedBy?: string;
};

const flashLite: ModelChoice = {
  provider: "googleai",
  model: "gemini-3.5-flash-lite",
};

export const DEFAULT_AI_CONFIG: AIConfig = {
  models: {
    courseGen: flashLite,
    lessonGen: flashLite,
    planGen: flashLite,
    gameScoring: flashLite,
    yiayiaChat: flashLite,
    yiayiaAdmin: flashLite,
    usageGen: flashLite,
    embeddings: { provider: "googleai", model: "text-embedding-004" },
  },
  decoding: {},
  features: {
    streamingPlans: true,
    ragForPlans: false,
    diversifyGames: true,
    contentGeneration: true,
  },
};

export const MODEL_OPTIONS = [
  "gemini-3.5-flash-lite",
  "gemini-3.8-flash",
  "text-embedding-004",
] as const;

export const SURFACE_COPY: Record<Surface, string> = {
  courseGen: "Course title, description, and lesson outline.",
  lessonGen: "Lesson overview, vocabulary, and generated practice material.",
  planGen: "Textbook-style plans and widget-by-widget generation.",
  gameScoring: "Short-answer grading and feedback.",
  yiayiaChat: "Student-facing tutor conversation.",
  yiayiaAdmin: "Admin-mode tutor tools and generation management.",
  usageGen: "Three level-appropriate sentence usages for flashcards.",
  embeddings: "Embedding model for retrieval features.",
};

export const FEATURE_COPY: Record<string, string> = {
  streamingPlans: "Render plan widgets as they are generated.",
  ragForPlans: "Use retrieval context when planning lessons.",
  diversifyGames: "Avoid repeating prior generated exercises.",
  contentGeneration: "Show AI content generation controls (courses, lessons, vocab, games, plans).",
};
