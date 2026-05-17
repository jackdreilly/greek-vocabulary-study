# Schema & Migration

## Design Decisions

- **Single Firestore database** — `(default)` on project `fanari-b6bb4`. No more named-database split.
- **Subcollections for the natural hierarchy** — courses → lessons → (entries | plans | games). Cross-cutting queries use `collectionGroup`.
- **Summary denormalization** — each course holds a `lessonSummaries` map keyed by lesson ID, with just enough to render the lesson list without reading the subcollection. Triggers keep this in sync (`02-triggers-and-orchestration.md`).
- **Counts are denormalized** at every level. `courses.counts.{lessons,entries,plans,games}` and `lessons.counts.{entries,plans,games}`. Both maintained by triggers.
- **Every AI-written doc carries `generationId`** (see `04-generation-lineage.md`).
- **No `updatedAt` on individual entries** — entries are immutable once generated (any change is a delete+create with a new generationId). `createdAt` is enough.
- **Status fields drive triggers**: writing `status: 'pending'` triggers AI work; the trigger flips to `'streaming'` → `'ready'` or `'error'`. Rules allow only specific status transitions from the client (`firestore.rules`).

## Document Shapes

All shapes are written as TypeScript-style for clarity. These mirror what `functions/src/schemas/` will export as Zod schemas.

### `/courses/{courseId}`

```typescript
{
  id: string                            // matches doc ID
  title: string
  subtitle?: string
  description?: string                  // markdown
  sourcePrompt?: string                 // the user's original ask, if AI-generated
  language: { source: 'en', target: 'el' }  // future-proofing for non-Greek courses

  status: 'initializing' | 'streaming' | 'ready' | 'error'
  statusLog: Array<{ at: Timestamp, message: string, source: 'system' | 'model' }>
  error?: string

  generationId?: string                 // the generation that created this course

  // Denormalized — kept in sync by triggers
  lessonSummaries: {
    [lessonId: string]: {
      title: string
      subtitle?: string
      order: number
      status: 'initializing' | 'streaming' | 'ready' | 'error'
      entryCount: number
      planCount: number
      gameCount: number
    }
  }
  counts: { lessons: number, entries: number, plans: number, games: number }

  createdAt: Timestamp
  updatedAt: Timestamp                  // set on any trigger-driven update
}
```

**Why a summaries map vs a subcollection list?** Listing 30 lessons is fine as a subcollection read, but the course page renders that list on every visit. A single doc read with the summaries map embedded is cheaper and reactivity is trivial (one `onSnapshot` covers the whole listing). The map stays well under 1MB even for 200 lessons.

### `/courses/{courseId}/lessons/{lessonId}`

```typescript
{
  id: string
  courseId: string                      // FK back to parent for collectionGroup convenience
  title: string
  subtitle?: string
  description?: string
  sourcePrompt?: string
  order: number                         // sort order within course

  status: 'initializing' | 'streaming' | 'ready' | 'error'
  statusLog: Array<{ at, message, source }>
  error?: string

  overview?: {                          // optional rich overview, generated separately
    widgets: Widget[]                   // same widget schema as plans (see below)
    generationId: string
  }

  generationId?: string
  counts: { entries: number, plans: number, games: number }
  createdAt: Timestamp
  updatedAt: Timestamp
}
```

### `/courses/{courseId}/lessons/{lessonId}/entries/{entryId}`

```typescript
{
  id: string
  lessonId: string                      // FK for collectionGroup
  courseId: string                      // FK for collectionGroup
  lemma: string                         // e.g. "εξέταση"
  article?: string                      // "η" / "ο" / "το"
  english: string                       // canonical translation
  senses: string[]                      // alternate definitions
  examples?: Array<{ el: string, en: string }>
  category?: string                     // e.g. "verb", "noun_feminine"
  groupKey?: string                     // for grouping in vocab browser
  order: number
  generationId?: string
  createdAt: Timestamp
}
```

**Dropped from legacy `entries`:** `theme_id` (replaced by parent path), `frequency_rank`, `top5000_*`, `audio_*`, `dictionary_headword`, `entry_source`, `english_source`, `entry_source`, `form_suffixes`, `english_senses` (renamed to `senses`), `term`, `page`, `position_in_group`, `image`, `subsection`, `theme`, `translation_match`. These are scraper artifacts that the UI never reads.

### `/courses/{courseId}/lessons/{lessonId}/plans/{planId}`

```typescript
{
  id: string
  lessonId: string
  courseId: string
  planNumber: number
  title: string
  subtitle?: string
  estimatedMinutes?: number
  coveredWords: string[]
  coveredConcepts: string[]

  status: 'initializing' | 'streaming' | 'ready' | 'error'
  statusLog: Array<{ at, message, source }>
  widgets: Widget[]                     // appended incrementally during streaming
  error?: string

  generationId?: string
  createdAt: Timestamp
  updatedAt: Timestamp
}

type Widget =
  | { type: 'heading', level: 1|2|3, text: string }
  | { type: 'prose', markdown: string }
  | { type: 'callout', kind: 'pattern'|'history'|'etymology'|'tip'|'cultural'|'mnemonic', title?: string, markdown: string }
  | { type: 'vocab_table', rows: Array<{ el: string, en: string, example?: string }> }
  | { type: 'conjugation_table', headers: string[], rows: Array<{ form: string, cells: string[] }>, interactivePractice?: boolean }
  | { type: 'comparison_table', headers: string[], rows: string[][] }
  | { type: 'reading_passage', el: string, en: string, glossary?: Array<{ el: string, en: string }> }
  | { type: 'dialogue', lines: Array<{ speaker: string, el: string, en: string }> }
  | { type: 'mini_quiz', items: Array<{ q: string, options: string[], correctIndex: number, explanation?: string }> }
  | { type: 'fill_in_blanks', items: Array<{ sentence: string, answer: string, hint?: string }> }
  | { type: 'word_tree', root: { el: string, en: string }, branches: Array<{ el: string, en: string, relation: string }> }
```

### `/courses/{courseId}/lessons/{lessonId}/games/{gameId}`

```typescript
{
  id: string
  lessonId: string
  courseId: string
  type: 'missing_word' | 'reading_comprehension' | 'story_prompt' | 'sentence_translation' | 'word_translation'
  title?: string
  prompt: string
  expectedAnswer?: string
  acceptableAnswers?: string[]
  requiredWords?: string[]
  vocabulary?: Array<{ el: string, en: string }>
  sourceEntryIds: string[]
  direction?: 'el_to_en' | 'en_to_el'
  passage?: string
  question?: string
  rubric?: string
  generationId?: string
  createdAt: Timestamp
}
```

### `/ai_config/main` (singleton)

See `03-ai-config.md` for the full shape and admin UI.

### `/generations/{generationId}`

See `04-generation-lineage.md` for the full shape.

## Indexes (`firestore.indexes.json`)

Most reads are scoped to a parent (no index needed — Firestore's automatic per-collection indexes cover them). The cases that need explicit indexes:

```json
{
  "indexes": [
    { "collectionGroup": "entries", "queryScope": "COLLECTION_GROUP",
      "fields": [
        { "fieldPath": "courseId", "order": "ASCENDING" },
        { "fieldPath": "lemma", "order": "ASCENDING" }
      ] },
    { "collectionGroup": "entries", "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "order", "order": "ASCENDING" }
      ] },
    { "collectionGroup": "plans", "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "planNumber", "order": "ASCENDING" }
      ] },
    { "collectionGroup": "games", "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "type", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ] },
    { "collectionGroup": "generations", "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ] },
    { "collectionGroup": "generations", "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "kind", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ] }
  ],
  "fieldOverrides": []
}
```

No `fieldOverrides` to disable single-field indexes — none of the dropped legacy fields exist anymore. If a runtime field turns out to never be queried by, we can disable its automatic index later.

## Security Rules

The current rule (`allow read, write: if true`) is fine for an unauthenticated single-user app, but the rewrite tightens client writes to specific status transitions so a misbehaving client can't corrupt content:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Triggers run as admin and bypass rules; these only constrain the client.

    // Courses: client can create stubs (status='initializing') and request regeneration.
    match /courses/{courseId} {
      allow read: if true;
      allow create: if request.resource.data.status == 'initializing'
                    && request.resource.data.keys().hasOnly(
                         ['id','title','sourcePrompt','status','language','createdAt','generationId']
                       );
      allow update: if isStatusOnlyTransition() || isAdminLikeBenignUpdate();
      allow delete: if false;  // deletes happen via revert flow only

      match /lessons/{lessonId} {
        allow read: if true;
        allow create: if request.resource.data.status == 'initializing';
        allow update: if isStatusOnlyTransition() || isAdminLikeBenignUpdate();
        allow delete: if false;

        match /entries/{entryId} { allow read: if true; allow write: if false; }
        match /plans/{planId}    { allow read: if true;
          allow create: if request.resource.data.status == 'initializing';
          allow update: if isStatusOnlyTransition();
          allow delete: if false;
        }
        match /games/{gameId}    { allow read: if true; allow write: if false; }
      }
    }

    match /ai_config/{docId}    { allow read: if true; allow write: if true; }   // tighten when auth lands
    match /generations/{genId}  { allow read: if true; allow write: if false; } // trigger-only writes

    function isStatusOnlyTransition() {
      return request.resource.data.diff(resource.data).changedKeys().hasOnly(
        ['status', 'statusLog', 'error', 'updatedAt']
      );
    }
    function isAdminLikeBenignUpdate() {
      // Reserved for future auth — currently no clients hit this branch.
      return false;
    }
  }
}
```

Open question: until auth lands, `ai_config` is world-writable. That's the same risk as today; we accept it.

## Migration Script

`scripts/migrate_to_fanari.mjs` — one-shot, idempotent (safe to re-run).

**Source:** project `didibros-6d3ed`, `greek-vocab` DB for `courses`/`themes`/`entries`, `(default)` DB for `lesson_ai_plans`/`lesson_ai_exercises`.

**Target:** project `fanari-b6bb4`, `(default)` DB.

**Procedure:**

1. Open both source Firestores and the target Firestore using `@google-cloud/firestore`.
2. Generate one root `generationId = 'legacy-import-' + ISO8601` and write the `generations/{id}` manifest doc with `kind: 'legacy_import'`, `status: 'pending'`.
3. For each `courses/{courseId}` in source `greek-vocab`:
   - Map fields → new course shape. Set `status: 'ready'` (the import isn't AI work).
   - For each `theme` where `theme.course == courseId` (or via `themes/{id}.courseId`):
     - Map theme → lesson. `order = theme.lessonOrder ?? theme.lessonNumber ?? listIndex`.
     - For each `entry` where `entry.theme_id == theme.id`:
       - Map entry → new entry. Drop unused fields (see "Dropped from legacy" above).
     - For each `lesson_ai_plans` doc where `lessonId == theme.id`: map → plan.
     - For each `lesson_ai_exercises` doc where `lessonId == theme.id`: map → game.
   - Build `lessonSummaries` map; compute `counts` from what was just written.
4. Every written doc gets `generationId: <legacy-import-id>` and contributes a manifest entry to the generation doc.
5. Update `generations/{id}.status = 'done'`, write `completedAt`.

**Idempotency:** the script tracks progress in a local `.migration-progress.json` and skips already-written docs. On re-run, it resumes. Verify counts at the end; print a summary.

**Verification:**

- Course count matches source.
- For each course, lesson count matches.
- For each lesson, entry/plan/game counts match.
- Spot-check 3 random docs for field fidelity.

**Revertibility:** if anything looks wrong, run `scripts/revert_generation.mjs --id <legacy-import-id>` — every doc with that `generationId` is deleted in one pass. (See `04-generation-lineage.md`.)

## Outstanding Decisions

- **Lesson IDs as numbers vs strings.** Current schema uses numeric `theme_id`. New schema should use strings (Firestore-friendly, allows non-numeric custom IDs). Migration assigns `lessonId = 'l' + theme.id` to preserve a stable identifier.
- **Course IDs.** Existing courses already use string IDs (e.g. `"everyday-greek"`). Keep them as-is — they're slugs, which is ideal.
- **Entry IDs.** Current numeric entry IDs are useless globally; reassign to a stable slug like `<lemma-slug>-<short-hash>` so URLs are readable.
