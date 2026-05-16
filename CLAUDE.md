# Agent Instructions

## Firebase Deploys

When deploying Firebase functions, **do NOT delete existing functions** if prompted.
Functions not defined in this repo belong to a separate app sharing the same Firebase project and must be preserved.

Always deploy by targeting only the three greekflash functions explicitly — this bypasses the deletion prompt entirely:

```
npx firebase-tools deploy --only functions:generateLessonGames,functions:scoreGameAnswer,functions:yiayiaChat --project didibros-6d3ed
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
