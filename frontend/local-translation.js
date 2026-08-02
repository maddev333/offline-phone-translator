// Served from our own origin (see scripts/vendor-libs.mjs) so the page still boots
// with no network; a CDN import that missed the cache would break the whole app.
import {
  pipeline,
  env,
} from "./vendor/transformers.min.js";

env.allowLocalModels = false;
// Weights and the ONNX Runtime .wasm binary both land in Cache Storage, which is what
// makes a second, offline run possible.
env.useBrowserCache = true;
env.useWasmCache = true;

env.backends.onnx.wasm.proxy = false;
env.backends.onnx.wasm.numThreads = 1;

const DEFAULT_MODEL = "Xenova/opus-mt-en-es";
const DEFAULT_MAX_NEW_TOKENS = 96;

const runtimePromises = new Map();
const loadedModels = new Set();

function getLocalConfig() {
  const config = window.__APP_CONFIG__ || {};
  return {
    enabled: Boolean(config.localTranslation?.enabled),
    model: config.localTranslation?.model || DEFAULT_MODEL,
    device: config.localTranslation?.device || "wasm",
    dtype: config.localTranslation?.dtype,
    maxNewTokens: Number(config.localTranslation?.maxNewTokens || DEFAULT_MAX_NEW_TOKENS),
  };
}

async function loadRuntime(modelName) {
  const config = getLocalConfig();
  const resolvedModel = modelName || config.model;

  if (runtimePromises.has(resolvedModel)) {
    return runtimePromises.get(resolvedModel);
  }

  const runtimePromise = (async () => {
    window.dispatchEvent(new CustomEvent("local-translation-progress", { detail: { status: `loading translation pipeline (${resolvedModel})` } }));

    const options = {
      device: config.device,
      dtype: config.dtype || "fp32",
      progress_callback: (info) => {
        window.dispatchEvent(new CustomEvent("local-translation-progress", { detail: info }));
      },
    };

    const translator = await pipeline("translation", resolvedModel, options);
    loadedModels.add(resolvedModel);

    return { translator, model: resolvedModel };
  })();

  runtimePromises.set(resolvedModel, runtimePromise);
  try {
    return await runtimePromise;
  } catch (error) {
    if (runtimePromises.get(resolvedModel) === runtimePromise) {
      runtimePromises.delete(resolvedModel);
    }
    loadedModels.delete(resolvedModel);
    throw error;
  }
}

export function isLocalTranslationEnabled() {
  return getLocalConfig().enabled;
}

export function isLocalTranslationLoaded(model) {
  const resolvedModel = model || getLocalConfig().model;
  return loadedModels.has(resolvedModel);
}

export async function releaseLocalTranslation(model) {
  const resolvedModel = model || getLocalConfig().model;
  const runtimePromise = runtimePromises.get(resolvedModel);
  runtimePromises.delete(resolvedModel);
  loadedModels.delete(resolvedModel);

  if (!runtimePromise) return;
  try {
    const { translator } = await runtimePromise;
    if (typeof translator?.dispose === "function") {
      await translator.dispose();
    }
  } catch {
    // A failed load has no runtime resources to release.
  }
}

export async function preloadLocalTranslation(model) {
  if (!isLocalTranslationEnabled()) {
    throw new Error("Local translation mode is disabled");
  }
  await loadRuntime(model);
}

export async function runLocalTranslationPrompt({ prompt, model, onToken }) {
  const sourceText = String(prompt || "").trim();
  if (!sourceText) {
    throw new Error("Text input is required");
  }

  const { translator } = await loadRuntime(model);
  const result = await translator(sourceText, {
    max_new_tokens: getLocalConfig().maxNewTokens,
  });

  const first = Array.isArray(result) ? result[0] : result;
  const text = first?.translation_text
    || first?.generated_text
    || first?.text
    || first?.summary_text
    || "";

  if (typeof onToken === "function" && text) {
    onToken(text, text);
  }

  return text;
}