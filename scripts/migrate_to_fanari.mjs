#!/usr/bin/env node
/**
 * Migrate content from legacy didibros-6d3ed:greek-vocab → fanari-b6bb4:(default).
 *
 * STUB — implements only the entry point + dry-run inventory.
 * Full procedure lives in docs/rewrite/01-schema-and-migration.md.
 *
 * Usage:
 *   node scripts/migrate_to_fanari.mjs --dry-run        # default — counts only
 *   node scripts/migrate_to_fanari.mjs --execute        # actually write
 *   node scripts/migrate_to_fanari.mjs --resume         # pick up from .migration-progress.json
 */

import { Firestore } from "@google-cloud/firestore";

const SRC_PROJECT = "didibros-6d3ed";
const SRC_DB_VOCAB = "greek-vocab";
const SRC_DB_DEFAULT = "(default)";

const DST_PROJECT = "fanari-b6bb4";
const DST_DB = "(default)";

const argv = new Set(process.argv.slice(2));
const dryRun = !argv.has("--execute");

async function main() {
  console.log(`[migrate] mode: ${dryRun ? "DRY RUN (inventory only)" : "EXECUTE"}`);
  console.log(`[migrate] source: ${SRC_PROJECT}:${SRC_DB_VOCAB} + ${SRC_PROJECT}:${SRC_DB_DEFAULT}`);
  console.log(`[migrate] target: ${DST_PROJECT}:${DST_DB}`);

  const srcVocab = new Firestore({ projectId: SRC_PROJECT, databaseId: SRC_DB_VOCAB });
  const srcDefault = new Firestore({ projectId: SRC_PROJECT, databaseId: SRC_DB_DEFAULT });
  // eslint-disable-next-line no-unused-vars
  const dst = new Firestore({ projectId: DST_PROJECT, databaseId: DST_DB });

  const [courses, themes, entries, plans, games] = await Promise.all([
    srcVocab.collection("courses").get(),
    srcVocab.collection("themes").get(),
    srcVocab.collection("entries").get(),
    srcDefault.collection("lesson_ai_plans").get(),
    srcDefault.collection("lesson_ai_exercises").get(),
  ]);

  console.log("[migrate] source inventory:");
  console.log(`  courses: ${courses.size}`);
  console.log(`  themes (lessons): ${themes.size}`);
  console.log(`  entries: ${entries.size}`);
  console.log(`  lesson_ai_plans: ${plans.size}`);
  console.log(`  lesson_ai_exercises: ${games.size}`);

  if (dryRun) {
    console.log("\n[migrate] dry run only — no writes. Re-run with --execute to migrate.");
    return;
  }

  console.error(
    "\n[migrate] --execute path not implemented yet. See docs/rewrite/01-schema-and-migration.md for the planned procedure."
  );
  process.exit(2);
}

main().catch((err) => {
  console.error("[migrate] FATAL", err);
  process.exit(1);
});
