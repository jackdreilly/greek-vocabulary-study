# Deploy Pipeline — GitHub Actions Full Deploy

## Why this changes

**Current state (didibros-6d3ed project, shared with fanariotes lyrics app):**

- Hosting is deployed via `npm run deploy` → `firebase-tools deploy --only hosting,storage`. No functions in CI.
- Functions are deployed by hand from a developer machine, using a precise function-name allowlist to avoid Firebase CLI's "delete functions not in this codebase" prompt (which would wipe the fanariotes functions sharing the project). See current CLAUDE.md lines 14–25.
- Result: the deploy command is split into "the part GitHub can do" and "the part you do by hand." Risky and tedious.

**New state (fanari-b6bb4 project, isolated to greekflash):**

- No other functions in the project. `firebase deploy --only functions` is safe — there's nothing to delete.
- GitHub Actions does everything: hosting + functions + firestore rules + indexes + storage rules. One workflow run = production is up to date.
- The "function allowlist" CLAUDE.md instruction is deleted.

## Workflow Outline

`.github/workflows/deploy.yml`:

```yaml
name: Deploy

on:
  push:
    branches: [main]
  workflow_dispatch: {}   # manual trigger

concurrency:
  group: deploy-${{ github.ref }}
  cancel-in-progress: false  # don't cancel a deploy mid-flight

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write    # for WIF if we go that route; harmless otherwise
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 10

      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm

      - name: Install
        run: pnpm install --frozen-lockfile

      - name: Build web
        run: pnpm --filter ./web build

      - name: Build functions
        run: pnpm --filter ./functions build

      - name: Authenticate to Google Cloud
        uses: google-github-actions/auth@v2
        with:
          credentials_json: ${{ secrets.FANARI_DEPLOY_SA }}

      - name: Deploy Firebase
        run: npx firebase-tools deploy \
          --only hosting,functions,firestore:rules,firestore:indexes,storage \
          --project fanari-b6bb4 \
          --non-interactive \
          --force
        env:
          GOOGLE_APPLICATION_CREDENTIALS: ${{ steps.auth.outputs.credentials_file_path }}
```

Notes:

- `--force` skips destructive-action prompts. Safe here because no other app shares the project.
- We deploy from a single command — no split between "things CI does" and "things you do."
- `concurrency` prevents two workflow runs from racing on the same deploy.
- We do **not** run tests in this workflow (yet). A future `ci.yml` would run typecheck/lint on PRs.

## Authentication Options

Two viable paths. Recommend (A) for simplicity unless we already have WIF infrastructure.

### (A) Service Account JSON in a GitHub secret (recommended)

**Setup steps (you do once, with my help):**

1. In the Firebase console for `fanari-b6bb4`, go to Project Settings → Service Accounts → Generate new private key. Download the JSON.
   - This creates a service account with the Firebase Admin SDK role. We'll add deploy permissions next.
2. In the [GCP IAM page](https://console.cloud.google.com/iam-admin/iam?project=fanari-b6bb4), find the service account (e.g. `firebase-adminsdk-...@fanari-b6bb4.iam.gserviceaccount.com`) and grant these additional roles:
   - **Firebase Hosting Admin** (`roles/firebasehosting.admin`)
   - **Cloud Functions Developer** (`roles/cloudfunctions.developer`)
   - **Service Account User** (`roles/iam.serviceAccountUser`)
   - **Firebase Rules Admin** (`roles/firebaserules.admin`)
   - **Cloud Datastore Index Admin** (`roles/datastore.indexAdmin`)
   - **Artifact Registry Writer** (`roles/artifactregistry.writer`) — needed for v2 function container builds
   - **Cloud Build Editor** (`roles/cloudbuild.builds.editor`) — also for v2 builds
3. In the GitHub repo settings (Settings → Secrets and variables → Actions → New repository secret), create:
   - Name: `FANARI_DEPLOY_SA`
   - Value: paste the entire JSON file content (including the surrounding braces).
4. Also set the Gemini API key as a Firebase secret so functions can read it:
   ```
   firebase functions:secrets:set GEMINI_API_KEY --project fanari-b6bb4
   ```
   Paste the key when prompted. Functions reference it with `defineSecret('GEMINI_API_KEY')`.

### (B) Workload Identity Federation (more secure, more setup)

Skip unless we have a reason to avoid long-lived JSON keys. Steps would be:

1. Enable IAM Credentials API.
2. Create a Workload Identity Pool + GitHub OIDC provider.
3. Bind the service account to allow tokens issued for the GitHub repo.
4. Workflow uses `google-github-actions/auth@v2` with `workload_identity_provider` and `service_account` instead of `credentials_json`.

The workflow file is nearly identical; only the `auth` step changes.

## Local Development (still works)

`pnpm dev` (root) runs the Firebase emulators + Vite dev server in parallel — same pattern as fanariotes. Local development never touches the production project.

For hot iteration on functions without burning deploys, the `pnpm dev:prod-data-local-api` pattern (production Firestore data, local Functions) carries over directly from fanariotes' `package.json`. We adapt it to point `VITE_FIRESTORE_TARGET=production` and `VITE_API_BASE_URL=http://127.0.0.1:5001/fanari-b6bb4/us-central1/...`.

## Things to Delete on Cutover

Once the new workflow is live and verified:

- `npm run deploy` in the root `package.json` (the hosting-only shortcut).
- CLAUDE.md's "Firebase Deploys" section that warns against bare `firebase deploy --only functions`. That warning was about the shared project; it no longer applies.

## Open / Needs-User-Help Items

These all need you (the project owner) to run something or set permissions. I'll prompt for them at the end of the docs phase.

1. **Confirm the new project ID** is `fanari-b6bb4`. If not, correct it here and across `.firebaserc` / `firebase.json`.
2. **Confirm previous data in `fanari-b6bb4` can be wiped.** You said it can — noting it here for posterity.
3. **Generate the deploy service account JSON** and add it as `FANARI_DEPLOY_SA` in GitHub secrets. (Steps in section A above.)
4. **Grant the seven IAM roles** to the service account.
5. **Set `GEMINI_API_KEY`** as a Firebase secret on `fanari-b6bb4`.
6. **Enable required APIs** in `fanari-b6bb4`: Firestore, Cloud Functions, Cloud Build, Artifact Registry, Eventarc, Pub/Sub, Cloud Run (v2 functions run on Cloud Run under the hood). The first manual `firebase deploy` from your machine will prompt to enable any that aren't.
7. **Set the default Firestore database** in `fanari-b6bb4` to native mode, `(default)`, region `us-central1` (matches functions region). If you've already done this, skip.

A separate `scripts/setup-fanari.sh` could automate the IAM grants via `gcloud` — write it once we have the project bootstrapped.
