// Document OCR runtime. GLM-OCR is a vision-language model, so unlike the opus-mt
// translation pipelines it is loaded as three separate ONNX sessions (vision encoder,
// token embeddings, decoder) and driven through the chat template.
import {
  AutoModelForImageTextToText,
  AutoProcessor,
  InterruptableStoppingCriteria,
  RawImage,
  TextStreamer,
  env,
} from "./vendor/transformers.min.js";

env.allowLocalModels = false;
env.useBrowserCache = true;
env.useWasmCache = true;

// Transformers.js 4.2.0 sends every Safari build to the plain ONNX Runtime wasm
// (ort-wasm-simd-threaded.wasm) instead of the asyncify one. That build has no WebGPU
// execution provider, so asking for device "webgpu" on iPadOS/macOS Safari dies with
// "webgpuInit is not a function" and then "no available backend found". Upstream has
// since narrowed that fallback to Safari without WebGPU, so do the same here: when the
// browser really has WebGPU, point the runtime back at the asyncify build.
function preferAsyncifyWasmRuntime() {
  const onnx = env.backends?.onnx;
  const paths = onnx?.wasm?.wasmPaths;
  const ortVersion = onnx?.versions?.web;
  if (!ortVersion || typeof navigator === "undefined" || !navigator.gpu) return;
  // Only correct the CDN defaults Transformers.js just wrote; leave anything else alone.
  if (typeof paths?.mjs !== "string" || paths.mjs.includes(".asyncify")) return;
  const base = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ortVersion}/dist/ort-wasm-simd-threaded.asyncify`;
  onnx.wasm.wasmPaths = { mjs: `${base}.mjs`, wasm: `${base}.wasm` };
}

preferAsyncifyWasmRuntime();

const DEFAULT_MODEL = "onnx-community/GLM-OCR-ONNX";
const DEFAULT_DTYPE = "q4f16";
const DEFAULT_MAX_NEW_TOKENS = 1024;
// GLM-OCR only accepts a fixed set of task prompts; "Text Recognition:" is the
// document-parsing one. See https://huggingface.co/zai-org/GLM-OCR#prompt-limited
const OCR_PROMPT = "Text Recognition:";
// Every ONNX session this model needs before OCR can run with no network.
const SESSION_FILES = ["vision_encoder", "embed_tokens", "decoder_model_merged"];

let runtimePromise = null;
let loaded = false;
const stoppingCriteria = new InterruptableStoppingCriteria();

function getOcrConfig() {
  const config = window.__APP_CONFIG__?.ocr || {};
  return {
    enabled: config.enabled !== false,
    model: config.model || DEFAULT_MODEL,
    device: config.device || "webgpu",
    dtype: config.dtype || DEFAULT_DTYPE,
    maxNewTokens: Number(config.maxNewTokens || DEFAULT_MAX_NEW_TOKENS),
    maxImageSide: Number(config.maxImageSide || 1400),
  };
}

export function getOcrModelName() {
  return getOcrConfig().model;
}

// The repo ships weights for every dtype but its config.json only declares external
// data for fp32/fp16, so the quantized variants would silently load without their
// .onnx_data blobs. from_pretrained accepts an override keyed by exact file name.
// Only the fp32 decoder is split across two chunks; every other file has one.
function getExternalDataFormat(dtype) {
  const suffix = dtype === "fp32" ? "" : `_${dtype}`;
  return Object.fromEntries(
    SESSION_FILES.map((name) => [`${name}${suffix}.onnx`, name === "decoder_model_merged" && !suffix ? 2 : 1])
  );
}

export function getOcrRequiredFiles() {
  const files = ["tokenizer.json"];
  for (const [name, chunks] of Object.entries(getExternalDataFormat(getOcrConfig().dtype))) {
    files.push(name);
    for (let i = 0; i < chunks; ++i) files.push(`${name}_data${i === 0 ? "" : `_${i}`}`);
  }
  return files;
}

function reportProgress(info) {
  window.dispatchEvent(new CustomEvent("local-ocr-progress", { detail: info }));
}

async function loadRuntime() {
  if (runtimePromise) return runtimePromise;

  const { model: modelId, device, dtype } = getOcrConfig();
  runtimePromise = (async () => {
    reportProgress({ status: `loading OCR model (${modelId})` });
    const [processor, model] = await Promise.all([
      AutoProcessor.from_pretrained(modelId, { progress_callback: reportProgress }),
      AutoModelForImageTextToText.from_pretrained(modelId, {
        device,
        dtype,
        use_external_data_format: getExternalDataFormat(dtype),
        progress_callback: reportProgress,
      }),
    ]);
    loaded = true;
    return { processor, model };
  })();

  try {
    return await runtimePromise;
  } catch (error) {
    runtimePromise = null;
    loaded = false;
    throw error;
  }
}

export function isOcrEnabled() {
  return getOcrConfig().enabled;
}

export function isOcrLoaded() {
  return loaded;
}

export async function preloadOcrModel() {
  if (!isOcrEnabled()) throw new Error("Document OCR is disabled in config");
  await loadRuntime();
}

export async function releaseOcrModel() {
  const pending = runtimePromise;
  runtimePromise = null;
  loaded = false;
  if (!pending) return;
  try {
    const { model } = await pending;
    await model?.dispose?.();
  } catch {
    // A failed load has no runtime resources to release.
  }
}

// Phone cameras produce 4000 px wide photos. GLM-OCR builds one visual token per
// 28x28 pixel block, so a full-resolution photo turns into tens of thousands of
// tokens and runs out of memory before it produces anything.
function fitToMaxSide(width, height, maxSide) {
  const longest = Math.max(width, height);
  if (longest <= maxSide) return { width, height };
  const scale = maxSide / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export async function prepareDocumentImage(blob) {
  const { maxImageSide } = getOcrConfig();
  const bitmap = await createImageBitmap(blob);
  try {
    const { width, height } = fitToMaxSide(bitmap.width, bitmap.height, maxImageSide);
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext("2d", { willReadFrequently: true }).drawImage(bitmap, 0, 0, width, height);
    return {
      image: RawImage.fromCanvas(canvas).rgb(),
      width,
      height,
      sourceWidth: bitmap.width,
      sourceHeight: bitmap.height,
    };
  } finally {
    bitmap.close();
  }
}

export function stopDocumentOcr() {
  stoppingCriteria.interrupt();
}

export async function runDocumentOcr({ image, onToken }) {
  if (!image) throw new Error("An image is required");
  const { processor, model } = await loadRuntime();
  const { maxNewTokens } = getOcrConfig();
  stoppingCriteria.reset();

  const prompt = processor.apply_chat_template(
    [{ role: "user", content: [{ type: "image" }, { type: "text", text: OCR_PROMPT }] }],
    { add_generation_prompt: true }
  );
  const inputs = await processor(prompt, image);

  let text = "";
  const streamer = new TextStreamer(processor.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (chunk) => {
      text += chunk;
      onToken?.(text, chunk);
    },
  });

  const outputs = await model.generate({
    ...inputs,
    max_new_tokens: maxNewTokens,
    do_sample: false,
    streamer,
    stopping_criteria: stoppingCriteria,
  });

  if (!text) {
    // A model build without streamer support still returns the full sequence.
    const promptLength = inputs.input_ids.dims.at(-1);
    const [decoded] = processor.batch_decode(outputs.slice(null, [promptLength, null]), {
      skip_special_tokens: true,
    });
    text = decoded || "";
  }

  return text.trim();
}
