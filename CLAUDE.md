# Agent Instructions

## Firestore as the Single Source of Truth

All vocabulary data the app reads at runtime must live in Firestore (`greek-vocab` database: `courses`, `themes`, and `entries` collections). Do **not** add new local JSON/CSV data sources that the frontend fetches directly — the deployed site has no access to files that aren't checked into `public/data/`.

When prototyping a new dataset locally (e.g. a new scraper or course), that's fine — but before considering the feature deployed, run the corresponding import script to push the data into Firestore. Import scripts live in `scripts/` and use `@google-cloud/firestore` with `projectId: "didibros-6d3ed"`, `databaseId: "greek-vocab"`. See `scripts/import_everyday_greek.mjs` as a reference.

**Pre-deploy checklist for new data:**
- [ ] Data is in Firestore (`courses` + `themes` + `entries` collections with correct IDs)
- [ ] Frontend reads it via the existing `fetchFirestore()` path — no new `fetch("/data/...")` calls added
- [ ] Each lesson/theme has a `courseId`; the matching course metadata lives in `courses/{courseId}`

## Firebase Deploys

When deploying Firebase functions, **do NOT delete existing functions** if prompted.
Functions not defined in this repo belong to a separate app sharing the same Firebase project and must be preserved.

Always deploy by targeting only the four greekflash functions explicitly — this bypasses the deletion prompt entirely:

```
npx firebase-tools deploy --only functions:generateLessonGames,functions:scoreGameAnswer,functions:yiayiaChat,functions:generateLessonPlan --project didibros-6d3ed
```

Never run a bare `firebase deploy --only functions` as it will abort asking to delete the other app's functions.

## Vocabulary Data: Resolving "form of" Definitions

Many entries in `data/lexilogio.sqlite` (and the mirrored `data/lexilogio.json`) have `english_senses` like:

> "Nominative plural form of εξέταση (exétasi)."

These are grammatical inflection stubs — not useful as flashcard definitions on their own. When an entry's **only** definitions are "form of" senses (i.e. it has no independent meaning in the DB), resolve the referenced word and prepend its top definitions.

### Strategy

1. **Identify** entries where every sense in `english_senses` matches `/ form of /`.
2. **Extract** the referenced Greek word via regex: `form of ([^\s(,]+)`.
3. **Resolve** using two sources in order:
   - The internal DB: normalize the referenced word (strip accents, lowercase, `ς→σ`) and look it up by `lemma`.
   - The Wiktionary TSV at `/Users/jackreilly/Downloads/Greek-English Wiktionary dictionary.tsv` (204k entries) — use the same `normalize_lookup` logic from `scripts/build_database.py`.
4. **Filter** the resolved senses to exclude any that themselves contain "form of" (avoid circular chains).
5. **Prepend** the top 3 resolved senses before the original "form of" sense(s).
6. **Skip** entries that already have at least one non-"form of" sense.

### After patching

Always sync all three copies of the JSON:
```
cp data/lexilogio.json site/data/lexilogio.json
cp data/lexilogio.json public/data/lexilogio.json
```

The normalization function (strips Greek diacritics and `ς→σ`) is defined in `scripts/build_database.py:normalize_lookup` — reuse it exactly to match the Wiktionary keys.

## Lesson Pages: Tabs

Each lesson has four top-level tabs, in this order:

1. **Vocabulary** — flat browser of the lesson's words ([VocabPage.svelte](src/VocabPage.svelte))
2. **Flashcards** — Anki-style review deck ([FlashcardsPage.svelte](src/FlashcardsPage.svelte))
3. **Games** — AI-generated short-answer practice exercises ([AIPractice.svelte](src/AIPractice.svelte))
4. **Plans** — AI-generated structured pedagogical modules ([PlansPage.svelte](src/PlansPage.svelte))

URL pattern is `/lesson/{id}/{tab}` where tab is `vocab` | `cards` | `games` | `plans`. Tab routing lives in [App.svelte](src/App.svelte) (`loadStateFromUrl`, `setTab`).

## Plans (AI-Generated Textbook Modules)

### Intent

The **Plans** tab turns a lesson's raw vocabulary into a sequence of beautifully rendered, textbook-style learning modules. Each "Plan" is one focused 1–2 page module that reads like a real textbook section — a coherent angle on the lesson (a thematic cluster, a grammar pattern, a verb family, a register, a cultural slice) — woven from the lesson's actual words.

Plans are generated **one at a time**. Every new plan is given the prior plans' metadata (titles, covered words, covered concepts) so it picks an UNCOVERED angle and doesn't duplicate work. Over time, a lesson accumulates a small library of complementary modules.

The generation is a single structured-JSON call to Gemini through Genkit — the schema enforces a typed mix of "widgets" that the Svelte renderer hydrates into rich UI. The AI also uses Firestore tools (`getLessonOverview`, `searchLessonWords`, `getExerciseCoverage`) to pull only the targeted vocabulary it needs for the chosen angle.

### Widget vocabulary

A plan is `{ id, lessonId, planNumber, title, subtitle, estimatedMinutes, coveredWords[], coveredConcepts[], widgets[] }`. Each widget is a tagged object discriminated by `type`. Renderers live in [PlansPage.svelte](src/PlansPage.svelte). Current widget types:

- `heading` — section divider (level 1–3)
- `prose` — paragraphs of explanatory text (light markdown: **bold**, *italic*, `- ` lists)
- `callout` — boxed note. `calloutKind`: `pattern` | `history` | `etymology` | `tip` | `cultural` | `mnemonic`
- `vocab_table` — grouped reference table of key words with optional example phrases
- `conjugation_table` — verb/noun paradigm with **interactive Practice mode** (toggle to hide cells, click to reveal)
- `comparison_table` — side-by-side contrast (genders, register, etc.)
- `reading_passage` — Greek passage with translation toggle and glossary
- `dialogue` — short multi-speaker conversation with Greek + English per line
- `mini_quiz` — interactive multiple-choice with explanations
- `fill_in_blanks` — interactive cloze items (sentence contains `___`, learner types the surface form)
- `word_tree` — productive root with branches showing derived/related words and their relation

When adding a new widget type:
1. Add it to `PlanWidgetTypeSchema` and the optional shape fields in `PlanWidgetSchema` in [functions/src/index.ts](functions/src/index.ts).
2. Update the prompt body in `generateLessonPlanFlow` with the new type's contract and when to use it.
3. Add a render branch in `PlansPage.svelte`'s `{#each selectedPlan.widgets as widget}` block.
4. Redeploy the function (see Firebase Deploys section above).

### Storage

Plans are stored in Firestore collection `lesson_ai_plans` (default DB), one document per plan, keyed by id `l{lessonId}-plan-{planNumber}`. CRUD lives in [src/lib/aiPlans.js](src/lib/aiPlans.js).
