# Generation Lineage & Bulk Revert

## Goal

Every AI-written doc carries the ID of the generation that created it. The `generations/{generationId}` doc holds a manifest of every doc affected. The Yiayia admin can ask, "remove everything Plan 7 generated for course X" — and we delete exactly those docs, atomically.

This is the safety net that lets us be aggressive about creating material immediately (no modals, no confirmation steps). The undo is one Yiayia command away.

## The Generation Document

`/generations/{generationId}`:

```typescript
{
  id: string,
  kind: 'course' | 'lesson' | 'plan' | 'plan_widget' | 'game_batch' | 'entry_batch'
        | 'yiayia_edit' | 'legacy_import' | 'manual_admin',
  parentDoc?: string,             // e.g. 'courses/everyday-greek/lessons/l3'
  parentGenerationId?: string,    // chain — a lesson's gen is a child of its course's gen

  sourcePrompt?: string,          // the user-facing trigger (course prompt, custom focus, yiayia message)
  trigger: {
    kind: 'user_action' | 'cascade' | 'yiayia_admin' | 'migration',
    description: string,          // human-readable; shown in admin UI
  },

  status: 'pending' | 'streaming' | 'done' | 'error' | 'reverted',
  statusLog: Array<{ at: Timestamp, message: string, source: 'system' | 'model' }>,
  error?: string,

  modelUsed?: string,             // resolved Genkit ID for the primary call
  modelsUsed?: string[],          // all surfaces hit (for multi-step generations)
  tokensIn?: number,
  tokensOut?: number,
  latencyMs?: number,

  manifest: Array<{
    path: string,                 // 'courses/c1/lessons/l3/plans/p2'
    action: 'create' | 'update' | 'arrayUnion',
    field?: string,               // for update/arrayUnion: which field
    before?: any,                 // snapshot of prior value (for update/arrayUnion only) — bounded
    addedValue?: any,             // for arrayUnion: the appended value (so revert removes just that item)
  }>,

  createdAt: Timestamp,
  completedAt?: Timestamp,
  revertedAt?: Timestamp,
  revertedBy?: string,
}
```

**Manifest size:** for a full course generation (1 course + 10 lessons + 10×150 entries + 10×25 games + 10×1 plan = ~1700 docs), the manifest is ~1700 entries × ~80 bytes = 140KB. Comfortably under Firestore's 1MB doc limit. For larger generations, the manifest is split — the trigger writes additional `generations/{parentId}/parts/{n}` subcollection docs once the main doc nears 800KB.

**Pruning `before`:** for `update` and `arrayUnion` actions, we store enough state to revert. For a widget arrayUnion, `addedValue` is the widget itself. For a status update, `before` is the prior status string. We don't snapshot whole entry docs on update — entries are immutable in normal flow.

## `generationId` on Affected Docs

Every doc that an AI generation creates carries `generationId: string` as a top-level field. Every doc *modified* by a generation gets the `generationId` appended to a `generationHistory: string[]` field (capped at the last 10).

The reverse lookup (find every doc with `generationId = X`) is supported via collection-group queries — `firestore.indexes.json` includes a `generationId` index on each child collection:

```json
{ "collectionGroup": "entries", "queryScope": "COLLECTION_GROUP",
  "fields": [{ "fieldPath": "generationId", "order": "ASCENDING" }] },
{ "collectionGroup": "plans", "queryScope": "COLLECTION_GROUP",
  "fields": [{ "fieldPath": "generationId", "order": "ASCENDING" }] },
{ "collectionGroup": "games", "queryScope": "COLLECTION_GROUP",
  "fields": [{ "fieldPath": "generationId", "order": "ASCENDING" }] },
{ "collectionGroup": "lessons", "queryScope": "COLLECTION_GROUP",
  "fields": [{ "fieldPath": "generationId", "order": "ASCENDING" }] }
```

This means revert has **two** ways to find affected docs: the manifest (precise, includes arrayUnion items), and the collection-group query (handy as a safety check / for orphan cleanup).

## Generation ID Convention

```
gen_<kind>_<ulid>
```

e.g. `gen_lesson_01HZX9NMR5PTYB3W6QK4D7VFEA`. ULIDs are lexicographic-sortable by time, which makes admin listings nice. Use a lightweight ULID generator in `functions/src/ai/genId.ts`.

For legacy imports, the kind is `legacy_import`. For Yiayia admin operations, the kind is `yiayia_edit`.

## Lifecycle

### Creation

When a trigger starts work:

```typescript
const genId = createGenerationId('course');
const genRef = db.doc(`generations/${genId}`);
await genRef.set({
  id: genId,
  kind: 'course',
  parentDoc: `courses/${courseId}`,
  sourcePrompt,
  trigger: { kind: 'user_action', description: `Course generation: "${sourcePrompt.slice(0, 60)}"` },
  status: 'streaming',
  statusLog: [{ at: Timestamp.now(), message: 'Generation started', source: 'system' }],
  manifest: [],
  createdAt: Timestamp.now(),
});
```

### Recording writes

A helper wraps every write inside a trigger:

```typescript
async function recordedSet(genRef, docRef, data, kind: 'create' | 'update' = 'create') {
  const dataWithGen = { ...data, generationId: genRef.id };
  await docRef.set(dataWithGen, kind === 'update' ? { merge: true } : {});
  await genRef.update({
    manifest: FieldValue.arrayUnion({
      path: docRef.path,
      action: kind,
    }),
  });
}

async function recordedArrayUnion(genRef, docRef, field, value) {
  await docRef.update({
    [field]: FieldValue.arrayUnion(value),
    generationHistory: FieldValue.arrayUnion(genRef.id),
  });
  await genRef.update({
    manifest: FieldValue.arrayUnion({
      path: docRef.path,
      action: 'arrayUnion',
      field,
      addedValue: value,
    }),
  });
}
```

### Completion

When the trigger finishes:

```typescript
await genRef.update({
  status: 'done',
  completedAt: Timestamp.now(),
  statusLog: FieldValue.arrayUnion({
    at: Timestamp.now(), message: 'Generation complete', source: 'system'
  }),
  modelsUsed: Array.from(modelsUsedSet),
  tokensIn, tokensOut, latencyMs: Date.now() - startedAt,
});
```

### Error

```typescript
await genRef.update({
  status: 'error',
  error: err.message,
  statusLog: FieldValue.arrayUnion({
    at: Timestamp.now(), message: `Error: ${err.message}`, source: 'system'
  }),
});
```

Errored generations are not auto-reverted — they're preserved so the admin can inspect what was partially written.

## Revert

Triggered via a Yiayia admin command (`/revert <generationId>`) or directly from the admin UI on the generation list page.

A callable function `revertGeneration({ generationId })`:

1. Reads `generations/{id}`. If `status === 'reverted'`, return idempotent success.
2. Writes `status: 'reverting'` to lock out concurrent reverts.
3. For each manifest entry, in **reverse order** (so children are removed before parents):
   - `action: 'create'` → delete the doc at `path`.
   - `action: 'update'` → restore prior fields from `before` (or do nothing if `before` is absent and the field was append-only).
   - `action: 'arrayUnion'` → use `FieldValue.arrayRemove(addedValue)` on the field.
4. **Belt-and-braces:** also run collection-group queries `where('generationId', '==', id)` for `lessons`, `entries`, `plans`, `games` and delete any matches not in the manifest (catches orphans from a partially-failed generation).
5. Cascade cleanup: if the reverted generation was a course-level `kind: 'course'`, find child generations (`where('parentGenerationId', '==', id)`) and revert them recursively. Otherwise just revert the leaf.
6. Update parent doc counts and lessonSummaries via the normal trigger paths (deletes fire `onLessonChildCountChange` etc.).
7. Mark `status: 'reverted'`, `revertedAt`, `revertedBy: 'yiayia-admin' | 'admin-ui' | email`.

The revert is intentionally **not undoable**. After revert, the docs are gone. If preserving content for undo is needed later, we'd add a soft-delete tombstone collection.

## Yiayia Admin Surface

New admin tools (added to the existing `adminListEntities` / `adminApplyChanges` setup in current `functions/src/index.ts:303-687`):

| Tool | Purpose |
|------|---------|
| `listRecentGenerations({ limit, kind?, status? })` | Paginated list of recent generations for the admin's mental model. |
| `previewGeneration({ generationId })` | Returns the manifest summary — count by collection, sample of 5 paths, status, modelsUsed. |
| `revertGeneration({ generationId, confirm: true })` | Performs the revert above. Requires `confirm: true` to prevent the model from doing it casually. |
| `findGenerationsForDoc({ path })` | Given a doc path, list all generations in its `generationHistory`. Useful for "who created this widget?" |
| `revertGenerationsBy({ filter })` | Bulk revert by predicate (`kind: 'plan'`, `createdAt: <date>`, etc.). Requires explicit list of generation IDs in the confirmation step. |

**Safety:** the model is prompted to always show the user the result of `previewGeneration` before calling `revertGeneration`. The Yiayia prompt explicitly states "never call revertGeneration without first calling previewGeneration in the same turn and getting user confirmation."

## Admin UI

A new page at `/admin/generations` (linked from `/admin/ai`):

- Table: most recent generations first, columns: kind, sourcePrompt (truncated), parentDoc, status, model, tokens, latency, createdAt.
- Click a row → detail page with full manifest, status log, "Revert" button (with confirmation modal showing what will be deleted).
- Filter by kind / status / date.

## Migration & Backfill

The legacy import (`scripts/migrate_to_fanari.mjs`) creates one `generations/{legacy-import-...}` doc that holds the manifest of every doc copied over. Reverting it cleanly removes the import — useful if we want to re-run the migration.

## Open Decisions

- **How long to keep generations?** All of them, forever, for now — the dataset is small. If `generations` grows unwieldy, add a TTL cleanup at 90 days for `status: 'done'` records with no children.
- **What about generations triggered by the `onPlanWritten` for a single plan generated under a course-level generation?** They have `parentGenerationId` set. Reverting the course also reverts each plan generation. Reverting just one plan leaves the course generation intact.
- **Yiayia conversation as a generation?** Yes — each Yiayia message that produced edits gets a `kind: 'yiayia_edit'` generation with a manifest. Pure-chat messages (no edits) don't create a generation. This means "undo what Yiayia just did" is a one-liner: `revertGeneration` on the most recent `yiayia_edit`.
