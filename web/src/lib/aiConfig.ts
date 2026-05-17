export const SURFACES = [
  "courseGen",
  "lessonGen",
  "planGen",
  "gameScoring",
  "yiayiaChat",
  "yiayiaAdmin",
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
  model: "gemini-3.1-flash-lite-preview",
};

export const DEFAULT_AI_CONFIG: AIConfig = {
  models: {
    courseGen: flashLite,
    lessonGen: flashLite,
    planGen: flashLite,
    gameScoring: flashLite,
    yiayiaChat: flashLite,
    yiayiaAdmin: flashLite,
    embeddings: { provider: "googleai", model: "text-embedding-004" },
  },
  decoding: {},
  features: {
    streamingPlans: true,
    ragForPlans: false,
    diversifyGames: true,
  },
};

export const MODEL_OPTIONS = [
  "gemini-3.1-flash-lite-preview",
  "gemini-3.1-flash-preview",
  "gemini-3.1-pro-preview",
  "gemini-3-flash-preview",
  "gemini-3-pro-preview",
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "text-embedding-004",
] as const;

export const SURFACE_COPY: Record<Surface, string> = {
  courseGen: "Course title, description, and lesson outline.",
  lessonGen: "Lesson overview, vocabulary, and generated practice material.",
  planGen: "Textbook-style plans and widget-by-widget generation.",
  gameScoring: "Short-answer grading and feedback.",
  yiayiaChat: "Student-facing tutor conversation.",
  yiayiaAdmin: "Admin-mode tutor tools and generation management.",
  embeddings: "Embedding model for retrieval features.",
};

export const FEATURE_COPY: Record<string, string> = {
  streamingPlans: "Render plan widgets as they are generated.",
  ragForPlans: "Use retrieval context when planning lessons.",
  diversifyGames: "Avoid repeating prior generated exercises.",
};
