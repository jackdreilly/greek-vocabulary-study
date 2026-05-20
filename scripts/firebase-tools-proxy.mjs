#!/usr/bin/env node
// Wrapper around firebase-tools that guarantees `--export-on-exit` actually
// completes when you Ctrl-C the dev server, so local Firestore/Storage state
// survives across runs.
//
// Two failure modes this avoids, both of which truncated the export and left
// an empty `firebase-export-*` staging dir while `.emulator-data` went stale:
//
//   1. Same-process-group death. If firebase shares this script's process
//      group, a terminal Ctrl-C delivers SIGINT to firebase AND the Java
//      Firestore emulator at the same instant. The emulator can die before
//      firebase finishes reading the export from it. Fix: launch firebase in
//      its OWN process group (`detached: true`) so the TTY signal reaches only
//      this proxy; we then forward a single, deliberate signal.
//
//   2. A double signal. firebase-tools treats a SECOND shutdown signal as
//      "force quit now" and aborts the in-flight export. Running firebase via
//      `pnpm exec firebase` added a pnpm wrapper process that re-signalled
//      firebase (SIGINT from us, then SIGTERM from pnpm). Fix: spawn the real
//      firebase.js directly with node (no pnpm, no .bin shim), forward exactly
//      ONE signal to that process, and SWALLOW the rest until an impatient
//      user insists.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const PROJECT_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const FIREBASE_JS = path.join(PROJECT_ROOT, "node_modules", "firebase-tools", "lib", "bin", "firebase.js");

function parseEnvFile(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) return out;
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[line.slice(0, idx).trim()] = value;
  }
  return out;
}

const env = {
  ...parseEnvFile(path.join(PROJECT_ROOT, ".env")),
  ...parseEnvFile(path.join(PROJECT_ROOT, ".env.local")),
  ...process.env,
};

const projectId = env.FIREBASE_PROJECT_ID || env.GCLOUD_PROJECT || env.VITE_FIREBASE_PROJECT_ID || "fanari-b6bb4";
const args = process.argv.slice(2);
const finalArgs = projectId && !args.includes("--project") ? [...args, "--project", projectId] : args;

const child = spawn(process.execPath, [FIREBASE_JS, ...finalArgs], {
  cwd: PROJECT_ROOT,
  stdio: "inherit",
  env,
  // Own process group: the controlling terminal's Ctrl-C (SIGINT to the
  // foreground group) reaches only this proxy, not firebase or the Java
  // emulator. We forward a single signal deliberately so the export can run.
  detached: true,
});

let signalCount = 0;

function forward(sig) {
  signalCount += 1;
  if (signalCount === 1) {
    process.stderr.write(`\n[firebase-proxy] ${sig} received — letting firebase finish its export & shut down cleanly…\n`);
    // Signal only firebase.js (the group leader process), NOT the whole group.
    // firebase coordinates the emulators' export and orderly stop itself.
    try {
      child.kill("SIGINT");
    } catch {
      /* already exited */
    }
  } else if (signalCount < 4) {
    process.stderr.write(`[firebase-proxy] still exporting — ignoring extra ${sig} (Ctrl-C ${4 - signalCount} more time(s) to force)\n`);
  } else {
    process.stderr.write(`\n[firebase-proxy] forcing shutdown — export may be incomplete.\n`);
    try {
      if (child.pid != null) process.kill(-child.pid, "SIGKILL");
    } catch {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already exited */
      }
    }
  }
}

for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => forward(sig));
}

// Only exit once firebase has actually finished (after its export completes).
child.on("exit", (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
