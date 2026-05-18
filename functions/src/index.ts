/**
 * Greekflash Cloud Functions — entrypoint.
 *
 * This file re-exports every function the deploy pipeline should publish.
 * Triggers are organized under `src/triggers/`, AI primitives under `src/ai/`,
 * admin tools under `src/admin/`. Schemas under `src/schemas/`.
 *
 * Design docs: docs/rewrite/02-triggers-and-orchestration.md
 */
import { setGlobalOptions } from "firebase-functions/v2";
import { onRequest } from "firebase-functions/v2/https";
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

export { onAIConfigWritten } from "./triggers/onAIConfigWritten.js";
export { onCourseWritten } from "./triggers/onCourseWritten.js";
export { onGameBatchWritten } from "./triggers/onGameBatchWritten.js";
export { onLessonWritten } from "./triggers/onLessonWritten.js";
export { onPlanWritten } from "./triggers/onPlanWritten.js";
export { onVocabBatchWritten } from "./triggers/onVocabBatchWritten.js";
export { aiAssistVocabEntry } from "./callables/aiAssistVocabEntry.js";
export { revertGeneration } from "./callables/revertGeneration.js";
export { scoreGameAnswer } from "./callables/scoreGameAnswer.js";
export { yiayiaChat } from "./callables/yiayiaChat.js";
