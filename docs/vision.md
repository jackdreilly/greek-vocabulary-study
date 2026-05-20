# Greekflash — Vision & Architecture

This is the orientation doc for greekflash: the *why* behind the design and a
map of how the shipped app actually works. It supersedes the old
`docs/rewrite/` series (the rewrite has landed) and the legacy app reference.
Read this first; then read the code, which is the source of truth for details.

Greekflash turns a vocabulary prompt ("everyday Greek for ordering at a
taverna") into a generated, browsable course: lessons, vocabulary, practice
games, and textbook-style study plans, with an AI tutor ("Yiayia") on every
page. The whole content tree is AI-generated and reactive — you watch it fill
in live.

Project: **`fanari-b6bb4`** (Firebase, isolated to greekflash). Single
`(default)` Firestore database. `web/` is a Svelte 5 + Vite SPA; `functions/`
is TypeScript Cloud Functions (v2) using Genkit + Gemini.

---

## Core principles

These are the load-bearing ideas. Everything else follows from them.

1. **Firestore is the bus.** The client never calls a function that "returns
   the data." It writes a stub document with `status: "initializing"`, then
   listens via `onSnapshot`. A Firestore trigger does the heavy AI work and
   streams results back into the same doc (and its subcollections). The UI
   re-renders as the data lands. Callables exist only for request/response work
   that isn't content generation (grading an answer, a chat reply, a revert).

2. **Stream, don't spin.** Big generations are broken into small steps; each
   step writes its result the moment it's ready. A `statusLog[]` array on the
   doc gets appended as work progresses. The user sees partial content with a
   quiet indicator, never a blocking spinner over an empty page.

3. **Subcollections mirror the hierarchy.** `courses → lessons → (entries |
   plans | games)`. Cross-cutting reads use `collectionGroup`. Listings are
   cheap because each course denormalizes a `lessonSummaries` map and `counts`,
   kept in sync by triggers — rendering a course's lesson list is one doc read.

4. **Model selection is data, not code.** Every AI call resolves its model and
   decoding params from `ai_config/main` at call time (with a ~60s in-memory
   cache). Changing a model is an edit in the admin page, not a redeploy.

5. **Every AI-written doc carries `generationId`.** A `generations/{id}` record
   holds a manifest of everything a generation created, so any generation can
   be reverted in bulk. This safety net is what lets the app create content
   aggressively (write first, undo later) instead of gating behind modals.

6. **De-emphasize totals; content is the hero.** Counts are computed and stored
   but surfaced sparingly. One job per page; navigation (routes, tabs, drawers)
   carries the rest.

7. **Always develop against the local emulator.** Never debug UI/trigger state
   against production. See AGENTS.md for the exact commands.

---

## The content model

### Document shapes (current)

`/courses/{courseId}`
- `id, title, subtitle?, description?, sourcePrompt?, language {source,target}`
- `skillLevel?` (CEFR-style A1…C2 — calibrates all generated content)
- `status: "initializing" | "streaming" | "ready" | "error"`, `statusLog[]`, `error?`
- `generationId?`
- `lessonSummaries: { [lessonId]: { title, subtitle?, order, status, entryCount, planCount, gameCount } }` (denormalized; trigger-maintained)
- `counts: { lessons, entries, plans, games }`
- `createdAt, updatedAt`

`/courses/{cid}/lessons/{lid}`
- core fields + `courseId` (FK for collectionGroup), `order`, `overview?` (markdown + embedded Greek words), `skillLevel?`, status machine, `counts: { entries, plans, games }`.

`/courses/{cid}/lessons/{lid}/entries/{eid}`
- `lemma, article?, english, senses[], examples?[{el,en}], category?, order, generationId?`. Entries are effectively immutable (change = delete+recreate). Audio for a word may live in Storage; the entry holds the path.

`/courses/{cid}/lessons/{lid}/plans/{pid}`
- `planNumber, title, subtitle?, estimatedMinutes?, coveredWords[], coveredConcepts[]`, status machine, `widgets[]` (appended incrementally during streaming). Widgets are a tagged union (see below).

`/courses/{cid}/lessons/{lid}/games/{gid}`
- `type, prompt, expectedAnswer?, acceptableAnswers?[], requiredWords?[], vocabulary?[], direction?, passage?, question?, rubric?, sourceEntryIds[]`.

`/ai_config/main` — singleton config doc (see "AI as data").

`/generations/{generationId}` — lineage manifest (see "Generation lineage").

### Generation batches — a deviation worth knowing

The design originally generated entries and games "inline" inside the lesson
trigger. The shipped app instead uses intermediate **batch documents** —
`vocabBatches` and `gameBatches` subcollections under a lesson. The client (or
the lesson trigger) writes a batch stub with a status; a trigger
(`onVocabBatchWritten` / `onGameBatchWritten`) generates the batch's contents
and fans them out into the `entries` / `games` subcollections. The batch is the
unit of generation **and retry** — a failed batch flips back to a retryable
status without throwing away the rest of the lesson. Keep this in mind: the
generation surface for vocab/games is the batch doc, not the lesson directly.

### Plan widgets

A plan is a sequence of typed widgets the renderer hydrates into rich UI.
Renderers live in `web/src/lib/widgets/` (`WidgetRenderer.svelte` + `types/`).
Widget types: `heading`, `prose`, `callout` (pattern/history/etymology/tip/
cultural/mnemonic), `vocab_table`, `conjugation_table` (with interactive
practice mode), `comparison_table`, `reading_passage`, `dialogue`, `mini_quiz`,
`fill_in_blanks`, `word_tree`. To add one: extend the Zod schema in
`functions/src/schemas/plan.ts`, teach the plan-generation prompt the new
type's contract, add a renderer under `widgets/types/`, and wire it into
`WidgetRenderer`.

---

## Triggers & AI orchestration

The architectural heart: **AI work is driven by Firestore triggers, not
callables.** Triggers live in `functions/src/triggers/`.

**Status state machine** (every generatable doc):
`initializing` (client wrote a stub) → `streaming` (trigger claimed it, writing
pieces) → `ready` | `error`. Revert adds a transient `reverting`.

**Transactional claim.** A trigger claims a doc in a transaction (only proceeds
if status is still `initializing`), so retries and concurrent invocations don't
double-run. `statusLog[]` is appended as progress is made (pruned to stay
bounded).

**Genkit primitives** (`functions/src/ai/`): generation runs through Genkit
flows/`generate` calls with **Zod-typed structured output** (no free-text
parsing). Tools let the model pull context (lesson words, prior plans) instead
of pre-packing prompts. Streaming structured output is what makes widgets and
entries appear one at a time. Each call resolves model + decoding via the
config resolver (below) and records telemetry on the generation doc.

**Trigger map (shipped):** `onCourseWritten`, `onLessonWritten`,
`onPlanWritten`, `onVocabBatchWritten`, `onGameBatchWritten`, `onEntryWritten`
(count cascades), `onAIConfigWritten` (cache invalidation). Course generation
writes lesson stubs (each fires `onLessonWritten`); lesson generation writes
vocab/game batch stubs and an initial plan stub — generation cascades down the
tree.

**Counts & summaries** are denormalized upward by cascade triggers: child
writes bump lesson `counts`; lesson changes propagate into the course's
`lessonSummaries` and `counts`. Simple transactional counters — fine at this
scale.

---

## AI as data — `ai_config/main`

One Firestore doc decides which model and decoding params every AI surface
uses. Resolver: `functions/src/ai/configResolver.ts` (`getModelFor(surface)`,
`getDecodingFor(surface)`, `getFeatureFlag(name)`), with a ~60s cache;
`onAIConfigWritten` clears the cache on edit. Defaults live in
`functions/src/ai/defaults.ts` and are seeded defensively if the doc is missing.

**Surfaces** (the keys code asks for): `courseGen`, `lessonGen`, `planGen`,
`gameScoring`, `yiayiaChat`, `yiayiaAdmin`, `embeddings`. Admin page:
`/admin/ai` (`web/src/routes/AdminAI.svelte`) edits the doc live via
`onSnapshot`. When you add a generation surface, add its `models[surface]` key
and a default.

---

## Generation lineage & revert

Every AI-written doc carries `generationId`; `generations/{id}` holds a
manifest of every doc/field the generation touched (`create` / `update` /
`arrayUnion`), plus model/token/latency telemetry and a status. The revert
callable (`functions/src/callables/revertGeneration.ts`) walks the manifest in
reverse — deleting creates, `arrayRemove`ing unions, clearing `generationId` on
updates — with belt-and-braces collection-group sweeps for orphans, then
recomputes parent counts. Revert is reachable from the admin generations UI and
via Yiayia's admin tools. The legacy data import is itself one generation, so
the whole migration is revertible in one click.

Admin surface: `/admin`, `/admin/generations` (index, filters),
`/admin/generations/{id}` (detail + Revert). Yiayia admin tools live in
`functions/src/admin/` (`tools.ts`, `lineage.ts`, `search.ts`, `cascade.ts`)
and are prompted to always preview before reverting.

---

## UI & design system

**Aesthetic:** clean, near-monochrome (white surfaces, slate text, one blue
accent), generous whitespace, one job per page. Greek text is distinguished by
**font** (serif) and **size**, not color. Status colors (green ready / amber
generating / red error) are semantic only.

**Routing** is a tiny custom regex router (`web/src/lib/router.svelte.ts`) — no
SvelteKit. Routes:
- `/` — courses index (`routes/Home.svelte`)
- `/c/{cid}` — course landing, lesson list (`routes/Course.svelte`)
- `/c/{cid}/l/{lid}/{tab}` — lesson, tab ∈ `overview|vocab|cards|games|plans`
  (`routes/Lesson.svelte` + `routes/lesson/*Tab.svelte`); a bare lesson URL
  redirects to a sensible default tab
- `/c/{cid}/l/{lid}/plans/{pid}` — single plan, focus-mode reader (`routes/Plan.svelte`)
- `/admin`, `/admin/ai`, `/admin/generations`, `/admin/generations/{id}`

**Components & helpers** live in `web/src/lib/ui/` (Card, StatusPill,
Breadcrumb, Link, GreekText, MarkdownBody, GenerateModal, SkillLevelPicker,
AudioPlayButton, …). Reactive data subscriptions are in
`web/src/lib/data/*.svelte.ts` (`courses`, `lessons`, `plans`, `generations`,
`aiConfig`) and write helpers in `web/src/lib/data/create*.ts`.

**Yiayia** is the AI tutor surfaced in the header (`YiayiaPanel.svelte`), with
an admin variant (`YiayiaAdminPanel.svelte`) that can drive the lineage/revert
tools. It captures the current page context (course/lesson/plan) automatically.

**Content-generation gating.** Every generation entry point (new course /
lesson / vocab / games / plan) is gated behind the `contentGeneration` feature
flag in `ai_config/main` and uses the shared `GenerateModal`. This is currently
a client-side UI hint; it becomes a hard server gate when auth lands (see
below). Note this is a pragmatic deviation from the original "no modals, write a
stub and navigate" ideal — the modal collects the prompt + skill level, then
writes the stub.

---

## Future trajectory (not built yet)

The schema and lineage design are shaped so these don't require a retrofit:

- **Auth & roles** (Firebase Auth custom claims): Admin / Teacher / Student.
  When it lands, `contentGeneration` becomes a real server gate (rules +
  callable guards verifying a `canGenerate` claim), `ai_config` writes restrict
  to admins, and Yiayia's admin mode maps to the admin role.
- **Multi-school tenancy.** Global/curated content stays at top-level
  `courses/{cid}`; school-private content can live under
  `schools/{sid}/courses/{cid}` with identical doc shapes. `generations` already
  carries `createdBy`, extensible to `{ userId, role, schoolId }`. No per-user
  writes ever go into the content tree — student progress will live elsewhere.
- **Progress features** (flashcard SRS, game score history, streaks) are
  explicitly **not** implemented in this phase.
- **RAG for plans** (embeddings to pick relevant vocab) is scaffolded as a
  feature flag, off by default.

---

## Where the operational details live

Local emulator workflow, deploy pipeline, and function-deploy specifics are in
**[AGENTS.md](../AGENTS.md)** (the always-loaded agent guide). This doc is the
conceptual map; AGENTS.md is the runbook.
