import {
  isLocalTranslationEnabled,
  isLocalTranslationLoaded,
  preloadLocalTranslation,
  releaseLocalTranslation,
  runLocalTranslationPrompt,
} from "./local-translation.js";
import {
  LANGUAGE_MODEL_MAP,
  SUPPORTED_LANGUAGE_PAIRS,
  CONVERSATION_PARTNER_LANGUAGES,
  findLanguageByLocale,
} from "./languages.js";
import {
  deleteHuggingFaceModelCache,
  describeAsrModel,
  describeTranslationModel,
  formatBytes,
  getModelCacheReport,
  invalidateModelCacheReport,
} from "./model-cache.js";

const DEFAULT_TRANSLATION_OUTPUT = "Your translated text will appear here.";
const APP_BASE_PATH = window.__APP_BASE_PATH__ || "/";
// Nemotron emits partials about every 0.5 s of audio and never rewrites what it already emitted,
// so a partial can be split into a stable prefix (safe to translate and keep) and a growing tail.
const LIVE_TAIL_IDLE_MS = 900;
const LIVE_FORCE_COMMIT_WORDS = 25;

const logEl = document.getElementById("log");
const translationOutputEl = document.getElementById("translationOutput");
const offlineReadyBadgeEl = document.getElementById("offlineReadyBadge");
const toggleLogBtn = document.getElementById("toggleLog");
const runLocalBtn = document.getElementById("runLocal");
const downloadOfflineModelsBtn = document.getElementById("downloadOfflineModels");
const speakResponsesEl = document.getElementById("speakResponses");
const localModelStatusEl = document.getElementById("translationModelStatus");
const localConversationStateEl = document.getElementById("translationState");
const localRecordingStatusEl = document.getElementById("translationStatus");
const translationInputEl = document.getElementById("translationInput");
const sourceLanguageEl = document.getElementById("sourceLanguage");
const targetLanguageEl = document.getElementById("targetLanguage");
const offlinePairStatusEl = document.getElementById("offlinePairStatus");
const modelCacheListEl = document.getElementById("modelCacheList");
const storageUsageEl = document.getElementById("storageUsage");
const refreshModelCacheBtn = document.getElementById("refreshModelCache");
const swapLanguagesBtn = document.getElementById("swapLanguages");
const removeSelectedModelBtn = document.getElementById("removeSelectedModel");
const conversationModeEl = document.getElementById("conversationMode");
const conversationSideAEl = document.getElementById("conversationSideA");
const conversationSideBEl = document.getElementById("conversationSideB");
const conversationRowEl = document.getElementById("conversationRow");
const conversationHintEl = document.getElementById("conversationHint");
const manualLanguageRowEl = document.getElementById("manualLanguageRow");
const saveContextBtn = document.getElementById("saveContext");
const clearTextBtn = document.getElementById("clearText");
const copyTranslationBtn = document.getElementById("copyTranslation");
const clearOutputBtn = document.getElementById("clearOutput");
const quickPhraseButtons = Array.from(document.querySelectorAll("[data-phrase]"));

const INPUT_STORAGE_KEY = "offline-translator-input";
const SOURCE_LANGUAGE_STORAGE_KEY = "offline-translator-source-language";
const TARGET_LANGUAGE_STORAGE_KEY = "offline-translator-target-language";
const SPEAK_RESPONSES_STORAGE_KEY = "offline-translator-speak-responses";
const DOWNLOADED_MODELS_STORAGE_KEY = "offline-translator-downloaded-models";
const CONVERSATION_MODE_STORAGE_KEY = "offline-translator-conversation-mode";
const CONVERSATION_SIDE_A_STORAGE_KEY = "offline-translator-conversation-side-a";
const CONVERSATION_SIDE_B_STORAGE_KEY = "offline-translator-conversation-side-b";

let runningLocalInference = false;
let isSpeakingResponse = false;
// Last verified snapshot of Cache Storage; the UI never claims "offline ready" from
// the localStorage record alone.
let modelCacheReport = null;
let lastCacheCheck = null;
let cacheViewToken = 0;
// Progress events for a fresh pipeline carry no model id, so the caller records one.
let activeDownloadModel = null;
// Transformers.js pipelines are not re-entrant, so every model call goes through one chain.
let inferenceChain = Promise.resolve();
const live = {
  active: false, session: 0, committed: 0, lastText: "", tail: "",
  rows: [], preview: "", previewSource: "", previewRoute: null,
  queue: [], busy: false, dirty: false, idleTimer: null, langApplied: false,
  markCursor: 0, tagOrientation: null, currentLanguage: null, turnId: 0, rowSeq: 0, turnLanguages: {},
};
// Auto-switching overwrites the stored target, so keep the user's own English-source choice separately.
let preferredEnglishTarget = null;

function log(...parts) {
  const line = parts.join(" ");
  console.log(line);
  logEl.textContent += line + "\n";
}

function setTranslationOutput(text, preview = "") {
  if (!translationOutputEl) return;
  translationOutputEl.textContent = text || (preview ? "" : DEFAULT_TRANSLATION_OUTPUT);
  if (!preview) return;
  // textContent keeps model output inert; never build this node from an HTML string.
  const span = document.createElement("span");
  span.className = "live-preview";
  span.textContent = `${text ? " " : ""}${preview}`;
  translationOutputEl.appendChild(span);
}
function setLocalModelStatus(text) { if (localModelStatusEl) localModelStatusEl.textContent = text; }
function setLocalConversationState(kind, text) { if (localConversationStateEl) { localConversationStateEl.className = `status ${kind}`; localConversationStateEl.textContent = text; } }
function setLocalRecordingStatus(text) { if (localRecordingStatusEl) localRecordingStatusEl.textContent = text; }
function getSavedSpeakResponses() { try { return localStorage.getItem(SPEAK_RESPONSES_STORAGE_KEY) === "true"; } catch { return false; } }
function saveSpeakResponses(value) { try { localStorage.setItem(SPEAK_RESPONSES_STORAGE_KEY, String(value)); } catch {} }
function getSavedInput() { try { return localStorage.getItem(INPUT_STORAGE_KEY) || ""; } catch { return ""; } }
function saveInput(value) { try { localStorage.setItem(INPUT_STORAGE_KEY, value); } catch {} }
function getSavedSourceLanguage() { try { return localStorage.getItem(SOURCE_LANGUAGE_STORAGE_KEY) || "English"; } catch { return "English"; } }
function saveSourceLanguage(value) { try { localStorage.setItem(SOURCE_LANGUAGE_STORAGE_KEY, value); } catch {} }
function getSavedTargetLanguage() { try { return localStorage.getItem(TARGET_LANGUAGE_STORAGE_KEY) || "Spanish"; } catch { return "Spanish"; } }
function saveTargetLanguage(value) { try { localStorage.setItem(TARGET_LANGUAGE_STORAGE_KEY, value); } catch {} }

function getCurrentLanguageSelection() {
  const sourceLanguage = sourceLanguageEl?.value || getSavedSourceLanguage();
  const targetLanguage = targetLanguageEl?.value || getSavedTargetLanguage();
  const modelKey = `${sourceLanguage}:${targetLanguage}`;
  return { sourceLanguage, targetLanguage, modelKey, modelName: LANGUAGE_MODEL_MAP[modelKey] };
}
function getDownloadedModels() { try { return JSON.parse(localStorage.getItem(DOWNLOADED_MODELS_STORAGE_KEY) || "[]"); } catch { return []; } }
function saveDownloadedModel(modelName) { const models = new Set(getDownloadedModels()); models.add(modelName); try { localStorage.setItem(DOWNLOADED_MODELS_STORAGE_KEY, JSON.stringify([...models])); } catch {} }
function removeDownloadedModel(modelName) { const models = getDownloadedModels().filter((model) => model !== modelName); try { localStorage.setItem(DOWNLOADED_MODELS_STORAGE_KEY, JSON.stringify(models)); } catch {} }
function getLanguagePairLabelForModel(modelName) { const entry = Object.entries(LANGUAGE_MODEL_MAP).find(([, value]) => value === modelName); return entry ? entry[0].replace(":", " → ") : modelName; }

const CACHE_STATE_LABELS = { loaded: "In memory", cached: "Ready offline", partial: "Incomplete", missing: "Not in cache", absent: "Not downloaded", unknown: "Unknown" };
const CACHE_STATE_HINTS = { missing: "Cleared by the browser — download again", absent: "Not stored on this device", unknown: "Cache Storage is unavailable here" };
const CACHE_STATE_BADGES = { loaded: "Loaded", cached: "Ready offline", partial: "Incomplete", missing: "Re-download", absent: "Needs download", unknown: "Unknown" };
// Worst-first ordering so a pair is only as good as its weakest direction.
const CACHE_STATE_RANK = { unknown: -1, absent: 0, missing: 1, partial: 2, cached: 3, loaded: 4 };

function getTranslationCacheState(modelName) {
  const detail = describeTranslationModel(modelCacheReport, modelName);
  if (isLocalTranslationLoaded(modelName)) return { ...detail, state: "loaded" };
  // The record says this pair was downloaded, so an empty cache means eviction.
  if (detail.state === "absent" && getDownloadedModels().includes(modelName)) return { ...detail, state: "missing" };
  return detail;
}
function describeCacheDetail(detail) {
  const parts = [];
  if (detail.bytes) parts.push(formatBytes(detail.bytes));
  if (detail.files) parts.push(`${detail.files} file${detail.files === 1 ? "" : "s"}`);
  if (detail.files && detail.missing?.length) parts.push(`${detail.missing.length} missing`);
  return parts.join(" · ") || CACHE_STATE_HINTS[detail.state] || "";
}
function appendModelRow(label, detail, modelName) {
  const item = document.createElement("li");
  item.className = "model-item";
  item.dataset.state = detail.state;
  if (modelName) item.dataset.model = modelName;
  const dot = document.createElement("span"); dot.className = "model-dot";
  const name = document.createElement("span"); name.className = "model-name"; name.textContent = label;
  const meta = document.createElement("span"); meta.className = "model-meta"; meta.textContent = detail.note ?? describeCacheDetail(detail);
  const state = document.createElement("span"); state.className = "model-state"; state.textContent = CACHE_STATE_LABELS[detail.state] || detail.state;
  item.append(dot, name, meta, state);
  modelCacheListEl.appendChild(item);
}
function getTrackedTranslationModels() {
  const selected = isConversationMode() ? getConversationModels() : [getCurrentLanguageSelection().modelName].filter(Boolean);
  // Anything sitting in Cache Storage is listed too, even when this device kept no
  // record of downloading it (a different browser profile, or a cleared localStorage).
  const cached = [...new Set(Object.values(LANGUAGE_MODEL_MAP))].filter((model) => describeTranslationModel(modelCacheReport, model).files > 0);
  return [...new Set([...selected, ...getDownloadedModels(), ...cached])];
}
function renderModelCacheList() {
  if (!modelCacheListEl) return;
  modelCacheListEl.textContent = "";
  const models = getTrackedTranslationModels();
  if (!models.length) appendModelRow("Translation model", { state: "unknown", files: 0, bytes: 0, note: "This language pair has no local model." });
  for (const modelName of models) appendModelRow(getLanguagePairLabelForModel(modelName), getTranslationCacheState(modelName), modelName);
  appendModelRow("Speech recognition (Nemotron)", describeAsrModel(modelCacheReport));
}
function describeLastCacheCheck() {
  return lastCacheCheck ? ` Checked ${lastCacheCheck.toLocaleTimeString()}.` : "";
}
function renderStorageUsage() {
  if (!storageUsageEl) return;
  if (!modelCacheReport?.supported) { storageUsageEl.textContent = "This browser cannot report cached model storage."; return; }
  const { usage, quota } = modelCacheReport;
  if (!usage) { storageUsageEl.textContent = `Model status is verified against the browser cache.${describeLastCacheCheck()}`; return; }
  storageUsageEl.textContent = quota
    ? `Site storage: ${formatBytes(usage)} used of about ${formatBytes(quota)} available.${describeLastCacheCheck()}`
    : `Site storage: ${formatBytes(usage)} used.${describeLastCacheCheck()}`;
}
function setModelDownloadProgress(modelName, ratio, label) {
  const item = Array.from(modelCacheListEl?.children || []).find((row) => row.dataset.model === modelName);
  if (!item) return;
  let bar = item.querySelector(".model-progress");
  if (!bar) { bar = document.createElement("div"); bar.className = "model-progress"; bar.appendChild(document.createElement("span")); item.appendChild(bar); }
  bar.firstElementChild.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
  const meta = item.querySelector(".model-meta");
  if (meta) meta.textContent = label;
}
async function refreshModelCacheView({ refresh = false } = {}) {
  if (refresh) invalidateModelCacheReport();
  const token = ++cacheViewToken;
  // A rescan that finds nothing new would otherwise look like a dead button.
  if (refresh && refreshModelCacheBtn) { refreshModelCacheBtn.disabled = true; refreshModelCacheBtn.textContent = "Checking\u2026"; }
  try {
    const report = await getModelCacheReport();
    // A newer refresh already rendered, so this result is stale.
    if (token !== cacheViewToken) return;
    modelCacheReport = report;
    lastCacheCheck = new Date();
    updateOfflinePairStatus();
    renderModelCacheList();
    renderStorageUsage();
  } finally {
    if (refresh && refreshModelCacheBtn) { refreshModelCacheBtn.disabled = false; refreshModelCacheBtn.textContent = "Recheck cache"; }
  }
}
function setPairStatus(text, state, badgeText) {
  if (offlinePairStatusEl) offlinePairStatusEl.textContent = text;
  if (!offlineReadyBadgeEl) return;
  offlineReadyBadgeEl.dataset.state = state;
  offlineReadyBadgeEl.textContent = badgeText;
}
function updateOfflinePairStatus() {
  if (!offlinePairStatusEl) return;
  if (isConversationMode()) { updateConversationOfflineStatus(); return; }
  const { sourceLanguage, targetLanguage, modelName } = getCurrentLanguageSelection();
  if (!modelName) { setPairStatus(`Unsupported pair: ${sourceLanguage} → ${targetLanguage}`, "unknown", "Unsupported pair"); if (removeSelectedModelBtn) removeSelectedModelBtn.disabled = true; return; }
  const detail = getTranslationCacheState(modelName);
  const pair = `${sourceLanguage} → ${targetLanguage}`;
  const messages = {
    loaded: `${pair} is loaded in memory and cached for offline use.`,
    cached: `${pair} is cached on this device (${describeCacheDetail(detail)}).`,
    partial: `${pair} is only partly cached; download it again to finish.`,
    missing: `${pair} was downloaded before, but the files are no longer in the browser cache.`,
    absent: `${pair} is not downloaded yet.`,
    unknown: `${pair} cache status cannot be verified in this browser.`,
  };
  setPairStatus(messages[detail.state], detail.state, CACHE_STATE_BADGES[detail.state]);
  if (removeSelectedModelBtn) removeSelectedModelBtn.disabled = !detail.files && !getDownloadedModels().includes(modelName);
}
function updateConversationOfflineStatus() {
  const { sideA, sideB } = getConversationSides();
  const models = getConversationModels();
  if (models.length < 2) { setPairStatus(`${sideA} ↔ ${sideB} is missing a translation model in one direction.`, "unknown", "Unsupported pair"); if (removeSelectedModelBtn) removeSelectedModelBtn.disabled = true; return; }
  const details = models.map(getTranslationCacheState);
  const weakest = details.reduce((lowest, detail) => (CACHE_STATE_RANK[detail.state] < CACHE_STATE_RANK[lowest.state] ? detail : lowest));
  const ready = details.filter((detail) => detail.state === "loaded" || detail.state === "cached").length;
  const bytes = details.reduce((total, detail) => total + detail.bytes, 0);
  setPairStatus(ready === 2
    ? `${sideA} ↔ ${sideB} is cached in both directions${bytes ? ` (${formatBytes(bytes)})` : ""}.`
    : `${sideA} ↔ ${sideB} still needs ${2 - ready} direction(s) cached.`, weakest.state, ready === 2 ? "Ready offline" : CACHE_STATE_BADGES[weakest.state]);
  if (removeSelectedModelBtn) removeSelectedModelBtn.disabled = details.every((detail) => !detail.files) && !models.some((model) => getDownloadedModels().includes(model));
}
function renderLanguageOptions(selectEl, values, selectedValue) { if (!selectEl) return; selectEl.innerHTML = values.map((value) => `<option value="${value}">${value}</option>`).join(""); selectEl.value = values.includes(selectedValue) ? selectedValue : values[0] || ""; }
function syncLanguageSelectors(preferredSource, preferredTarget) {
  const supportedSources = Object.keys(SUPPORTED_LANGUAGE_PAIRS);
  renderLanguageOptions(sourceLanguageEl, supportedSources, preferredSource || getSavedSourceLanguage());
  const activeSource = sourceLanguageEl?.value || supportedSources[0];
  renderLanguageOptions(targetLanguageEl, SUPPORTED_LANGUAGE_PAIRS[activeSource] || [], preferredTarget || getSavedTargetLanguage());
  if (sourceLanguageEl?.value) saveSourceLanguage(sourceLanguageEl.value);
  if (targetLanguageEl?.value) saveTargetLanguage(targetLanguageEl.value);
  if (swapLanguagesBtn) swapLanguagesBtn.disabled = !(SUPPORTED_LANGUAGE_PAIRS[targetLanguageEl?.value || ""] || []).includes(sourceLanguageEl?.value || "");
  void refreshModelCacheView();
}
function syncInput() { if (translationInputEl) translationInputEl.value = getSavedInput(); syncLanguageSelectors(); }

function isConversationMode() { return Boolean(conversationModeEl?.checked); }
function getSavedConversationMode() { try { return localStorage.getItem(CONVERSATION_MODE_STORAGE_KEY) === "true"; } catch { return false; } }
function saveConversationMode(value) { try { localStorage.setItem(CONVERSATION_MODE_STORAGE_KEY, String(value)); } catch {} }
function getSavedConversationSide(key, fallback) { try { return localStorage.getItem(key) || fallback; } catch { return fallback; } }
function saveConversationSides() { try { localStorage.setItem(CONVERSATION_SIDE_A_STORAGE_KEY, conversationSideAEl?.value || "English"); localStorage.setItem(CONVERSATION_SIDE_B_STORAGE_KEY, conversationSideBEl?.value || "Spanish"); } catch {} }
function getConversationSides() { return { sideA: conversationSideAEl?.value || "English", sideB: conversationSideBEl?.value || "Spanish" }; }
function getConversationModels() {
  const { sideA, sideB } = getConversationSides();
  return [LANGUAGE_MODEL_MAP[`${sideA}:${sideB}`], LANGUAGE_MODEL_MAP[`${sideB}:${sideA}`]].filter(Boolean);
}
function getDefaultConversationPartner() { return CONVERSATION_PARTNER_LANGUAGES.includes("Spanish") ? "Spanish" : CONVERSATION_PARTNER_LANGUAGES[0]; }
// Every opus-mt route pivots through English, so exactly one side has to be English.
function normalizeConversationSides(changedSide) {
  const changed = changedSide === "a" ? conversationSideAEl : conversationSideBEl;
  const other = changedSide === "a" ? conversationSideBEl : conversationSideAEl;
  if (!changed || !other) return;
  if (changed.value !== "English") { other.value = "English"; return; }
  if (other.value === "English") other.value = getDefaultConversationPartner();
}
function syncConversationSelectors() {
  const options = ["English", ...CONVERSATION_PARTNER_LANGUAGES];
  renderLanguageOptions(conversationSideAEl, options, getSavedConversationSide(CONVERSATION_SIDE_A_STORAGE_KEY, "English"));
  renderLanguageOptions(conversationSideBEl, options, getSavedConversationSide(CONVERSATION_SIDE_B_STORAGE_KEY, getDefaultConversationPartner()));
  normalizeConversationSides("a");
  saveConversationSides();
}
function syncConversationUi() {
  const on = isConversationMode();
  if (conversationModeEl) conversationModeEl.checked = on;
  if (conversationRowEl) conversationRowEl.hidden = !on;
  if (conversationHintEl) conversationHintEl.hidden = !on;
  if (manualLanguageRowEl) manualLanguageRowEl.hidden = on;
  void refreshModelCacheView();
}
// Detected speech routes to whichever side did not speak; anything off the roster
// falls back to English, which conversation mode guarantees is one of the two sides.
function resolveConversationRoute(detected) {
  const { sideA, sideB } = getConversationSides();
  if (detected === sideA) return { sourceLanguage: sideA, targetLanguage: sideB };
  if (detected === sideB) return { sourceLanguage: sideB, targetLanguage: sideA };
  const english = sideA === "English" ? "English" : sideB;
  const partner = sideA === "English" ? sideB : sideA;
  const sourceLanguage = detected || partner;
  return { sourceLanguage, targetLanguage: sourceLanguage === english ? partner : english };
}
function getActiveRoute() {
  if (isConversationMode()) return { ...resolveConversationRoute(live.currentLanguage || getConversationSides().sideA), turnId: live.turnId };
  const { sourceLanguage, targetLanguage } = getCurrentLanguageSelection();
  return { sourceLanguage, targetLanguage, turnId: live.turnId };
}
function getPreferredEnglishTarget() {
  const targets = SUPPORTED_LANGUAGE_PAIRS.English || [];
  if (targets.includes(preferredEnglishTarget)) return preferredEnglishTarget;
  const saved = getSavedTargetLanguage();
  if (targets.includes(saved)) return saved;
  return targets.includes("Spanish") ? "Spanish" : targets[0];
}
function applyDetectedSourceLanguage(locale) {
  const detected = findLanguageByLocale(locale);
  if (!detected || sourceLanguageEl?.value === detected) return;
  const targets = SUPPORTED_LANGUAGE_PAIRS[detected];
  if (!targets?.length) { log(`no translation model available for detected language: ${detected}`); return; }
  const nextTarget = detected === "English" ? getPreferredEnglishTarget() : "English";
  syncLanguageSelectors(detected, nextTarget);
  log(`detected speech language: ${detected} → ${targetLanguageEl?.value || nextTarget}`);
}
function syncSpeakResponsesInput() { if (speakResponsesEl) speakResponsesEl.checked = getSavedSpeakResponses(); }
function stopSpeaking() { if ("speechSynthesis" in window) window.speechSynthesis.cancel(); isSpeakingResponse = false; setLocalConversationState("ok", "ready"); }
function speakText(text, { queue = false } = {}) {
  // Conversation mode produces alternating languages, so synthesised speech is suppressed.
  if (isConversationMode()) return;
  if (!getSavedSpeakResponses() || !text || !("speechSynthesis" in window)) return;
  // Live segments queue up so an earlier sentence is not cut off by the next one.
  if (!queue) stopSpeaking();
  const utterance = new SpeechSynthesisUtterance(text); utterance.rate = 1; utterance.pitch = 1;
  utterance.onstart = () => { isSpeakingResponse = true; setLocalConversationState("warn", "speaking"); setLocalRecordingStatus("Speaking translation..."); };
  utterance.onend = () => { isSpeakingResponse = false; setLocalConversationState("ok", "ready"); setLocalRecordingStatus(live.active ? "Listening…" : "Text translation mode"); };
  utterance.onerror = () => { isSpeakingResponse = false; setLocalConversationState("err", "speech error"); };
  window.speechSynthesis.speak(utterance);
}
async function loadLocalModel() {
  try {
    if (!isLocalTranslationEnabled()) throw new Error("Local translation model is not enabled in config.js");
    const { sourceLanguage, targetLanguage, modelName } = getCurrentLanguageSelection();
    if (!modelName) throw new Error(`Language pair not supported yet: ${sourceLanguage} → ${targetLanguage}`);
    setLocalConversationState("warn", "loading model"); setLocalModelStatus("Loading local model..."); log("loading local translation model"); log("using translation model:", modelName);
    activeDownloadModel = modelName;
    await preloadLocalTranslation(modelName); setLocalConversationState("ok", "ready"); setLocalModelStatus("Local model loaded"); await refreshModelCacheView({ refresh: true }); log("local translation model loaded");
  } catch (error) { setLocalConversationState("err", "load failed"); setLocalModelStatus("Local model failed to load"); log("local model load failed:", error instanceof Error ? error.message : String(error)); } finally { activeDownloadModel = null; }
}
async function downloadOfflineModels() {
  try {
    if (!isLocalTranslationEnabled()) throw new Error("Local translation model is not enabled in config.js");
    // A conversation needs both directions cached before it can run offline.
    const models = isConversationMode() ? getConversationModels() : [getCurrentLanguageSelection().modelName].filter(Boolean);
    if (!models.length) { const { sourceLanguage, targetLanguage } = getCurrentLanguageSelection(); throw new Error(`Language pair not supported yet: ${sourceLanguage} → ${targetLanguage}`); }
    setLocalConversationState("warn", "downloading model"); setLocalModelStatus("Downloading selected model..."); setLocalRecordingStatus("Preparing selected offline model..."); log("downloading selected offline translation model");
    for (const modelName of models) { log("using translation model:", modelName); activeDownloadModel = modelName; await preloadLocalTranslation(modelName); saveDownloadedModel(modelName); }
    await refreshModelCacheView({ refresh: true }); setLocalConversationState("ok", "offline ready"); setLocalModelStatus("Selected model downloaded"); setLocalRecordingStatus("Selected offline model ready"); log("selected offline translation model downloaded");
  } catch (error) { setLocalConversationState("err", "download failed"); setLocalModelStatus("Offline model download failed"); setLocalRecordingStatus("Offline download failed"); log("offline model download failed:", error instanceof Error ? error.message : String(error)); void refreshModelCacheView({ refresh: true }); } finally { activeDownloadModel = null; }
}
function runExclusive(task) { const run = inferenceChain.then(task, task); inferenceChain = run.then(() => undefined, () => undefined); return run; }
async function runLocalTranslation() {
  if (runningLocalInference) return;
  try {
    runningLocalInference = true;
    if (!isLocalTranslationEnabled()) throw new Error("Local translation model is not enabled in config.js");
    const inputText = (translationInputEl?.value || getSavedInput() || "").trim(); if (!inputText) throw new Error("Enter translation text first");
    const { sourceLanguage, targetLanguage, modelName } = getCurrentLanguageSelection(); if (!modelName) throw new Error(`Language pair not supported yet: ${sourceLanguage} → ${targetLanguage}`);
    setLocalConversationState("warn", "thinking"); setLocalModelStatus("Loading / running local model..."); setLocalRecordingStatus("Running local translation..."); log("running local translation"); log("translation input:", inputText); log("using translation model:", modelName);
    const text = await runExclusive(() => runLocalTranslationPrompt({ prompt: inputText, model: modelName, onToken: (chunk) => { if (chunk?.trim()) log("local output:", chunk); } }));
    if (!text?.trim()) throw new Error("Model returned empty translation output");
    setLocalConversationState(getSavedSpeakResponses() ? "warn" : "ok", getSavedSpeakResponses() ? "preparing speech" : "ready"); setLocalModelStatus("Local model complete"); setLocalRecordingStatus("Translation complete"); setTranslationOutput(text); log("translation:", text); speakText(text);
  } catch (error) { setLocalConversationState("err", "inference failed"); setLocalModelStatus("Local model failed"); setLocalRecordingStatus("Translation failed"); log("local run failed:", error instanceof Error ? error.message : String(error)); } finally { runningLocalInference = false; }
}

function resetLiveTranslation() {
  clearTimeout(live.idleTimer);
  Object.assign(live, { session: live.session + 1, committed: 0, lastText: "", tail: "", rows: [], preview: "", previewSource: "", previewRoute: null, queue: [], idleTimer: null, langApplied: false, markCursor: 0, tagOrientation: null, currentLanguage: null, turnId: 0, rowSeq: 0, turnLanguages: {} });
}
function appendConversationRow(route, source, translated) {
  const last = live.rows[live.rows.length - 1];
  // Rows merge only inside one speaker turn, so a late tag can re-route the whole turn.
  if (last && last.turnId === route.turnId) {
    last.source = `${last.source} ${source}`.trim();
    last.translated = `${last.translated} ${translated}`.trim();
    return;
  }
  live.rows.push({ id: (live.rowSeq += 1), turnId: route.turnId, sourceLanguage: route.sourceLanguage, targetLanguage: route.targetLanguage, source, translated });
}
function getDisplayRows() {
  const rows = live.rows.map((row) => ({ ...row }));
  if (!live.previewSource) return rows;
  const route = live.previewRoute || getActiveRoute();
  const last = rows[rows.length - 1];
  if (last && last.turnId === route.turnId) {
    last.sourcePreview = live.previewSource; last.translatedPreview = live.preview;
    return rows;
  }
  rows.push({ ...route, source: "", translated: "", sourcePreview: live.previewSource, translatedPreview: live.preview });
  return rows;
}
function appendTurnText(parent, text, preview) {
  // textContent keeps model output inert; never build these nodes from an HTML string.
  parent.textContent = text || "";
  if (!preview) return;
  const span = document.createElement("span");
  span.className = "live-preview";
  span.textContent = `${text ? " " : ""}${preview}`;
  parent.appendChild(span);
}
function buildTurnElement(row, sideA) {
  const wrap = document.createElement("div");
  wrap.className = "turn";
  wrap.dataset.side = row.sourceLanguage === sideA ? "a" : "b";
  const label = document.createElement("div");
  label.className = "turn-lang";
  label.textContent = `${row.sourceLanguage} \u2192 ${row.targetLanguage}`;
  const source = document.createElement("div");
  source.className = "turn-source";
  appendTurnText(source, row.source, row.sourcePreview);
  const target = document.createElement("div");
  target.className = "turn-target";
  appendTurnText(target, row.translated, row.translatedPreview);
  wrap.append(label, source, target);
  return wrap;
}
function renderLiveTranslation() {
  if (!translationOutputEl) return;
  const rows = getDisplayRows();
  translationOutputEl.textContent = "";
  if (!rows.length) {
    translationOutputEl.textContent = live.active ? "Listening\u2026" : DEFAULT_TRANSLATION_OUTPUT;
    return;
  }
  const { sideA } = getConversationSides();
  for (const row of rows) translationOutputEl.appendChild(buildTurnElement(row, sideA));
  translationOutputEl.scrollTop = translationOutputEl.scrollHeight;
}
function lastSentenceEnd(text) {
  const boundary = /[.!?…。！？]+["'”’)\]]*(?=\s|$)/g;
  let end = 0; let match;
  while ((match = boundary.exec(text)) !== null) end = match.index + match[0].length;
  return end;
}
function countWords(text) { return (text.match(/\S+/g) || []).length; }
function queueLiveSegment(segment) {
  const trimmed = segment.trim();
  // Skip fragments that are only punctuation; they advance the cursor but carry no meaning.
  if (!trimmed || !/[\p{L}\p{N}]/u.test(trimmed)) return;
  // The route is captured now because the speaker can change before this segment is translated.
  live.queue.push({ source: trimmed, route: getActiveRoute() });
  live.preview = ""; live.previewSource = ""; live.previewRoute = null;
}
async function translateLiveSegment(sourceText, route) {
  const modelName = LANGUAGE_MODEL_MAP[`${route.sourceLanguage}:${route.targetLanguage}`];
  if (!modelName) { log(`live translation skipped, unsupported pair: ${route.sourceLanguage} → ${route.targetLanguage}`); return ""; }
  try { return (await runExclusive(() => runLocalTranslationPrompt({ prompt: sourceText, model: modelName }))) || ""; }
  catch (error) { log("live translation failed:", error instanceof Error ? error.message : String(error)); return ""; }
}
function pumpLiveTranslation() {
  if (live.busy) { live.dirty = true; return; }
  live.busy = true;
  void (async () => {
    const session = live.session;
    try {
      do {
        live.dirty = false;
        while (live.queue.length) {
          const item = live.queue.shift();
          // A tag can confirm this turn's language after the segment was queued or while it translates.
          const route = correctRoute(item.route);
          const text = await translateLiveSegment(item.source, route);
          if (live.session !== session) return;
          // The row is recorded even when translation fails so the transcript itself is never lost.
          if (item.rowId) { const row = live.rows.find((candidate) => candidate.id === item.rowId); if (row) { Object.assign(row, { sourceLanguage: route.sourceLanguage, targetLanguage: route.targetLanguage, translated: text }); } }
          else appendConversationRow(route, item.source, text);
          live.preview = ""; live.previewSource = ""; live.previewRoute = null; renderLiveTranslation(); speakText(text, { queue: true });
        }
        const tail = live.tail.trim();
        // The tail is retranslated from scratch as it grows, so only the newest result is kept.
        if (tail && tail !== live.previewSource && live.active) {
          const route = getActiveRoute();
          const text = await translateLiveSegment(tail, route);
          if (live.session !== session) return;
          if (!live.queue.length && live.tail.trim() === tail) { live.preview = text; live.previewSource = tail; live.previewRoute = route; renderLiveTranslation(); }
        }
      } while (live.dirty);
    } finally { live.busy = false; }
  })();
}
function scheduleLiveTailFlush() {
  clearTimeout(live.idleTimer);
  live.idleTimer = setTimeout(() => {
    if (!live.active || !live.tail.trim()) return;
    live.committed += live.tail.length; queueLiveSegment(live.tail); live.tail = ""; pumpLiveTranslation();
  }, LIVE_TAIL_IDLE_MS);
}
function commitLiveRange(text, end) {
  const boundary = Math.min(end, text.length);
  if (boundary <= live.committed) return;
  queueLiveSegment(text.slice(live.committed, boundary));
  live.committed = boundary;
}
// A trailing tag only names its language once the utterance has ended, by which time the text
// may already be translated, queued, or on screen under the previous speaker's direction.
// `turnLanguages` records the confirmed answer so every one of those cases can be corrected.
function correctRoute(route) {
  const confirmed = live.turnLanguages[route.turnId];
  if (!confirmed || confirmed === route.sourceLanguage) return route;
  return { ...resolveConversationRoute(confirmed), turnId: route.turnId };
}
function retagCurrentTurn(language) {
  const route = resolveConversationRoute(language);
  let changed = false;
  for (const row of live.rows) {
    if (row.turnId !== live.turnId || row.sourceLanguage === route.sourceLanguage) continue;
    log(`retagged turn: ${row.sourceLanguage} → ${row.targetLanguage} became ${route.sourceLanguage} → ${route.targetLanguage}`);
    row.sourceLanguage = route.sourceLanguage; row.targetLanguage = route.targetLanguage; row.translated = "";
    live.queue.push({ source: row.source, route: { ...route, turnId: row.turnId }, rowId: row.id });
    changed = true;
  }
  if (changed) renderLiveTranslation();
}
// Nemotron may announce the language before an utterance or confirm it afterwards.
// The offset of the first tag reveals which, and that answer holds for the whole session.
function processLangMarks(text, marks) {
  if (!Array.isArray(marks) || live.markCursor >= marks.length) return false;
  while (live.markCursor < marks.length) {
    const mark = marks[live.markCursor];
    live.markCursor += 1;
    if (!live.tagOrientation) live.tagOrientation = mark.index <= 1 ? "leading" : "trailing";
    const language = findLanguageByLocale(mark.lang);
    if (live.tagOrientation === "trailing") {
      if (language && language !== live.currentLanguage) {
        live.turnLanguages[live.turnId] = language;
        retagCurrentTurn(language);
        live.currentLanguage = language;
      }
      commitLiveRange(text, mark.index);
      // Every tag closes a turn, so later text can never merge into the row before it.
      live.turnId += 1;
    } else {
      commitLiveRange(text, mark.index);
      live.turnId += 1;
      if (language) { live.currentLanguage = language; live.turnLanguages[live.turnId] = language; }
    }
    if (language) log(`speaker turn (${live.tagOrientation} ${mark.lang} @${mark.index}): ${language} \u2192 ${resolveConversationRoute(language).targetLanguage}`);
  }
  return true;
}
function handleLivePartial(text, marks) {
  const conversation = isConversationMode();
  // A tag is stripped from the text, so the partial that carries it can look unchanged.
  // Turns are resolved before the guard below, which exists only to keep the idle timer alive.
  if (conversation && processLangMarks(text, marks)) pumpLiveTranslation();
  // Unchanged partials mean silence, so leave the idle timer running to settle the tail.
  if (text === live.lastText) return;
  live.lastText = text;
  // With trailing tags a finished sentence has no language yet, so the tag is the only safe
  // commit boundary; the idle flush and the word cap below still act as backstops.
  const trailingTurns = conversation && live.tagOrientation === "trailing";
  const sentenceEnd = trailingTurns ? 0 : lastSentenceEnd(text.slice(live.committed));
  const sentence = sentenceEnd > 0 ? text.slice(live.committed, live.committed + sentenceEnd) : "";
  // One-word "sentences" are usually abbreviations such as "Mr."; the idle flush handles real ones.
  if (countWords(sentence) >= 2) { queueLiveSegment(sentence); live.committed += sentenceEnd; }
  live.tail = text.slice(live.committed);
  if (countWords(live.tail) >= LIVE_FORCE_COMMIT_WORDS) {
    const cut = live.tail.lastIndexOf(" ");
    if (cut > 0) { queueLiveSegment(live.tail.slice(0, cut)); live.committed += cut; live.tail = text.slice(live.committed); }
  }
  scheduleLiveTailFlush(); pumpLiveTranslation();
}
function finishLiveTranslation(text, marks) {
  clearTimeout(live.idleTimer); live.idleTimer = null;
  if (isConversationMode()) processLangMarks(text, marks);
  const tail = text.slice(live.committed);
  live.committed = text.length; live.tail = ""; live.lastText = text; live.preview = ""; live.previewSource = ""; live.previewRoute = null;
  queueLiveSegment(tail); pumpLiveTranslation();
}
function getTranscriptText() {
  if (!live.rows.length) return translationOutputEl?.textContent?.trim() || "";
  return live.rows.map((row) => `[${row.sourceLanguage} → ${row.targetLanguage}]\n${row.source}\n${row.translated}`).join("\n\n");
}

saveContextBtn?.addEventListener("click", () => { const value = translationInputEl?.value || ""; saveInput(value); saveSourceLanguage(sourceLanguageEl?.value || "English"); saveTargetLanguage(targetLanguageEl?.value || "Spanish"); log("saved translation input"); });
clearTextBtn?.addEventListener("click", () => { if (translationInputEl) translationInputEl.value = ""; saveInput(""); });
copyTranslationBtn?.addEventListener("click", async () => { const text = getTranscriptText(); if (!text || text === DEFAULT_TRANSLATION_OUTPUT) return; try { await navigator.clipboard.writeText(text); log("copied translation"); } catch { log("copy translation failed"); } });
clearOutputBtn?.addEventListener("click", () => { live.rows = []; live.preview = ""; live.previewSource = ""; live.previewRoute = null; setTranslationOutput(""); });
quickPhraseButtons.forEach((button) => button.addEventListener("click", () => { const phrase = button.getAttribute("data-phrase") || ""; if (translationInputEl) translationInputEl.value = phrase; saveInput(phrase); }));
sourceLanguageEl?.addEventListener("change", () => { saveSourceLanguage(sourceLanguageEl.value); syncLanguageSelectors(); });
targetLanguageEl?.addEventListener("change", () => { saveTargetLanguage(targetLanguageEl.value); if (sourceLanguageEl?.value === "English") preferredEnglishTarget = targetLanguageEl.value; syncLanguageSelectors(sourceLanguageEl?.value, targetLanguageEl.value); });
swapLanguagesBtn?.addEventListener("click", () => { const currentSource = sourceLanguageEl?.value; const currentTarget = targetLanguageEl?.value; if (!currentSource || !currentTarget) return; if (!(SUPPORTED_LANGUAGE_PAIRS[currentTarget] || []).includes(currentSource)) { log(`swap not supported for: ${currentSource} → ${currentTarget}`); return; } syncLanguageSelectors(currentTarget, currentSource); log(`swapped languages: ${currentTarget} → ${currentSource}`); });
speakResponsesEl?.addEventListener("change", () => { saveSpeakResponses(Boolean(speakResponsesEl.checked)); log("speak responses:", speakResponsesEl.checked ? "enabled" : "disabled"); if (!speakResponsesEl.checked) stopSpeaking(); });
conversationModeEl?.addEventListener("change", () => { saveConversationMode(isConversationMode()); if (isConversationMode()) stopSpeaking(); syncConversationUi(); resetLiveTranslation(); setTranslationOutput(""); log("conversation mode:", isConversationMode() ? `${getConversationSides().sideA} \u2194 ${getConversationSides().sideB}` : "off"); });
conversationSideAEl?.addEventListener("change", () => { normalizeConversationSides("a"); saveConversationSides(); void refreshModelCacheView(); resetLiveTranslation(); renderLiveTranslation(); });
conversationSideBEl?.addEventListener("change", () => { normalizeConversationSides("b"); saveConversationSides(); void refreshModelCacheView(); resetLiveTranslation(); renderLiveTranslation(); });
window.addEventListener("local-translation-progress", (event) => {
  const detail = event.detail || {};
  const file = detail.file || detail.name || detail.status || "model";
  // `loaded`/`total` are unambiguous; `progress` is a 0-100 percentage when present.
  const ratio = Number.isFinite(detail.total) && detail.total > 0
    ? detail.loaded / detail.total
    : typeof detail.progress === "number" ? detail.progress / 100 : null;
  const percent = ratio == null ? "" : ` ${Math.round(ratio * 100)}%`;
  setLocalModelStatus(`Loading ${file}${percent}`);
  const modelName = detail.name || activeDownloadModel;
  if (modelName && ratio != null) setModelDownloadProgress(modelName, ratio, `Downloading ${file}${percent}`);
});
window.addEventListener("offline-translator:model-cache-changed", () => void refreshModelCacheView({ refresh: true }));
// Dispatching instead of refreshing directly lets asr-live.js re-verify its own badge too.
refreshModelCacheBtn?.addEventListener("click", () => window.dispatchEvent(new CustomEvent("offline-translator:model-cache-changed")));
runLocalBtn?.addEventListener("click", () => void runLocalTranslation());
window.addEventListener("offline-translator:asr-listening", (event) => {
  live.active = Boolean(event.detail?.listening);
  if (!live.active) { clearTimeout(live.idleTimer); live.idleTimer = null; return; }
  resetLiveTranslation(); setTranslationOutput("");
});
window.addEventListener("offline-translator:asr-transcript", (event) => {
  const detail = event.detail || {};
  const text = String(detail.text || "").trim();
  if (!text || !translationInputEl) return;
  translationInputEl.value = text;
  const conversation = isConversationMode();
  const liveMode = Boolean(detail.autoTranslate) && Boolean(detail.live) && isLocalTranslationEnabled();
  // Conversation mode routes every turn itself, so it must not rewrite the From/To selects.
  // Otherwise the model must be chosen before the first segment is translated, not after the session ends.
  if (liveMode && !conversation && detail.lang && !live.langApplied) { live.langApplied = true; applyDetectedSourceLanguage(detail.lang); }
  if (!detail.final) { setLocalRecordingStatus(liveMode ? "Translating while you speak…" : "Listening…"); if (liveMode) handleLivePartial(text, detail.langMarks); return; }
  saveInput(text); setLocalRecordingStatus("Final transcript ready");
  log(`live transcript${detail.lang ? ` (${detail.lang})` : ""}:`, text);
  if (!conversation) applyDetectedSourceLanguage(detail.lang);
  if (liveMode) finishLiveTranslation(text, detail.langMarks);
  else if (detail.autoTranslate) void runLocalTranslation();
});
toggleLogBtn?.addEventListener("click", () => { const isHidden = logEl.hasAttribute("hidden"); if (isHidden) { logEl.removeAttribute("hidden"); toggleLogBtn.textContent = "Hide activity"; } else { logEl.setAttribute("hidden", "hidden"); toggleLogBtn.textContent = "Show activity"; } });
downloadOfflineModelsBtn?.addEventListener("click", () => void downloadOfflineModels());
removeSelectedModelBtn?.addEventListener("click", async () => {
  const models = isConversationMode() ? getConversationModels() : [getCurrentLanguageSelection().modelName].filter(Boolean);
  if (!models.length) { const { sourceLanguage, targetLanguage } = getCurrentLanguageSelection(); log(`cannot remove unsupported pair: ${sourceLanguage} → ${targetLanguage}`); return; }
  for (const modelName of models) {
    await releaseLocalTranslation(modelName); removeDownloadedModel(modelName);
    // sw.js can only reach the app shell caches, so the model files are deleted here.
    const deleted = await deleteHuggingFaceModelCache(modelName);
    log(`removed ${modelName}: ${deleted} cached file(s) deleted`);
    if (navigator.serviceWorker?.controller) navigator.serviceWorker.controller.postMessage({ type: "REMOVE_MODEL_CACHE", modelName });
  }
  await refreshModelCacheView({ refresh: true });
});

if (conversationModeEl) conversationModeEl.checked = getSavedConversationMode();
syncConversationSelectors(); syncConversationUi();
syncInput(); syncSpeakResponsesInput(); void refreshModelCacheView({ refresh: true }); setTranslationOutput(""); setLocalModelStatus(isLocalTranslationEnabled() ? "Local translation available" : "Local translation disabled in config"); setLocalConversationState(isLocalTranslationEnabled() ? "warn" : "err", isLocalTranslationEnabled() ? "idle" : "disabled"); setLocalRecordingStatus("Text translation mode");