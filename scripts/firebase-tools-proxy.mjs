#!/usr/bin/env node
// Thin wrapper around firebase-tools that forwards SIGINT/SIGTERM/SIGHUP to
// the child process so --export-on-exit fires reliably on shutdown.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const PROJECT_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

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

const child = spawn("pnpm", ["exec", "firebase", ...finalArgs], {
  cwd: PROJECT_ROOT,
  stdio: "inherit",
  env,
});

for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => child.kill(sig));
}

child.on("exit", (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
