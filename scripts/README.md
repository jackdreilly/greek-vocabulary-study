# Scripts

One-off operational scripts: data migration, content imports, ad-hoc maintenance.

Run scripts with `node scripts/<name>.mjs` from the repo root. Scripts that hit
Firestore use `@google-cloud/firestore` with explicit `projectId: "fanari-b6bb4"`.

## Index

- `migrate_to_fanari.mjs` — **(stub)** One-shot migration from the legacy
  `didibros-6d3ed:greek-vocab` Firestore to the new
  `fanari-b6bb4:(default)` subcollection schema. See
  `docs/vision.md` for the procedure.

## Legacy scripts

The old `didibros-6d3ed` project's import / scraper / image-fetch scripts were
removed at the cutover; recover them from git history (`git log -- _legacy/`)
if needed, and adapt the `projectId` / `databaseId` references.
