# AI Config & Admin Page

## Goal

Move every model/temperature/decoding-parameter decision out of code and into a single Firestore doc that the admin can edit live. The current app hardcodes four model names at the top of `functions/src/index.ts` — changing one means a redeploy. After this rewrite, the admin flips a dropdown and the next Genkit call uses the new model within 60 seconds.

## The Config Document

Single doc: `/ai_config/main`. Singleton; no other docs in the `ai_config` collection.

```typescript
{
  models: {
    // One entry per AI surface. The key is referenced from code as `getModelFor('courseGen')`.
    courseGen: ModelChoice,           // course meta + lesson outline
    lessonGen: ModelChoice,           // lesson overview + vocab batch + game prompts
    planGen: ModelChoice,             // plan meta + per-widget
    gameScoring: ModelChoice,         // grading user answers
    yiayiaChat: ModelChoice,          // conversational tutor
    yiayiaAdmin: ModelChoice,         // admin tool-use chat (may need stronger model)
    embeddings: ModelChoice,          // for RAG (when added)
  },

  // Per-feature decoding overrides. Keyed by the same surface names.
  decoding: {
    [surface: string]: {
      temperature?: number,
      maxOutputTokens?: number,
      topK?: number,
      topP?: number,
    }
  },

  // Toggles for experiments. Surfaces read these directly.
  features: {
    streamingPlans: boolean,           // widget-by-widget plan generation
    ragForPlans: boolean,              // use embeddings to pick relevant vocab
    diversifyGames: boolean,           // pass previouslyGenerated digests
  },

  updatedAt: Timestamp,
  updatedBy: string,                   // email or 'admin-page' or 'migration'
}

type ModelChoice = {
  provider: 'googleai',                // expandable later
  model: string,                       // e.g. 'gemini-3.1-flash-lite-preview'
  // Optional: pin to a specific Genkit plugin path. If absent, derived from provider+model.
  genkitId?: string,                   // e.g. 'googleai/gemini-3.1-flash-lite-preview'
};
```

## Default Values (seeded on first deploy)

Per rework.md, default everything to flash-lite-3.1-preview:

```typescript
{
  models: {
    courseGen:    { provider: 'googleai', model: 'gemini-3.1-flash-lite-preview' },
    lessonGen:    { provider: 'googleai', model: 'gemini-3.1-flash-lite-preview' },
    planGen:      { provider: 'googleai', model: 'gemini-3.1-flash-lite-preview' },
    gameScoring:  { provider: 'googleai', model: 'gemini-3.1-flash-lite-preview' },
    yiayiaChat:   { provider: 'googleai', model: 'gemini-3.1-flash-lite-preview' },
    yiayiaAdmin:  { provider: 'googleai', model: 'gemini-3.1-flash-lite-preview' },
    embeddings:   { provider: 'googleai', model: 'text-embedding-004' },
  },
  decoding: {
    // Empty by default — Genkit defaults apply.
  },
  features: {
    streamingPlans: true,
    ragForPlans: false,            // off until embeddings index is built
    diversifyGames: true,
  },
  updatedAt: <serverTimestamp>,
  updatedBy: 'seed',
}
```

The seed is written by an idempotent step in the migration script (`scripts/migrate_to_fanari.mjs`) and by an init step in `functions/src/ai/configResolver.ts` (defensive — if the doc somehow doesn't exist when a function reads it, the resolver writes the default and continues).

## Resolver — function side

`functions/src/ai/configResolver.ts`:

```typescript
import { getFirestore } from 'firebase-admin/firestore';
import type { DocumentData } from 'firebase-admin/firestore';

const CACHE_TTL_MS = 60_000;
let cached: { data: DocumentData; expiresAt: number } | null = null;

export async function getAIConfig(): Promise<DocumentData> {
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  const snap = await getFirestore().doc('ai_config/main').get();
  if (!snap.exists) {
    // Defensive seed (idempotent — use transaction so concurrent functions don't fight)
    await seedDefaults();
    return getAIConfig();
  }
  cached = { data: snap.data()!, expiresAt: Date.now() + CACHE_TTL_MS };
  return cached.data;
}

export async function getModelFor(surface: string): Promise<string> {
  const cfg = await getAIConfig();
  const choice = cfg.models?.[surface];
  if (!choice) throw new Error(`No AI config for surface "${surface}"`);
  return choice.genkitId ?? `${choice.provider}/${choice.model}`;
}

export async function getDecodingFor(surface: string) {
  const cfg = await getAIConfig();
  return cfg.decoding?.[surface] ?? {};
}

export async function getFeatureFlag(name: string): Promise<boolean> {
  const cfg = await getAIConfig();
  return Boolean(cfg.features?.[name]);
}

export function invalidateAIConfigCache() {
  cached = null;
}
```

**Cache invalidation:** an `onWrite` trigger on `ai_config/main` calls `invalidateAIConfigCache()` immediately for the current instance. Other warm instances will pick up the change within 60s naturally. (Cross-instance invalidation could use a Pub/Sub fanout, but for this workload it's overkill.)

**Usage in a generation function:**

```typescript
const model = await getModelFor('courseGen');
const decoding = await getDecodingFor('courseGen');
const response = await ai.generate({
  model,
  config: decoding,
  prompt,
  output: { schema: CourseMetaSchema },
});
```

## Admin Page (frontend)

Route: `/admin/ai`. No auth for now (consistent with the rest of the app); add `?key=` querystring check later when adding auth is easier.

**Layout:**

- Top: "AI Configuration" header, "Last updated: ${updatedAt} by ${updatedBy}", "Reset to defaults" button.
- Middle: one card per surface (courseGen, lessonGen, planGen, gameScoring, yiayiaChat, yiayiaAdmin, embeddings):
  - Surface name + short description ("Used when generating a new course's title, description, and lesson outline.")
  - Provider dropdown (currently only `googleai`).
  - Model dropdown — hardcoded list of supported models, with a "Custom…" option that lets you type a model ID:
    - `gemini-3.1-flash-lite-preview` (default)
    - `gemini-3.1-flash-preview`
    - `gemini-3.1-pro-preview`
    - `gemini-3.5-flash`
    - `gemini-3-flash-preview`
    - `gemini-3-pro-preview`
    - `gemini-2.5-flash`
    - `gemini-2.5-pro`
  - Optional decoding overrides (temperature, maxOutputTokens, topK, topP) — collapsed by default.
- Below: feature flags as toggles (streamingPlans, ragForPlans, diversifyGames).
- Save: any change writes `{ ...newConfig, updatedAt: serverTimestamp(), updatedBy: 'admin-page' }` to `ai_config/main`. The admin sees a toast: "Saved. Functions will pick up changes within 60s."

**Live preview / dry-run:** future enhancement — a "Test this surface" button that fires a small Genkit call from a callable function using the current config without writing anything to Firestore. Out of scope for this phase.

**Reactivity:** the admin page uses `onSnapshot` on `ai_config/main` so two browser tabs editing simultaneously show each other's changes (last-write-wins for the doc, which is fine for an admin tool).

## File / Code Layout

```
functions/src/
  ai/
    configResolver.ts        # getAIConfig, getModelFor, getDecodingFor, getFeatureFlag, cache
    seedDefaults.ts          # one-time seed function called by migration + defensive on read miss
    genkitClient.ts          # singleton Genkit ai object (lifted from fanariotes pattern)
  triggers/
    onAIConfigWritten.ts     # onWrite trigger: clears in-memory cache

web/src/routes/admin/ai/
  +page.svelte               # the admin page
  modelOptions.ts            # the dropdown choices
```

## Surfaces Catalog

For reference, when adding a new generation flow, add a `models[surface]` entry here and create a corresponding key in the seeded defaults:

| Surface | Used by | Notes |
|---------|---------|-------|
| `courseGen` | `onCourseWritten` trigger — course meta + lesson outline | |
| `lessonGen` | `onLessonWritten` trigger — overview + vocab batch + games | |
| `planGen` | `onPlanWritten` trigger — plan meta + per-widget calls | Per-widget calls all use the same surface; can be split later if needed. |
| `gameScoring` | `scoreGameAnswer` callable — grades user's answer | Lowest-stakes call; cheapest model is fine. |
| `yiayiaChat` | `yiayiaChat` callable — student-facing tutor | Streaming response. |
| `yiayiaAdmin` | `yiayiaChat` callable when `adminMode: true` | May need tool-calling capability; not every model supports it equally. |
| `embeddings` | RAG indexing & retrieval (when `ragForPlans` is on) | Different family; not interchangeable with chat models. |

## Open Decisions

- **Per-call cost guardrails.** Should we cap monthly cost per surface in the config and have the function refuse calls if blown? Skip for now — single power user, low traffic, and Gemini pricing is forgiving at flash-lite tier.
- **A/B testing.** Could store two model choices per surface and pick randomly for comparison. Skip for now; the admin page is fast enough to manually swap.
- **Per-user model overrides.** Once auth exists, a user setting could override `models.yiayiaChat` for that user. Out of scope.
