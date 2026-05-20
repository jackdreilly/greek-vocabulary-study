# Agent Instructions

Greekflash is a Svelte 5 + Vite SPA (`web/`) backed by TypeScript Cloud
Functions v2 with Genkit/Gemini (`functions/`) on the **`fanari-b6bb4`**
Firebase project (single `(default)` Firestore database).

**For the architecture and the *why* behind the design, read
[docs/vision.md](docs/vision.md) first.** That doc is the conceptual map
(Firestore-as-bus, streaming triggers, generation lineage, AI-as-data, the UI
system). This file is the operational runbook: how to run, test, and deploy.

User progress features (flashcard SRS, game scores, streaks) are intentionally
**not** implemented in this phase.

## Local development — always use the emulator

For any frontend or function work, **always run against the local Firebase
emulator** instead of hitting production. The repo has a single root script that
starts everything:

```bash
pnpm run dev:emulators
```

This command (defined in the root `package.json`):
1. Watches and rebuilds `functions/` on every change
2. Watches and rebuilds `web/` on every change
3. Starts Firebase emulators for hosting, functions, Firestore, and storage
4. Imports and exports emulator state through `.emulator-data`, so local
   Firestore/storage data persists between runs

The app is served at **`localhost:5002`** (Firebase hosting emulator). Firestore
runs at `localhost:8080`, Functions at `localhost:5001`, and the emulator UI at
`localhost:4000`.

**In Claude Code**, use the configured preview server instead of running the
command manually:

```
preview_start("Full stack (emulators + build watch)")
```

This is defined in `.claude/launch.json` and points at port 5002.

**In Codex**, use that same local setup. Before browser testing, prefer starting
or reusing the exact `.claude/launch.json` configuration:

```json
{
  "name": "Full stack (emulators + build watch)",
  "runtimeExecutable": "pnpm",
  "runtimeArgs": ["run", "dev:emulators"],
  "port": 5002
}
```

If Codex cannot consume `.claude/launch.json` directly, run the equivalent root
command `pnpm run dev:emulators`.

Do not substitute `pnpm --filter ./web dev`, `vite dev`, Firebase Hosting
without the Firestore emulator, or any production-backed setup when debugging UI
state. The point is to use the same state-persisting, fully local emulator
environment every time.

**State persistence:** the emulator is launched through
`scripts/firebase-tools-proxy.mjs`, which guarantees `--export-on-exit` actually
finishes when you Ctrl-C (it runs firebase in its own process group and forwards
exactly one shutdown signal, so the Firestore export isn't truncated). To stop
the dev server, press Ctrl-C **once** and let it export; only mash Ctrl-C if
you want to force-kill and abandon the export.

**Never** run bare `firebase deploy` or test against production during
development — every UI action hits live data if the emulator isn't running.

## Deploying

`fanari-b6bb4` is isolated to greekflash, so deploys are unrestricted (no
function allowlist needed).

- **CI (preferred):** push to `main` → `.github/workflows/deploy.yml` does a full
  deploy (hosting + functions + firestore rules + indexes + storage). Trigger a
  manual run with `gh workflow run deploy.yml --ref main` (workflow_dispatch).
  The workflow authenticates via the `FANARI_DEPLOY_SA` GitHub secret (a key for
  the `firebase-adminsdk-fbsvc@fanari-b6bb4` service account) and installs pnpm
  via **corepack** (do not add `pnpm/action-setup` — having both pins two pnpm
  versions and aborts the run).
- **Local full deploy:** `pnpm run deploy`. Do **not** use `pnpm deploy`; that
  invokes pnpm's own deploy command instead of this repo's Firebase deploy
  script.
- **Function-only hotfix** to production:
  ```bash
  npx firebase-tools deploy --only functions:yiayiaChat --project fanari-b6bb4
  ```

Function secrets `GEMINI_API_KEY` and `PEXELS_API_KEY` are Firebase secrets on
`fanari-b6bb4` (referenced via `defineSecret`). Set/rotate with
`firebase functions:secrets:set <NAME> --project fanari-b6bb4`.

## Lesson tabs

A lesson has tabs rendered as routes (`web/src/routes/Lesson.svelte` +
`web/src/routes/lesson/*Tab.svelte`), under `/c/{cid}/l/{lid}/{tab}`:

1. **Overview** (`OverviewTab.svelte`) — generated lesson overview
2. **Vocabulary** (`VocabTab.svelte`) — browser of the lesson's words
3. **Flashcards** (`FlashcardsTab.svelte`) — review deck (focus mode)
4. **Games** (`GamesTab.svelte`) — AI-generated practice exercises
5. **Plans** (`PlansTab.svelte`) — AI-generated textbook-style modules

A bare lesson URL redirects to a sensible default tab. Routing is a small custom
regex router (`web/src/lib/router.svelte.ts`), wired in `web/src/App.svelte`.

## Plans & widgets

A plan is a sequence of typed **widgets** the renderer hydrates into rich UI. A
single plan view lives at `/c/{cid}/l/{lid}/plans/{pid}`
(`web/src/routes/Plan.svelte`); renderers live in `web/src/lib/widgets/`
(`WidgetRenderer.svelte` + `types/*.svelte`). Plans are stored in the lesson's
`plans` subcollection and generated by the `onPlanWritten` trigger one at a time
(each new plan gets prior plans' metadata so it picks an uncovered angle).

Widget types: `heading`, `prose`, `callout`, `vocab_table`,
`conjugation_table` (interactive practice mode), `comparison_table`,
`reading_passage`, `dialogue`, `mini_quiz`, `fill_in_blanks`, `word_tree`.

To add a new widget type:
1. Extend the widget schema in `functions/src/schemas/plan.ts`.
2. Teach the plan-generation prompt in `functions/src/triggers/onPlanWritten.ts`
   the new type's contract and when to use it.
3. Add a renderer under `web/src/lib/widgets/types/` and wire it into
   `WidgetRenderer.svelte`.
4. Redeploy the function.

## Content generation gating

All AI content-generation entry points (new course / lesson / vocab / games /
plan) are gated behind the `contentGeneration` feature flag in `ai_config/main`
(default `true`) and use the shared `GenerateModal`
(`web/src/lib/ui/GenerateModal.svelte`).

### Entry points

| Feature | File |
|---------|------|
| New course | `web/src/routes/Home.svelte` |
| New lesson | `web/src/routes/Course.svelte` |
| New vocab | `web/src/routes/lesson/VocabTab.svelte` |
| New games | `web/src/routes/lesson/GamesTab.svelte` |
| New plan | `web/src/routes/lesson/PlansTab.svelte` |

### Migration to backend enforcement (when auth lands)

The `contentGeneration` flag is currently a client-side UI hint. When
auth/roles arrive, make it a hard gate:

1. **Auth token claim** — add `canGenerate: boolean` as a custom claim.
2. **Firestore rules** — deny writes to content-creation paths unless
   `request.auth.token.canGenerate == true`.
3. **Trigger/callable guards** — verify the claim server-side.
4. **Frontend flag** — keep as cosmetic (hides buttons) once the server rejects
   unauthorised calls.
