# Handoff — recent session log

**As of:** 2026-05-17 evening
**Branch:** `main`, ahead of origin
**Dev:** Use the local emulator. From the repo root run `pnpm dev:emulators` (Firestore + functions on 8080/5001) and `VITE_USE_FIRESTORE_EMULATOR=1 pnpm --filter ./web dev` (vite on 5174 — wired in `.claude/launch.json`).

Real Gemini calls still hit Google AI via the `GEMINI_API_KEY` env var even while Firestore is local. The emulator persists between sessions via `.emulator-data/`.

Read [00-overview.md](00-overview.md) first if you're not yet oriented.

## Most recent work

- **Plans bug fix.** `onPlanWritten` was passing `article: undefined` for vocab_table rows inside `arrayUnion`, which Firestore rejects. Rewrote `buildWidgets` to omit the field when invalid and added a recursive `prune()` to strip any remaining `undefined`s from optional widget fields (quiz `explanation`, blank `hint` / `english`).
- **Admin lineage UI.** Added `/admin` hub, `/admin/generations` index (kind/status filters + recent list), and `/admin/generations/{id}` detail with a `Revert…` confirmation button.
- **`revertGeneration` callable.** Walks the manifest in reverse: deletes creates, `arrayRemove`s array unions, clears `generationId` on updates. Belt-and-braces collection-group queries on `lessons / entries / plans / games / vocabBatches / gameBatches` clean up orphans. Recomputes lesson + course counts after the sweep so the parent doc stays accurate post-revert.
- **Indexes.** Added collection-group `generationId` indexes on `vocabBatches` and `gameBatches` (revert callable needs them in prod).

## Smoke tested against emulator

- New course generation: home → "Generate" → live course doc with 2 lessons; lessons in turn streamed 30 entries each.
- Game generation + scoring: real Gemini answer-grading on a missing-word game ("Correct.").
- Plan generation: 8 widgets streamed in over ~6s after the article-undefined fix.
- Yiayia chat: context-aware reply with lesson vocabulary + practice prompt.
- Revert: deleted a debug game batch — 4 docs + 1 orphan removed, course/lesson counts rebuilt.

## Still open

- **No deploy yet.** Production `fanari-b6bb4` hasn't been hit by the GitHub Actions workflow. See [05-deploy-pipeline.md](05-deploy-pipeline.md) for the IAM grant + secret list the project owner needs to set up.
- **No `/admin/components` page.** Cheap to add when there's pressure to formalize the design system.
- **`vocabBatches` / `gameBatches` retry UX.** Both subcollections now accept the status-only retry transition, but the UI for retry on the batch is a bare "Try again" button — could use the same status-log treatment as plans.
- **Generation lineage gaps.** Manifest only records top-level path/action; we can't restore full prior state on update reverts. Today this only matters for course/lesson metadata updates; entries/plans/games are pure creates so revert is lossless.
