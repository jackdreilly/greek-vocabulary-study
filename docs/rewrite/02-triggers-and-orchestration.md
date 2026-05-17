# Triggers & AI Orchestration

The single most important architectural shift in this rewrite: **AI work is driven by Firestore triggers, not callable functions.** The client writes a stub doc with `status: 'pending'` (or `'initializing'`). A Cloud Function trigger picks it up, claims it via a transaction, runs the work in pieces, and streams results back into the same doc (or its children). The client is subscribed via `onSnapshot` the entire time and watches the doc fill in.

This is fanariotes' `translateSongEnglish` / `generateSongLesson` pattern applied across every generation surface.

## Universal Patterns

### Status state machine

Every doc that can be AI-generated uses the same status field:

```
initializing  ← client wrote a stub, trigger hasn't started
streaming     ← trigger has claimed the doc and is actively writing pieces
ready         ← generation complete
error         ← generation failed; `error` field has details
```

Plus terminal states added by the lineage layer (`04-generation-lineage.md`):

```
reverting     ← bulk-revert is deleting this doc as part of a generation revert
```

### Transactional claim

Triggers must be idempotent and race-safe. Pattern (lifted from fanariotes:functions/src/index.ts:4047-4064):

```typescript
const claimed = await db.runTransaction(async (tx) => {
  const snap = await tx.get(docRef);
  const data = snap.data();
  if (!data || data.status !== 'initializing') return false;
  tx.update(docRef, {
    status: 'streaming',
    statusLog: FieldValue.arrayUnion({
      at: Timestamp.now(), message: 'Generation starting', source: 'system'
    }),
    updatedAt: Timestamp.now(),
  });
  return true;
});
if (!claimed) return;  // another invocation got it, or it's already done
```

### Status log streaming

`statusLog` is an array on the doc. Triggers append to it as they make progress:

```typescript
async function logStatus(docRef, message, source = 'system') {
  await docRef.update({
    statusLog: FieldValue.arrayUnion({ at: Timestamp.now(), message, source }),
    updatedAt: Timestamp.now(),
  });
}
```

To avoid log explosion, prune to last 50 entries when adding (a transaction reads the array and trims).

For long-running operations with no natural progress events, a parallel "heartbeat" promise can write a system message every ~15s with a fresh phrase like "still composing the lesson overview…" Fanariotes does this for variety.

### Incremental field writes

When a generation produces a list (entries in a lesson, widgets in a plan, lessons in a course), the trigger writes each item as soon as it's ready. Two strategies:

1. **Subcollection items** (entries, plans, games): write each as its own doc via `setDoc(parentRef.collection('entries').doc(id), ...)`. Frontend `onSnapshot` on the subcollection picks them up.
2. **Inline array items** (widgets in a plan): use `FieldValue.arrayUnion(widget)` to append. Watch out for duplicate-suppression behavior of `arrayUnion` — if two widgets are byte-identical, the second is silently dropped. Mitigate by giving each widget a unique `id` field.

### AI call orchestration — Genkit best practices

Each generation is **a sequence of small Genkit calls**, not one monolithic prompt. We use established Genkit primitives rather than rolling our own orchestration. The four patterns we lean on:

#### 1. Flows for the top-level orchestrator (`ai.defineFlow`)

Every trigger's AI work runs inside a Genkit Flow. Flows give us:

- A typed entry point with Zod-validated input/output schemas.
- Built-in tracing/observability in the Genkit Dev UI (`pnpm genkit:ui`) — invaluable for debugging multi-step generations.
- Streaming output via `streamingCallback` — the flow's intermediate values flow through to a callback we wire to status-log appends.
- A natural unit for retries: if a flow's call throws, we wrap the entire flow in a transactional retry inside the trigger.

```typescript
export const generateCourseFlow = ai.defineFlow(
  {
    name: 'generateCourse',
    inputSchema: GenerateCourseInputSchema,
    outputSchema: GenerateCourseOutputSchema,
    streamSchema: ProgressEventSchema,        // for streamingCallback
  },
  async (input, { sendChunk }) => {
    // ... orchestration body, with sendChunk() emitting progress events
  }
);
```

The trigger invokes the flow with `await generateCourseFlow.stream(input, { onChunk: (e) => logStatus(genRef, e.message) })`. Every emitted chunk becomes a `statusLog` append.

#### 2. Chat sessions for iterative refinement (`ai.chat()`)

Where a multi-step generation benefits from shared context across calls — e.g. drafting the course title, then iterating on subtitle and description in the model's "voice" — we use Genkit's chat API. The chat object maintains history automatically; each `send` includes the prior turns. This is **the** Genkit-recommended pattern for iterative work; we don't manually thread message arrays.

```typescript
const session = ai.createSession({ store: new FirestoreSessionStore(genId) });
const chat = session.chat({
  model: await getModelFor('courseGen'),
  system: 'You are a senior Greek-language curriculum designer. Each turn produces one focused artifact.',
});

const meta = await chat.send({
  prompt: `Draft a course title, subtitle, and description for: "${sourcePrompt}"`,
  output: { schema: CourseMetaSchema },
});

const outline = await chat.send({
  prompt: 'Now propose 8–15 lessons. Each lesson is one focused theme with a title, subtitle, short description, and an order.',
  output: { schema: LessonOutlineSchema },
});
```

`FirestoreSessionStore` persists chat state under `generations/{genId}/session/messages` so a function-cold-start mid-flow can resume rather than restart. (Implementation: a small adapter implementing Genkit's `SessionStore` interface against Firestore. ~50 lines.)

#### 3. Tools for context retrieval (`ai.defineTool`)

When the model needs to pull context (existing entries, prior plans, source vocabulary), it calls tools rather than us pre-packing everything into the prompt. This matches the current `yiayiaChat` admin pattern and is **the** Genkit-recommended way for any retrieval-augmented work.

```typescript
const getLessonEntries = ai.defineTool(
  {
    name: 'getLessonEntries',
    description: 'Returns the vocabulary entries of a lesson, optionally filtered by category.',
    inputSchema: z.object({
      lessonId: z.string(),
      category: z.string().optional(),
      limit: z.number().int().min(1).max(120).default(60),
    }),
    outputSchema: z.array(EntrySummarySchema),
  },
  async ({ lessonId, category, limit }) => {
    // Firestore query, return slim entry records
  }
);

const result = await ai.generate({
  model: await getModelFor('planGen'),
  prompt: `Pick an angle for a new plan in lesson ${lessonId} that hasn't been covered.`,
  tools: [getLessonEntries, getExistingPlans, searchVocabBySemantic],
  output: { schema: PlanAngleSchema },
});
```

The model decides when to call each tool, Genkit handles the tool-call loop, we just observe via `streamingCallback` and append status-log entries like `"Looked up 40 verbs from lesson 3..."`.

#### 4. Streaming structured output (`ai.generateStream`)

For long single-call outputs (the rare case where a chat/tool flow doesn't fit), use `generateStream` and observe partial output:

```typescript
const { stream, response } = ai.generateStream({
  model: await getModelFor('lessonGen'),
  prompt: ...,
  output: { schema: VocabBatchSchema },
});
for await (const chunk of stream) {
  // Append-as-you-go: write incremental entries as the schema fills in
  await appendPartialEntries(lessonRef, chunk.output);
}
await response;  // final settled output (we already wrote it via the loop)
```

This is what makes "watch widgets appear one at a time" feel native — we don't wait for the full response, we write each appearing item the moment Genkit's stream emits it.

#### Cross-cutting per call

Every call (whether direct `generate`, a `chat.send`, or inside a `defineFlow`) goes through these helpers:

1. **Model resolution** via `getModelFor(surface)` (see `03-ai-config.md`). Resolver caches `ai_config/main` for 60s.
2. **Structured output** via Zod schemas. No free-form text parsing. Schemas live in `functions/src/schemas/`.
3. **Telemetry**: token counts and latency are recorded on the `generations/{id}` doc (see `04-generation-lineage.md`). Genkit's response object exposes `usage` and `latencyMs`; we extract and persist.
4. **Errors** bubble to the flow boundary; the flow catches, writes `status: 'error'` + `error` field on the target doc and on the generation doc, then re-throws so the trigger logs the failure.

#### Why this matters

We are not inventing new orchestration. Genkit ships with Flows, Sessions, Tools, and Streaming as first-class primitives — the same primitives Firebase's reference AI samples use. By leaning on them we get:

- Tracing in the Dev UI without extra code.
- Tested, idiomatic retry/streaming/tool-calling behavior.
- A clear migration path if we ever swap the underlying model provider (Genkit abstracts it).
- Less code to maintain ourselves.

#### Worked example: course generation

```typescript
export const generateCourseFlow = ai.defineFlow(
  { name: 'generateCourse', inputSchema, outputSchema, streamSchema: ProgressSchema },
  async ({ courseId, sourcePrompt }, { sendChunk }) => {
    sendChunk({ message: 'Drafting course title…' });

    const session = ai.createSession({ store: new FirestoreSessionStore(`courses/${courseId}/session`) });
    const chat = session.chat({
      model: await getModelFor('courseGen'),
      system: COURSE_DESIGNER_SYSTEM_PROMPT,
      tools: [searchVocabBySemantic],
    });

    const meta = await chat.send({
      prompt: `Course request: "${sourcePrompt}". Draft title, subtitle, description.`,
      output: { schema: CourseMetaSchema },
    });
    await writeCourseMeta(courseId, meta.output);

    sendChunk({ message: 'Sketching lessons…' });
    const outline = await chat.send({
      prompt: 'Propose 8–15 lessons covering this course, each a focused theme.',
      output: { schema: LessonOutlineSchema },
    });
    await writeLessonStubs(courseId, outline.output.lessons);

    return { courseId, lessonCount: outline.output.lessons.length };
  }
);
```

Each lesson stub write fires `onLessonWritten`, which runs its own `generateLessonFlow` — same patterns recursively.

### RAG / dedup

For generations that should avoid duplicating prior work in the same parent (e.g. a new plan that shouldn't cover the same angle as existing plans), pass a compact digest of prior siblings into the prompt:

- For plans: each prior plan contributes `{ title, coveredWords, coveredConcepts }`.
- For games of a given type: each prior game contributes `{ requiredWords, sourceEntryIds, prompt.substring(0,80) }`.
- For lessons: each prior lesson contributes `{ title, description }`.

These digests are pulled inside the trigger with one collection query, slimmed, and passed as a `previouslyGenerated` array in the Zod input schema. The prompt explicitly instructs the model to pick a different angle.

### Locking and de-dupe

Two safeguards prevent duplicate AI runs:

1. The transactional claim above (won't re-run an already-claimed doc).
2. **Function configuration:** `firebase-functions/v2/firestore.onDocumentCreated` triggers, with `concurrency: 1` per instance and a generous timeout (540s for big generations like a full course). Use the `eventId` from the CloudEvent to skip retries that have already been processed (store last `eventId` on the doc).

## Triggers

| Path | Trigger | Fires when |
|------|---------|-----------|
| `courses/{cid}` | `onCourseWritten` | `status` transitions to `'initializing'` |
| `courses/{cid}/lessons/{lid}` | `onLessonWritten` | `status` transitions to `'initializing'` |
| `courses/{cid}/lessons/{lid}/plans/{pid}` | `onPlanWritten` | `status` transitions to `'initializing'` |
| `courses/{cid}/lessons/{lid}` | `onLessonChildCountChange` | any write on entries/plans/games subcollections |
| `courses/{cid}/lessons/{lid}` | `onLessonSummaryChange` | lesson `title`/`order`/`status`/`counts` change |
| `courses/{cid}/lessons/{lid}/games/{gid}` | (none — games are generated inline by lesson trigger; status field unused) | — |
| `courses/{cid}/lessons/{lid}/entries/{eid}` | (none — entries are generated inline) | — |

Counts and summary cascades use `onDocumentWritten` with field-diff guards inside.

### `onCourseWritten` — full course generation

**Input:** `courses/{cid}` with `status: 'initializing'`, `sourcePrompt: string`.

**Sequence:**

1. Claim via transaction. If `sourcePrompt` is empty, mark `error: "no prompt"` and bail.
2. Open a `generations/{genId}` record, kind `'course'`, with `parentDoc: courses/{cid}`.
3. Heartbeat log: "Drafting course title…"
4. Genkit call: `generateCourseMeta(sourcePrompt)` → `{ title, subtitle, description }`. Write back to the course doc.
5. Heartbeat: "Sketching lessons…"
6. Genkit call: `generateLessonOutline(courseMeta)` → `{ lessons: [{ title, subtitle, description, order }] }`. Limit to 8–15 lessons.
7. For each lesson stub (concurrent within reason — batches of 3), write `courses/{cid}/lessons/{lid}` with `status: 'initializing'` and the stub fields. This triggers `onLessonWritten` for each.
8. Update course `counts.lessons` and `lessonSummaries` with the stubs (entryCount=0 etc. — these update later as lessons fill in).
9. Mark course `status: 'ready'`. The course itself is "done" even though lessons are still generating — the UI shows lesson cards filling in over the next few minutes.
10. Update `generations/{genId}.status = 'done'`, append manifest.

**Failure behavior:** any thrown error → catch at top, write `status: 'error'`, `error: <message>`. The `generations` doc gets `status: 'error'` and is preserved for forensic review.

### `onLessonWritten` — lesson contents generation

**Input:** `courses/{cid}/lessons/{lid}` with `status: 'initializing'`.

**Sequence:**

1. Claim via transaction.
2. Open a `generations/{genId}` record, kind `'lesson'`.
3. Read parent course's `title`/`description`/`sourcePrompt` for context.
4. Heartbeat: "Picking the right words for this lesson…"
5. Genkit call: `generateVocabBatch(courseContext, lessonContext, count: 30)` → array of `{ lemma, article, english, senses, category, examples }`.
6. Write each entry as a doc in `entries` subcollection. Each entry write triggers `onLessonChildCountChange` (which updates lesson counts).
7. Heartbeat: "Composing the lesson overview…"
8. Genkit call: `generateLessonOverview(courseContext, lessonContext, entries)` → array of widgets. Write to `lessons/{lid}.overview.widgets` and store `lessons/{lid}.overview.generationId`.
9. Heartbeat: "Crafting practice games…"
10. For each game type (5 types × 5 games each = 25 games), one Genkit call → 5 games. Write each as a doc in `games` subcollection. Pass `previouslyGenerated` from earlier game types so prompts diversify.
11. Heartbeat: "Building the first study plan…"
12. Write `plans/p1` with `status: 'initializing'` (triggers `onPlanWritten`). Subsequent plans are user-triggered, not auto-generated.
13. Mark lesson `status: 'ready'`.
14. Update `generations/{genId}.status = 'done'` with full manifest of every entry/game/plan-stub created.

### `onPlanWritten` — single plan generation

**Input:** `courses/{cid}/lessons/{lid}/plans/{pid}` with `status: 'initializing'`. May include a `customFocus` field if the user requested a specific angle.

**Sequence:**

1. Claim via transaction.
2. Open `generations/{genId}`, kind `'plan'`.
3. Pull prior plans for this lesson (`previouslyGenerated`).
4. Pull lesson entries; if `customFocus` is set, filter by RAG-style semantic match (or by keyword overlap) to ~40 most relevant words.
5. Heartbeat: "Choosing an angle…"
6. Genkit call: `generatePlanMeta(lessonContext, entries, previouslyGenerated, customFocus)` → `{ title, subtitle, estimatedMinutes, coveredWords, coveredConcepts, widgetOutline: ["heading","prose","vocab_table","conjugation_table","mini_quiz",...] }`. Write meta fields immediately.
7. For each widget in `widgetOutline`, one Genkit call generating that specific widget type. As each completes, `arrayUnion` it onto `widgets`. Status log message per widget: "Rendering the conjugation table…"
8. Mark plan `status: 'ready'`.
9. Close out the generation doc.

**Why widget-by-widget?** The legacy single-call plan generation often hit reliability issues — large structured outputs are where Gemini misbehaves most. Splitting per-widget lets a single broken widget retry without throwing away the whole plan. The user sees widgets appear one by one, which is the magical UX rework.md asks for.

### `onLessonChildCountChange` — count cascade

Watches `courses/{cid}/lessons/{lid}/entries/{eid}` (and similarly plans, games). On create/delete:

1. Read the lesson doc inside a transaction.
2. Increment/decrement the appropriate `counts.entries` (or plans/games).
3. Update `lessons/{lid}.updatedAt`.

Then trigger fires for the lesson update → `onLessonSummaryChange` propagates to the course's `lessonSummaries`.

For low write volume (which we have), simple transactional counters are fine. If write rates ever climb, we'd switch to the [distributed counter](https://firebase.google.com/docs/firestore/solutions/counters) pattern.

### `onLessonSummaryChange` — course summary cascade

Watches `courses/{cid}/lessons/{lid}` for changes to `title`, `subtitle`, `order`, `status`, `counts`. Updates `courses/{cid}.lessonSummaries[lid]` accordingly. Also recomputes `courses/{cid}.counts.{lessons,entries,plans,games}` (the latter three via summed reads of all lesson summaries — cheap since the map is right there).

Throttle: if multiple lessons update simultaneously, debounce by 2s via a marker doc to avoid lockstep on the parent.

## Frontend Reactivity (preview — full design in a future doc)

The frontend uses `onSnapshot` for everything:

- App startup: subscribe to `courses` collection (top-level).
- Course page: subscribe to the single course doc — `lessonSummaries` drives the lesson list.
- Lesson page:
  - Subscribe to the lesson doc (for title, statusLog, overview widgets).
  - Subscribe to the entries subcollection.
  - Subscribe to the plans subcollection.
  - Subscribe to the games subcollection.

All subscriptions auto-unsubscribe when navigating away. Persistent local cache (`persistentLocalCache` from Firebase v11 SDK) makes return visits instant.

When the user clicks "Generate course", the flow is:

1. Frontend: `setDoc(doc(db, 'courses', slugify(prompt)), { status: 'initializing', sourcePrompt, ... })`.
2. Frontend: immediately navigate to `/course/{cid}`.
3. The course page's `onSnapshot` is already active — it sees the doc appear (status=initializing), renders a "starting up" state.
4. Trigger fires, writes title/description back. The page now shows the real title.
5. Trigger writes lesson stubs. The lesson list populates one card at a time.
6. Each lesson card shows its own status; clicking one navigates to a lesson page that's still streaming in.

No spinners. No "please wait" modal. Real content from the first frame.
