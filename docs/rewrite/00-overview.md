# Greekflash Rewrite — Overview

This directory contains the design for the from-scratch greekflash rewrite. The current app works but has accumulated rigidity: hardcoded models, no Firestore triggers, one-shot `getDocs` everywhere, modal-driven AI flows, and a split-database hangover from when the project shared a Firebase project with the fanariotes lyrics app.

The rewrite is a **hard cutover** — no backwards compatibility, no parallel running app. New backend, new schema, new reactivity model. Content (courses / lessons / vocab / plans / games) is migrated; user progress is **not reimplemented at all** in this phase.

## Principles

1. **Firestore is the bus.** Frontend writes status docs directly; triggers do the heavy lifting; the frontend re-renders from `onSnapshot`. No callable function returns "the data" — it just kicks something off, and the frontend learns about the result by listening to the right document.
2. **No modals for AI generation.** A "create a course" button writes a stub doc, navigates immediately to the half-built course, and the user watches it fill in. If the user doesn't like the result, they revert via the generation log (see `04-generation-lineage.md`).
3. **Streaming everywhere.** Big AI calls are broken into smaller steps; each step writes its result to Firestore the moment it's available. Status arrays (`statusLog[]`) get appended every few seconds so the UI shows live progress.
4. **Subcollections match hierarchy.** Courses → lessons → (entries, plans, games). Queries that span lessons use `collectionGroup`.
5. **Model selection is data, not code.** Every Cloud Function reads `ai_config/main` before each Genkit call (with a short in-memory cache). The admin page edits this doc live.
6. **Generation lineage is first-class.** Every AI-written doc carries `generationId`. The `generations/{id}` record holds a manifest of every doc the generation created so it can be reverted in bulk via a Yiayia admin command.
7. **De-emphasize totals.** Counts are computed via triggers and stored on parent docs, but rendered sparingly in the UI. Don't show "327 entries" or "5 plans" everywhere — show them only where contextually useful.
8. **Reads are cheap; writes are bursty.** The dataset is small (~30 courses × ~30 lessons × ~150 entries ≈ low six-figures of docs total). Read-side optimization focuses on summary denormalization (lesson summaries on the course doc) so listings are 1-read. Write-side optimization focuses on smart locking inside triggers to prevent duplicate work.

## Project Setup

**Backend Firebase project:** `fanari-b6bb4` — isolated, dedicated to greekflash (no longer shared with the fanariotes lyrics app). Any previous data in this project may be deleted as part of the cutover.

**Database:** Single `(default)` Firestore database. The old `greek-vocab` named-database split goes away.

**Repo layout** (mirrors fanariotes):

```
greekflash/
  web/                  # Svelte 5 + Vite frontend
    src/
      lib/
        firebase.ts     # init, onSnapshot helpers
        types.ts        # shared TypeScript shapes
      routes/...
    package.json
  functions/            # Firebase Functions (TypeScript)
    src/
      index.ts          # entrypoint, exports triggers + callables
      schemas/          # Zod schemas (per-collection + per-AI-call)
      triggers/         # one file per trigger group
      ai/               # Genkit setup, model resolver, RAG helpers
      admin/            # Yiayia admin tools
    package.json
  scripts/              # migration + import scripts
  docs/rewrite/         # ← you are here
  firestore.rules
  firestore.indexes.json
  firebase.json
  .firebaserc
  package.json          # pnpm workspace root
  .github/workflows/
    deploy.yml          # full deploy on push to main
```

**Package manager:** pnpm workspaces (matches fanariotes; needed for the `web/` + `functions/` split).

**Node:** v24 (matches fanariotes).

## Document Index

Read in order — each builds on the previous.

| # | Doc | What it covers |
|---|-----|----------------|
| 01 | [Schema & migration](01-schema-and-migration.md) | Subcollection tree, document shapes, indexes, security rules, migration script outline |
| 02 | [Triggers & AI orchestration](02-triggers-and-orchestration.md) | Cloud Function triggers, status streaming, locking, RAG/dedup, count cascades |
| 03 | [AI config & admin page](03-ai-config.md) | `ai_config/main` doc shape, function-side resolver with cache, admin UI |
| 04 | [Generation lineage](04-generation-lineage.md) | `generationId` convention, `generations/{id}` manifest, bulk-revert via Yiayia |
| 05 | [Deploy pipeline](05-deploy-pipeline.md) | GitHub Actions full-deploy workflow (hosting + functions + rules + indexes) |
| 06 | [UI & design system](06-ui-and-design-system.md) | Visual language, page hierarchy, navigation, components, what to de-emphasize |

## Migration Scope (this phase)

**In scope — copy to new project, rekeyed under the new schema:**

- `courses` → `/courses/{courseId}`
- `themes` (old name for lessons) → `/courses/{courseId}/lessons/{lessonId}`
- `entries` → `/courses/{courseId}/lessons/{lessonId}/entries/{entryId}`
- `lesson_ai_plans` → `/courses/{courseId}/lessons/{lessonId}/plans/{planId}`
- `lesson_ai_exercises` → `/courses/{courseId}/lessons/{lessonId}/games/{gameId}`

All legacy-imported docs receive `generationId: "legacy-import-{timestamp}"` so the entire import can be reverted in one click if needed.

**Out of scope — explicitly dropped:**

- All user progress (flashcard review state, game scores, streak counters). The current app stores none of this in Firestore (only localStorage prefs), so this is free. We are **not reimplementing** progress tracking in this phase.
- The `data/lexilogio.sqlite` "form of" resolution logic — that's a build-time concern for the import scripts, not the runtime app. Keep it in scripts but don't bring it forward as a runtime feature.
- Anything not actively read by the current frontend (many `entries` fields like `top5000_*`, `audio_filename`, `entry_source` etc. are unused in the UI and get dropped).

## Out of Phase — Future Trajectory

These are **not implemented in this phase**, but the architecture should not preclude them. Where a current decision has a downstream consequence for one of these, the relevant doc calls it out.

### Multi-user — explicit roadmap

The current app is unauthenticated and single-user. The trajectory:

- **Launch target: ~100 concurrent users.** Single tenant, single instance. Trivial load for Firestore; the schema and trigger design as drafted handle this without changes. Distributed counters and other scale tactics are unnecessary at this size.
- **Scale target: multi-school.** Each school is a tenant — its own set of teachers, students, and (optionally) private course material. School-private content lives under `schools/{schoolId}/courses/...` while global/curated content stays at the top-level `courses/{courseId}` and is visible to all schools.
- **Personas:** three roles with distinct permissions —
  - **Admin** — full control: AI model config, generation lineage management, course/lesson/entry CRUD across all schools, Yiayia admin tools.
  - **Teacher** — within their school: create/edit courses, trigger AI generation, view their students' progress, manage class roster. No AI config control; limited Yiayia admin (can revert their own generations only).
  - **Student** — within their school: read content, do exercises, accumulate progress. Can ask Yiayia tutor questions but cannot trigger admin tools.

### Architectural implications baked in now

So we don't have to retrofit:

1. **Schema paths are tenant-ready.** Top-level `courses/{courseId}` content is treated as "global / curated". A future `schools/{schoolId}/courses/{courseId}` subtree can be added with identical document shapes — code that reads a course works for both paths via a `coursePath()` helper from day one.
2. **`generations` collection carries `createdBy`.** Currently `'user' | 'trigger' | 'yiayia' | 'admin'`. The shape extends naturally to `{ userId, role, schoolId }` once auth lands.
3. **`ai_config` is admin-only conceptually.** Currently world-writable (no auth), but the rules-comments mark it explicitly. When auth lands, the only rule change needed is `allow write: if request.auth.token.role == 'admin'`.
4. **Yiayia adminMode** today is a localStorage toggle. The new design treats it as an authorization check that maps directly onto the future `role == 'admin'` claim — the toggle becomes a no-op for non-admins.
5. **No per-user write paths in content** — every doc under `courses/` is admin/teacher-owned. Student writes will go under `users/{userId}/progress/...` or `schools/{sid}/users/{uid}/...` when added, never into the content tree. This keeps the revert/lineage system from having to distinguish user-progress mutations from content mutations.

### Other deferred work

- Authentication (Firebase Auth, custom claims for role + schoolId).
- Spaced repetition / flashcard SRS state.
- Game score history.
- Social / sharing features.
- Class management (rosters, assignments, due dates).
- Teacher dashboards over student progress.
