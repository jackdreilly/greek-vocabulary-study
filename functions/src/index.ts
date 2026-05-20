/**
 * Greekflash Cloud Functions — entrypoint.
 *
 * This file re-exports every function the deploy pipeline should publish.
 * Triggers are organized under `src/triggers/`, AI primitives under `src/ai/`,
 * admin tools under `src/admin/`. Schemas under `src/schemas/`.
 *
 * Design docs: docs/vision.md
 */
import { setGlobalOptions } from "firebase-functions/v2";
import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { initializeApp, getApps } from "firebase-admin/app";

if (getApps().length === 0) {
  initializeApp();
}

setGlobalOptions({
  region: "us-central1",
  memory: "512MiB",
  timeoutSeconds: 540,
  maxInstances: 10,
});

export const ping = onRequest({ cors: true }, (_req, res) => {
  res.json({ ok: true, project: "fanari-b6bb4", at: new Date().toISOString() });
});

const pexelsApiKey = defineSecret("PEXELS_API_KEY");

export const searchPexelsImages = onRequest({ cors: true, secrets: [pexelsApiKey] }, async (req, res) => {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const query = typeof req.query.query === "string" ? req.query.query.trim() : "";
  if (!query) {
    res.status(400).json({ error: "Missing query" });
    return;
  }

  const perPage = typeof req.query.per_page === "string" ? req.query.per_page : "6";
  const orientation = typeof req.query.orientation === "string" ? req.query.orientation : "landscape";
  const upstreamUrl = new URL("https://api.pexels.com/v1/search");
  upstreamUrl.searchParams.set("query", query);
  upstreamUrl.searchParams.set("per_page", perPage);
  upstreamUrl.searchParams.set("orientation", orientation);

  const upstream = await fetch(upstreamUrl, {
    headers: { Authorization: pexelsApiKey.value() },
  });

  res.status(upstream.status);
  res.set("Content-Type", upstream.headers.get("content-type") ?? "application/json");
  res.send(await upstream.text());
});

export { onAIConfigWritten } from "./triggers/onAIConfigWritten.js";
export { onEntryWritten } from "./triggers/onEntryWritten.js";
export { onCourseWritten } from "./triggers/onCourseWritten.js";
export { onGameBatchWritten } from "./triggers/onGameBatchWritten.js";
export { onLessonWritten } from "./triggers/onLessonWritten.js";
export { onPlanWritten } from "./triggers/onPlanWritten.js";
export { onVocabBatchWritten } from "./triggers/onVocabBatchWritten.js";
export { aiAssistVocabEntry } from "./callables/aiAssistVocabEntry.js";
export { getGameHint } from "./callables/getGameHint.js";
export { revertGeneration } from "./callables/revertGeneration.js";
export { scoreGameAnswer } from "./callables/scoreGameAnswer.js";
export { yiayiaChat } from "./callables/yiayiaChat.js";
export { yiayiaCorrection } from "./callables/yiayiaCorrection.js";
export { yiayiaAdminChat } from "./callables/yiayiaAdminChat.js";
