// Cached-model reporting. localStorage only records that a download was *started*;
// the browser can evict Cache Storage at any time, so every "offline ready" claim in
// the UI is verified against the real caches before it is shown.

// sw.js owns this cache and it only holds the app shell, never model weights.
const APP_SHELL_CACHE_PREFIX = "offline-phone-translator-static-";
export const ASR_CACHE_NAME = "nemotron-asr-int4-v1";
// Every file asr/worker.js needs before transcription can run with no network.
export const ASR_REQUIRED_FILES = [
  "vocab.txt",
  "encoder.onnx",
  "encoder.onnx.data",
  "decoder.onnx",
  "decoder.onnx.data",
  "joint.onnx",
  "joint.onnx.data",
];

const EMPTY_REPORT = { supported: false, entries: [], usage: null, quota: null };

let reportPromise = null;

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

async function readCacheEntries(cacheName) {
  const cache = await caches.open(cacheName);
  const requests = await cache.keys();
  return Promise.all(
    requests.map(async (request) => {
      // Reading headers leaves the body unconsumed, so sizing stays cheap even for
      // the multi-hundred-megabyte ASR files.
      const response = await cache.match(request);
      const bytes = Number(response?.headers.get("content-length"));
      return { cacheName, url: request.url, bytes: Number.isFinite(bytes) ? bytes : 0 };
    })
  );
}

async function buildReport() {
  if (typeof caches === "undefined") return EMPTY_REPORT;
  try {
    const names = (await caches.keys()).filter((name) => !name.startsWith(APP_SHELL_CACHE_PREFIX));
    const groups = await Promise.all(names.map(readCacheEntries));
    let usage = null;
    let quota = null;
    try {
      const estimate = await navigator.storage?.estimate?.();
      usage = estimate?.usage ?? null;
      quota = estimate?.quota ?? null;
    } catch {
      // Storage estimates are advisory; the per-model report still works without them.
    }
    return { supported: true, entries: groups.flat(), usage, quota };
  } catch {
    return EMPTY_REPORT;
  }
}

export function invalidateModelCacheReport() {
  reportPromise = null;
}

export function getModelCacheReport() {
  if (!reportPromise) reportPromise = buildReport();
  return reportPromise;
}

function matchTranslationEntries(report, modelName) {
  // Transformers.js caches by Hugging Face URL, e.g.
  // https://huggingface.co/Xenova/opus-mt-en-es/resolve/main/onnx/encoder_model_quantized.onnx
  return report.entries.filter((entry) => entry.url.includes(`/${modelName}/`));
}

export function describeTranslationModel(report, modelName) {
  if (!report?.supported || !modelName) return { state: "unknown", files: 0, bytes: 0 };
  const entries = matchTranslationEntries(report, modelName);
  const bytes = entries.reduce((total, entry) => total + entry.bytes, 0);
  // Weights are the only part that matters offline; config and tokenizer files on
  // their own mean the download was interrupted.
  const hasWeights = entries.some((entry) => entry.url.endsWith(".onnx"));
  return {
    state: hasWeights ? "cached" : entries.length ? "partial" : "absent",
    files: entries.length,
    bytes,
  };
}

export function describeAsrModel(report) {
  if (!report?.supported) {
    return { state: "unknown", files: 0, bytes: 0, missing: ASR_REQUIRED_FILES.slice() };
  }
  const entries = report.entries.filter((entry) => entry.cacheName === ASR_CACHE_NAME);
  const bytes = entries.reduce((total, entry) => total + entry.bytes, 0);
  const missing = ASR_REQUIRED_FILES.filter(
    (file) => !entries.some((entry) => entry.url.endsWith(`/${file}`))
  );
  return {
    state: missing.length === 0 ? "cached" : entries.length ? "partial" : "absent",
    files: entries.length,
    bytes,
    missing,
  };
}

// sw.js can only prune the app shell caches, so the page deletes the model files it
// can see. Without this the status would keep reporting a removed model as cached.
export async function deleteTranslationModelCache(modelName) {
  if (typeof caches === "undefined" || !modelName) return 0;
  const report = await getModelCacheReport();
  if (!report.supported) return 0;
  const entries = matchTranslationEntries(report, modelName);
  let deleted = 0;
  for (const entry of entries) {
    try {
      const cache = await caches.open(entry.cacheName);
      if (await cache.delete(entry.url)) deleted += 1;
    } catch {
      // A cache that disappeared mid-removal is already in the desired state.
    }
  }
  invalidateModelCacheReport();
  return deleted;
}
