import {
  pipeline,
  env,
} from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0";

env.allowLocalModels = false;
env.useBrowserCache = true;

env.backends.onnx.wasm.proxy = false;
env.backends.onnx.wasm.numThreads = 1;

const DEFAULT_MODEL = "Xenova/t5-small";
const DEFAULT_MAX_NEW_TOKENS = 96;

const runtimePromises = new Map();

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

    return { translator, model: resolvedModel };
  })();

  runtimePromises.set(resolvedModel, runtimePromise);
  return runtimePromise;
}

export function isLocalTranslationEnabled() {
  return getLocalConfig().enabled;
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

  console.log("translation raw result", result);

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

