import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions";
import { invalidateAIConfigCache } from "../ai/configResolver.js";

export const onAIConfigWritten = onDocumentWritten("ai_config/main", () => {
  invalidateAIConfigCache();
  logger.info("AI config cache invalidated.");
});
