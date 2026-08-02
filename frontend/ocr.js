import {
  isLocalTranslationEnabled,
  isLocalTranslationLoaded,
  preloadLocalTranslation,
  releaseLocalTranslation,
  runLocalTranslationPrompt,
} from "./local-translation.js";
import {
  getOcrModelName,
  getOcrRequiredFiles,
  isOcrEnabled,
  isOcrLoaded,
  preloadOcrModel,
  prepareDocumentImage,
  releaseOcrModel,
  runDocumentOcr,
  stopDocumentOcr,
} from "./local-ocr.js";
import { LANGUAGE_MODEL_MAP, LANGUAGES } from "./languages.js";
import {
  deleteHuggingFaceModelCache,
  describeOcrModel,
  describeTranslationModel,
  ensurePersistentStorage,
  formatBytes,
  getModelCacheReport,
  invalidateModelCacheReport,
} from "./model-cache.js";

const DOCUMENT_LANGUAGE_STORAGE_KEY = "offline-translator-document-language";
const OCR_EMPTY_TEXT = "Recognised text will appear here.";
const TRANSLATION_EMPTY_TEXT = "The English translation will appear here.";
// opus-mt caps generation at maxNewTokens (96 by default), so long paragraphs are
// translated in sentence-sized pieces instead of being silently truncated.
const MAX_TRANSLATION_CHUNK_CHARS = 220;

const CACHE_STATE_LABELS = { loaded: "In memory", cached: "Ready offline", partial: "Incomplete", absent: "Not downloaded", unknown: "Unknown" };
const CACHE_STATE_BADGES = { loaded: "Loaded", cached: "Ready offline", partial: "Incomplete", absent: "Needs download", unknown: "Unknown" };
const CACHE_STATE_RANK = { unknown: -1, absent: 0, partial: 1, cached: 2, loaded: 3 };

const logEl = document.getElementById("log");
const toggleLogBtn = document.getElementById("toggleOcrLog");
const stateEl = document.getElementById("ocrState");
const modelStatusEl = document.getElementById("ocrModelStatus");
const cameraInputEl = document.getElementById("cameraInput");
const fileInputEl = document.getElementById("fileInput");
const previewEl = document.getElementById("documentPreview");
const documentInfoEl = document.getElementById("documentInfo");
const documentLanguageEl = document.getElementById("documentLanguage");
const runOcrBtn = document.getElementById("runOcr");
const stopOcrBtn = document.getElementById("stopOcr");
const ocrOutputEl = document.getElementById("ocrOutput");
const translationOutputEl = document.getElementById("ocrTranslationOutput");
const offlineBadgeEl = document.getElementById("ocrOfflineBadge");
const pairStatusEl = document.getElementById("ocrPairStatus");
const modelListEl = document.getElementById("ocrModelList");
const storageUsageEl = document.getElementById("ocrStorageUsage");
const refreshCacheBtn = document.getElementById("refreshOcrCache");
const downloadModelBtn = document.getElementById("downloadOcrModel");
const removeModelBtn = document.getElementById("removeOcrModel");
const copyOcrTextBtn = document.getElementById("copyOcrText");
const copyTranslationBtn = document.getElementById("copyOcrTranslation");
const clearOutputBtn = document.getElementById("clearOcrOutput");

let previewUrl = null;
let selectedDocument = null;
let running = false;
let modelCacheReport = null;
let lastCacheCheck = null;
let cacheViewToken = 0;
let recognisedText = "";
// Transformers.js sessions are not re-entrant, and the OCR and translation models
// share the same ONNX runtime, so everything runs through one chain.
let inferenceChain = Promise.resolve();

function log(...parts) {
  const line = parts.join(" ");
  console.log(line);
  if (logEl) logEl.textContent += line + "\n";
}

function setState(kind, text) {
  if (!stateEl) return;
  stateEl.className = `status ${kind}`;
  stateEl.textContent = text;
}

function setModelStatus(text) {
  if (modelStatusEl) modelStatusEl.textContent = text;
}

function setOcrText(text, streaming = false) {
  if (!ocrOutputEl) return;
  ocrOutputEl.textContent = text || OCR_EMPTY_TEXT;
  ocrOutputEl.classList.toggle("ocr-empty", !text);
  ocrOutputEl.classList.toggle("is-streaming", streaming);
}

function setTranslationText(text) {
  if (!translationOutputEl) return;
  translationOutputEl.textContent = text || TRANSLATION_EMPTY_TEXT;
  translationOutputEl.classList.toggle("ocr-empty", !text);
}

function runExclusive(task) {
  const run = inferenceChain.then(task, task);
  inferenceChain = run.then(() => undefined, () => undefined);
  return run;
}

// Recognition works on any script, but the translation step still needs an
// opus-mt model, so only languages with a "<language> → English" route are offered.
function getTranslatableLanguages() {
  return Object.keys(LANGUAGES).filter((name) => LANGUAGE_MODEL_MAP[`${name}:English`]);
}

function getSavedDocumentLanguage() {
  try {
    return localStorage.getItem(DOCUMENT_LANGUAGE_STORAGE_KEY) || "Spanish";
  } catch {
    return "Spanish";
  }
}

function saveDocumentLanguage(value) {
  try {
    localStorage.setItem(DOCUMENT_LANGUAGE_STORAGE_KEY, value);
  } catch {
    // Private-browsing modes reject writes; the selection just will not persist.
  }
}

function renderLanguageOptions() {
  if (!documentLanguageEl) return;
  const languages = getTranslatableLanguages();
  documentLanguageEl.innerHTML = ['<option value="English">English (no translation)</option>']
    .concat(languages.map((name) => `<option value="${name}">${name}</option>`))
    .join("");
  const saved = getSavedDocumentLanguage();
  documentLanguageEl.value = saved === "English" || languages.includes(saved) ? saved : "Spanish";
}

function getSelectedTranslationModel() {
  const language = documentLanguageEl?.value || "English";
  return { language, modelName: LANGUAGE_MODEL_MAP[`${language}:English`] || null };
}

function describeCacheDetail(detail) {
  const parts = [];
  if (detail.bytes) parts.push(formatBytes(detail.bytes));
  if (detail.files) parts.push(`${detail.files} file${detail.files === 1 ? "" : "s"}`);
  if (detail.files && detail.missing?.length) parts.push(`${detail.missing.length} missing`);
  return parts.join(" \u00b7 ") || "Not stored on this device";
}

function getOcrCacheState() {
  const detail = describeOcrModel(modelCacheReport, getOcrModelName(), getOcrRequiredFiles());
  return isOcrLoaded() ? { ...detail, state: "loaded" } : detail;
}

function getTranslationCacheState(modelName) {
  if (!modelName) return { state: "unknown", files: 0, bytes: 0 };
  const detail = describeTranslationModel(modelCacheReport, modelName);
  return isLocalTranslationLoaded(modelName) ? { ...detail, state: "loaded" } : detail;
}

function appendModelRow(label, detail, modelName) {
  const item = document.createElement("li");
  item.className = "model-item";
  item.dataset.state = detail.state;
  if (modelName) item.dataset.model = modelName;
  const dot = document.createElement("span");
  dot.className = "model-dot";
  const name = document.createElement("span");
  name.className = "model-name";
  name.textContent = label;
  const meta = document.createElement("span");
  meta.className = "model-meta";
  meta.textContent = describeCacheDetail(detail);
  const state = document.createElement("span");
  state.className = "model-state";
  state.textContent = CACHE_STATE_LABELS[detail.state] || detail.state;
  item.append(dot, name, meta, state);
  modelListEl.appendChild(item);
}

function setModelDownloadProgress(modelName, ratio, label) {
  const item = Array.from(modelListEl?.children || []).find((row) => row.dataset.model === modelName);
  if (!item) return;
  let bar = item.querySelector(".model-progress");
  if (!bar) {
    bar = document.createElement("div");
    bar.className = "model-progress";
    bar.appendChild(document.createElement("span"));
    item.appendChild(bar);
  }
  bar.firstElementChild.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
  const meta = item.querySelector(".model-meta");
  if (meta) meta.textContent = label;
}

function renderModelList() {
  if (!modelListEl) return;
  modelListEl.textContent = "";
  appendModelRow("Document OCR (GLM-OCR)", getOcrCacheState(), getOcrModelName());
  const { language, modelName } = getSelectedTranslationModel();
  if (modelName) appendModelRow(`${language} \u2192 English`, getTranslationCacheState(modelName), modelName);
}

function renderStorageUsage() {
  if (!storageUsageEl) return;
  if (!modelCacheReport?.supported) {
    storageUsageEl.textContent = "This browser cannot report cached model storage.";
    return;
  }
  const checked = lastCacheCheck ? ` Checked ${lastCacheCheck.toLocaleTimeString()}.` : "";
  const { usage, quota, persisted } = modelCacheReport;
  // The OCR weights are about 630 MB, so eviction is the difference between working
  // offline next week and a blank page.
  const persistence = persisted === true
    ? " Storage is persistent, so cached models are not evicted automatically."
    : persisted === false
      ? " Storage is not persistent yet \u2014 download the model to let the browser grant it."
      : "";
  if (!usage) {
    storageUsageEl.textContent = `Model status is verified against the browser cache.${checked}${persistence}`;
    return;
  }
  storageUsageEl.textContent = quota
    ? `Site storage: ${formatBytes(usage)} used of about ${formatBytes(quota)} available.${checked}${persistence}`
    : `Site storage: ${formatBytes(usage)} used.${checked}${persistence}`;
}

function updateOfflineStatus() {
  const ocrDetail = getOcrCacheState();
  const { language, modelName } = getSelectedTranslationModel();
  const details = modelName ? [ocrDetail, getTranslationCacheState(modelName)] : [ocrDetail];
  const weakest = details.reduce((lowest, detail) =>
    CACHE_STATE_RANK[detail.state] < CACHE_STATE_RANK[lowest.state] ? detail : lowest
  );
  const needed = modelName ? `OCR + ${language} \u2192 English` : "OCR";
  const messages = {
    loaded: `${needed} is loaded in memory and cached for offline use.`,
    cached: `${needed} is cached on this device and works with no network.`,
    partial: `${needed} is only partly cached; download again to finish.`,
    absent: `${needed} is not downloaded yet (about 630 MB for the OCR model).`,
    unknown: `${needed} cache status cannot be verified in this browser.`,
  };
  if (pairStatusEl) pairStatusEl.textContent = messages[weakest.state];
  if (offlineBadgeEl) {
    offlineBadgeEl.dataset.state = weakest.state;
    offlineBadgeEl.textContent = CACHE_STATE_BADGES[weakest.state] || weakest.state;
  }
  if (removeModelBtn) removeModelBtn.disabled = running || !ocrDetail.files;
}

async function refreshModelCacheView({ refresh = false } = {}) {
  if (refresh) invalidateModelCacheReport();
  const token = ++cacheViewToken;
  if (refresh && refreshCacheBtn) {
    refreshCacheBtn.disabled = true;
    refreshCacheBtn.textContent = "Checking\u2026";
  }
  try {
    const report = await getModelCacheReport();
    // A newer refresh already rendered, so this result is stale.
    if (token !== cacheViewToken) return;
    modelCacheReport = report;
    lastCacheCheck = new Date();
    renderModelList();
    updateOfflineStatus();
    renderStorageUsage();
  } finally {
    if (refresh && refreshCacheBtn) {
      refreshCacheBtn.disabled = false;
      refreshCacheBtn.textContent = "Recheck cache";
    }
  }
}

function updateControls() {
  if (runOcrBtn) {
    runOcrBtn.disabled = running || !selectedDocument || !isOcrEnabled();
    runOcrBtn.textContent = running ? "Reading\u2026" : "Read and translate";
  }
  if (stopOcrBtn) stopOcrBtn.disabled = !running;
  if (downloadModelBtn) downloadModelBtn.disabled = running;
  if (cameraInputEl) cameraInputEl.disabled = running;
  if (fileInputEl) fileInputEl.disabled = running;
  if (documentLanguageEl) documentLanguageEl.disabled = running;
}

async function selectDocument(file) {
  if (!file) return;
  setState("warn", "preparing image");
  try {
    const prepared = await prepareDocumentImage(file);
    selectedDocument = prepared;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(file);
    if (previewEl) {
      previewEl.src = previewUrl;
      previewEl.hidden = false;
    }
    const resized = prepared.width !== prepared.sourceWidth || prepared.height !== prepared.sourceHeight;
    if (documentInfoEl) {
      documentInfoEl.textContent = resized
        ? `${file.name || "Photo"} \u2014 ${prepared.sourceWidth}\u00d7${prepared.sourceHeight}, scaled to ${prepared.width}\u00d7${prepared.height} for recognition.`
        : `${file.name || "Photo"} \u2014 ${prepared.width}\u00d7${prepared.height}.`;
    }
    setState("warn", "ready to read");
    log(`document selected: ${prepared.width}\u00d7${prepared.height}`);
  } catch (error) {
    selectedDocument = null;
    setState("err", "image error");
    if (documentInfoEl) documentInfoEl.textContent = error?.message || "That image could not be read.";
    log("document selection failed:", error?.message || String(error));
  }
  updateControls();
}

// GLM-OCR returns markdown, so paragraph and table rows carry meaning. Each line is
// translated on its own and long lines are split on sentence boundaries so no chunk
// exceeds what opus-mt can generate in one pass.
function splitForTranslation(text) {
  const chunks = [];
  for (const line of text.split("\n")) {
    if (line.trim()) {
      const sentences = line.match(/[^.!?\u3002\uff01\uff1f]+[.!?\u3002\uff01\uff1f]*\s*/g) || [line];
      let buffer = "";
      for (const sentence of sentences) {
        if (buffer && buffer.length + sentence.length > MAX_TRANSLATION_CHUNK_CHARS) {
          chunks.push({ text: buffer, translate: true });
          buffer = "";
        }
        buffer += sentence;
      }
      if (buffer) chunks.push({ text: buffer, translate: true });
    }
    chunks.push({ text: "\n", translate: false });
  }
  return chunks;
}

async function translateRecognisedText(text, modelName) {
  let output = "";
  for (const chunk of splitForTranslation(text)) {
    if (!chunk.translate) {
      output += chunk.text;
      continue;
    }
    const translated = await runLocalTranslationPrompt({ prompt: chunk.text, model: modelName });
    output += translated ? `${translated} ` : "";
    setTranslationText(output.trimEnd());
  }
  return output.replace(/[ \t]+\n/g, "\n").trim();
}

async function readAndTranslate() {
  if (running || !selectedDocument) return;
  if (!isOcrEnabled()) {
    setState("err", "disabled");
    setModelStatus("Document OCR is disabled in config.");
    return;
  }
  running = true;
  recognisedText = "";
  setOcrText("", true);
  setTranslationText("");
  updateControls();

  try {
    setState("warn", "reading document");
    setModelStatus("Loading the OCR model\u2026");
    recognisedText = await runExclusive(() =>
      runDocumentOcr({ image: selectedDocument.image, onToken: (text) => setOcrText(text, true) })
    );
    setOcrText(recognisedText);
    if (!recognisedText) {
      setState("warn", "no text found");
      setModelStatus("No text was recognised in that image.");
      return;
    }
    log(`recognised ${recognisedText.length} characters`);

    const { language, modelName } = getSelectedTranslationModel();
    if (!modelName) {
      setTranslationText(recognisedText);
      setState("ok", "done");
      setModelStatus("Document is already in English, so no translation was needed.");
      return;
    }
    if (!isLocalTranslationEnabled()) {
      setState("warn", "translation disabled");
      setModelStatus("Local translation is disabled in config, so only the recognised text is shown.");
      return;
    }
    setState("warn", "translating");
    setModelStatus(`Translating ${language} \u2192 English\u2026`);
    const translated = await runExclusive(() => translateRecognisedText(recognisedText, modelName));
    setTranslationText(translated);
    setState("ok", "done");
    setModelStatus(`Recognised and translated ${language} \u2192 English on this device.`);
    log(`translated ${language} \u2192 English`);
  } catch (error) {
    setState("err", "failed");
    setModelStatus(error?.message || "Document recognition failed.");
    log("ocr failed:", error?.message || String(error));
  } finally {
    running = false;
    setOcrText(recognisedText);
    updateControls();
    await refreshModelCacheView({ refresh: true });
  }
}

async function downloadModels() {
  if (running) return;
  running = true;
  updateControls();
  try {
    setState("warn", "downloading");
    setModelStatus("Downloading the OCR model. Keep this page open.");
    // Asking here keeps the request inside the click gesture, which is when browsers
    // are most willing to mark the origin persistent.
    const persisted = await ensurePersistentStorage();
    if (persisted === false) log("browser declined persistent storage; cached models may be evicted");
    await runExclusive(() => preloadOcrModel());
    const { language, modelName } = getSelectedTranslationModel();
    if (modelName && isLocalTranslationEnabled()) {
      setModelStatus(`Downloading the ${language} \u2192 English translation model\u2026`);
      await runExclusive(() => preloadLocalTranslation(modelName));
    }
    setState("ok", "ready offline");
    setModelStatus("Models are cached in this browser and work with no network.");
    log("offline models ready");
  } catch (error) {
    setState("err", "download failed");
    setModelStatus(error?.message || "Downloading the models failed.");
    log("model download failed:", error?.message || String(error));
  } finally {
    running = false;
    updateControls();
    await refreshModelCacheView({ refresh: true });
  }
}

async function removeOcrModel() {
  if (running) return;
  const modelName = getOcrModelName();
  await releaseOcrModel();
  // sw.js can only reach the app shell caches, so the weights are deleted here.
  const deleted = await deleteHuggingFaceModelCache(modelName);
  log(`removed ${modelName}: ${deleted} cached file(s) deleted`);
  setState("warn", "idle");
  setModelStatus("The OCR model was removed from this device.");
  await refreshModelCacheView({ refresh: true });
}

cameraInputEl?.addEventListener("change", () => void selectDocument(cameraInputEl.files?.[0]));
fileInputEl?.addEventListener("change", () => void selectDocument(fileInputEl.files?.[0]));
runOcrBtn?.addEventListener("click", () => void readAndTranslate());
stopOcrBtn?.addEventListener("click", () => {
  stopDocumentOcr();
  log("stop requested");
});
documentLanguageEl?.addEventListener("change", () => {
  saveDocumentLanguage(documentLanguageEl.value);
  void refreshModelCacheView();
});
downloadModelBtn?.addEventListener("click", () => void downloadModels());
removeModelBtn?.addEventListener("click", () => void removeOcrModel());
refreshCacheBtn?.addEventListener("click", () => void refreshModelCacheView({ refresh: true }));
copyOcrTextBtn?.addEventListener("click", async () => {
  if (!recognisedText) return;
  try {
    await navigator.clipboard.writeText(recognisedText);
    log("copied recognised text");
  } catch {
    log("copy recognised text failed");
  }
});
copyTranslationBtn?.addEventListener("click", async () => {
  const text = translationOutputEl?.classList.contains("ocr-empty") ? "" : translationOutputEl?.textContent || "";
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    log("copied translation");
  } catch {
    log("copy translation failed");
  }
});
clearOutputBtn?.addEventListener("click", () => {
  recognisedText = "";
  setOcrText("");
  setTranslationText("");
});
toggleLogBtn?.addEventListener("click", () => {
  const isHidden = logEl.hasAttribute("hidden");
  if (isHidden) {
    logEl.removeAttribute("hidden");
    toggleLogBtn.textContent = "Hide activity";
  } else {
    logEl.setAttribute("hidden", "hidden");
    toggleLogBtn.textContent = "Show activity";
  }
});
window.addEventListener("local-ocr-progress", (event) => {
  const detail = event.detail || {};
  const file = detail.file || detail.name || detail.status || "model";
  // `loaded`/`total` are unambiguous; `progress` is a 0-100 percentage when present.
  const ratio = Number.isFinite(detail.total) && detail.total > 0
    ? detail.loaded / detail.total
    : typeof detail.progress === "number" ? detail.progress / 100 : null;
  const percent = ratio == null ? "" : ` ${Math.round(ratio * 100)}%`;
  setModelStatus(`Loading ${file}${percent}`);
  if (ratio != null) setModelDownloadProgress(getOcrModelName(), ratio, `Downloading ${file}${percent}`);
});
window.addEventListener("local-translation-progress", (event) => {
  const detail = event.detail || {};
  const file = detail.file || detail.name || detail.status || "model";
  const ratio = Number.isFinite(detail.total) && detail.total > 0
    ? detail.loaded / detail.total
    : typeof detail.progress === "number" ? detail.progress / 100 : null;
  const percent = ratio == null ? "" : ` ${Math.round(ratio * 100)}%`;
  setModelStatus(`Loading ${file}${percent}`);
  const modelName = detail.name || getSelectedTranslationModel().modelName;
  if (modelName && ratio != null) setModelDownloadProgress(modelName, ratio, `Downloading ${file}${percent}`);
});
window.addEventListener("offline-translator:model-cache-changed", () => void refreshModelCacheView({ refresh: true }));
window.addEventListener("pagehide", () => {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
});

renderLanguageOptions();
setOcrText("");
setTranslationText("");
updateControls();
if (!isOcrEnabled()) {
  setState("err", "disabled");
  setModelStatus("Document OCR is disabled in config.");
} else if (!navigator.gpu) {
  setState("err", "WebGPU unavailable");
  setModelStatus("GLM-OCR needs a WebGPU-capable browser. Recognition is unavailable on this device.");
} else {
  setState("warn", "idle");
  setModelStatus("Take or choose a photo, then read it on this device.");
}
void refreshModelCacheView({ refresh: true });
