// Origins permitted to call our v2 https callables.
// v2 onCall does not auto-allow custom domains — only the function URL and
// Firebase's default *.web.app / *.firebaseapp.com. The app is served from
// beta.go.fanariotes.com (and eventually go.fanariotes.com), so we list them
// explicitly. Localhost is for the emulator harness.
export const ALLOWED_ORIGINS: (string | RegExp)[] = [
  /^https:\/\/([a-z0-9-]+\.)*fanariotes\.com$/,
  /^https:\/\/fanari-b6bb4(--[a-z0-9-]+)?\.web\.app$/,
  /^https:\/\/fanari-b6bb4\.firebaseapp\.com$/,
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
];
