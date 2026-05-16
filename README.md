# Fanari Go

A small static study app for browsing Greek vocabulary, reviewing filtered study cards, and playing pronunciation audio.

Live app: https://didibros-6d3ed-greek-vocab.web.app

## Local Development

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Run local server:**
   ```bash
   npm run dev
   ```
   This will open the app at `http://localhost:3000`. It includes hot-reloading for CSS and JS changes.

3. **Use Production Data:**
   To test the local UI against the latest live data from production, open:
   `http://localhost:3000/?prod`

## Project Layout

- `site/` - static web app source.
- `scripts/build_database.py` - rebuilds generated JSON, CSV, SQLite.
- `firebase.json` - Firebase Hosting & Storage configuration.
- `.github/workflows/deploy.yml` - Automated deployment on push to `main`.

## Deployment

Deployments are automated via GitHub Actions on every push to the `main` branch. 

To deploy manually (requires Firebase CLI):
```bash
npm run deploy
```

## Keyboard Shortcuts

- `S` - Open/hide study cards.
- `Shift + S` - Shuffle the current study set.
- `A` - Play/pause pronunciation.
- `Left / Right` - Previous/next card.
- `Space / Enter` - Flip the card.

---

## Data Architecture

- **Audio:** Hosted on Firebase Storage (`gs://didibros-6d3ed.firebasestorage.app/audio/`).
- **Metadata:** All word data is bundled into `site/data/lexilogio.json`.
- **Faceted Search:** The UI dynamically updates filters to ensure you never select a category with 0 results.
