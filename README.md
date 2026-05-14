# Greek Vocabulary Study

A small static study app for browsing Greek vocabulary, reviewing filtered study cards, and playing pronunciation audio.

Live app: https://didibros-6d3ed-greek-vocab.web.app

## What's Included

- Themed Greek vocabulary from `LEXILOGIO-THEMATIKO`.
- A supplemental `SilentShuffle Top 5000` topic.
- English meanings from a Greek-English Wiktionary TSV, with SilentShuffle filling selected gaps.
- Pronunciation audio from the SilentShuffle media folder when MP3s are available.

## Project Layout

- `site/` - static web app source.
- `scripts/build_database.py` - rebuilds generated JSON, CSV, SQLite, and copied site audio.
- `firebase.json` - Firebase Hosting config for the dedicated site.
- `.firebaserc` - points at Firebase project `didibros-6d3ed`.

Generated folders are intentionally not committed:

- `data/`
- `site/data/`
- `site/audio/`

## Raw Source Archives

Raw source files are archived in Firebase Storage under:

```text
gs://didibros-6d3ed.firebasestorage.app/greek-vocab-study/raw-sources/
```

Expected archives:

- `lexilogio-thematiko-pdf.zip`
- `greek-english-wiktionary-tsv.zip`
- `silentshuffle-top-5000.zip`

Archive contents:

| Archive | Contains | Original local path | Used for |
| --- | --- | --- | --- |
| `lexilogio-thematiko-pdf.zip` | `LEXILOGIO-THEMATIKO (1).pdf` | `/Users/jackreilly/Library/Containers/com.apple.mail/Data/Library/Mail Downloads/5135A38B-0EAD-4101-805B-00DD648A7A11/LEXILOGIO-THEMATIKO (1).pdf` | The 12 themed vocabulary lists parsed into topics, word types, pages, and source order. |
| `greek-english-wiktionary-tsv.zip` | `Greek-English Wiktionary dictionary.tsv` | `/Users/jackreilly/Downloads/Greek-English Wiktionary dictionary.tsv` | Primary Greek-to-English meanings, including multiple senses per word. |
| `silentshuffle-top-5000.zip` | The full `top-5000-words-in-greek by SilentShuffle [426582]/` folder, including its Anki-style CSV, images, `info.md`, and `top-5000-words-in-greek [426582]_media(4985)/` MP3 folder. | `/Users/jackreilly/Downloads/top-5000-words-in-greek by SilentShuffle [426582]/` | The Top 5000 topic, supplemental English meanings, frequency ranks, and pronunciation audio. |

The generated app data is not archived separately because it is reproducible from these sources with `scripts/build_database.py`.

## Recovering From Scratch

1. Clone the repo.

   ```bash
   git clone https://github.com/jackdreilly/greek-vocabulary-study.git
   cd greek-vocabulary-study
   ```

2. Download the raw source archives from Firebase Storage.

   ```bash
   mkdir -p raw-sources
   gsutil -m cp 'gs://didibros-6d3ed.firebasestorage.app/greek-vocab-study/raw-sources/*.zip' raw-sources/
   ```

3. Unzip the archives to the same local paths expected by `scripts/build_database.py`, or update the path constants at the top of that script.

   Current expected paths:

   ```text
   /Users/jackreilly/Library/Containers/com.apple.mail/Data/Library/Mail Downloads/5135A38B-0EAD-4101-805B-00DD648A7A11/LEXILOGIO-THEMATIKO (1).pdf
   /Users/jackreilly/Downloads/Greek-English Wiktionary dictionary.tsv
   /Users/jackreilly/Downloads/top-5000-words-in-greek by SilentShuffle [426582]/
   ```

4. Rebuild generated data and site audio.

   ```bash
   /Users/jackreilly/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 scripts/build_database.py
   ```

5. Run locally.

   ```bash
   python3 -m http.server 8000
   ```

   Open http://localhost:8000/site/

## Deploying

Deploy to the dedicated Firebase Hosting site:

```bash
/Users/jackreilly/Documents/fanariotes/node_modules/.bin/firebase deploy \
  --only hosting:didibros-6d3ed-greek-vocab \
  --project didibros-6d3ed
```

## Keyboard Shortcuts

- `S` - open or hide study cards.
- `Shift + S` - shuffle the current study set.
- `A` - play or pause pronunciation.
- `Left / Right` - previous or next card.
- `Space / Enter` - flip the card.
