/**
 * Default AI config — seeded into `ai_config/main` on first read.
 * Per docs/vision.md, every surface defaults to
 * gemini-3.5-flash-lite.
 */
const flashLite = { provider: "googleai", model: "gemini-3.5-flash-lite" };

export const DEFAULT_AI_CONFIG = {
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
  },
} as const;
