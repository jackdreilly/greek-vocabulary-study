import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import type { DocumentData } from "firebase/firestore";
import { DEFAULT_AI_CONFIG, SURFACES } from "../aiConfig";
import type { AIConfig, Surface } from "../aiConfig";
import { db } from "../firebase";

function normalizeConfig(data: DocumentData | undefined): AIConfig {
  const models = { ...DEFAULT_AI_CONFIG.models };
  const incomingModels = data?.models ?? {};
  for (const surface of SURFACES) {
    models[surface] = {
      ...DEFAULT_AI_CONFIG.models[surface],
      ...(incomingModels[surface] ?? {}),
    };
  }

  return {
    models,
    decoding: data?.decoding ?? {},
    features: { ...DEFAULT_AI_CONFIG.features, ...(data?.features ?? {}) },
    updatedAt: data?.updatedAt?.toDate?.() ?? data?.updatedAt,
    updatedBy: data?.updatedBy,
  };
}

export function subscribeAIConfig() {
  let config = $state<AIConfig>(DEFAULT_AI_CONFIG);
  let loading = $state(true);
  let error = $state<Error | null>(null);

  const unsubscribe = onSnapshot(
    doc(db, "ai_config", "main"),
    (snap) => {
      config = normalizeConfig(snap.data());
      loading = false;
      error = null;
    },
    (err) => {
      error = err;
      loading = false;
    }
  );

  return {
    get config() {
      return config;
    },
    get loading() {
      return loading;
    },
    get error() {
      return error;
    },
    stop: unsubscribe,
  };
}

export async function saveAIConfig(config: AIConfig, updatedBy = "admin-page") {
  await setDoc(
    doc(db, "ai_config", "main"),
    {
      models: config.models,
      decoding: config.decoding,
      features: config.features,
      updatedAt: serverTimestamp(),
      updatedBy,
    },
    { merge: true }
  );
}

export async function resetAIConfig() {
  await saveAIConfig(DEFAULT_AI_CONFIG, "admin-page-reset");
}

export function surfaceKey(value: string): Surface {
  if ((SURFACES as readonly string[]).includes(value)) return value as Surface;
  throw new Error(`Unknown AI surface: ${value}`);
}
