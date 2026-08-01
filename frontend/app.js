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
  findLanguageByLocale,
} from "./languages.js";

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
const downloadedPairsListEl = document.getElementById("downloadedPairsList");
const swapLanguagesBtn = document.getElementById("swapLanguages");
const removeSelectedModelBtn = document.getElementById("removeSelectedModel");
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

let runningLocalInference = false;
let isSpeakingResponse = false;
// Transformers.js pipelines are not re-entrant, so every model call goes through one chain.
let inferenceChain = Promise.resolve();
const live = { active: false, session: 0, committed: 0, lastText: "", tail: "", segments: [], preview: "", previewSource: "", queue: [], busy: false, dirty: false, idleTimer: null, langApplied: false };
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
function updateDownloadedPairsList() { if (!downloadedPairsListEl) return; const models = getDownloadedModels(); downloadedPairsListEl.textContent = models.length ? models.map(getLanguagePairLabelForModel).join(", ") : "None yet."; }
function updateOfflinePairStatus() {
  if (!offlinePairStatusEl) return;
  const { sourceLanguage, targetLanguage, modelName } = getCurrentLanguageSelection();
  if (!modelName) { offlinePairStatusEl.textContent = `Unsupported pair: ${sourceLanguage} → ${targetLanguage}`; if (offlineReadyBadgeEl) offlineReadyBadgeEl.textContent = "Unsupported pair"; return; }
  const downloaded = getDownloadedModels().includes(modelName);
  const loaded = isLocalTranslationLoaded(modelName);
  offlinePairStatusEl.textContent = loaded ? `${sourceLanguage} → ${targetLanguage} is loaded and ready.` : downloaded ? `${sourceLanguage} → ${targetLanguage} was downloaded; the browser cache will be verified when used.` : `${sourceLanguage} → ${targetLanguage} is not downloaded yet.`;
  if (offlineReadyBadgeEl) offlineReadyBadgeEl.textContent = loaded ? "Loaded" : downloaded ? "Downloaded" : "Needs download";
  if (removeSelectedModelBtn) removeSelectedModelBtn.disabled = !downloaded;
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
  updateOfflinePairStatus();
}
function syncInput() { if (translationInputEl) translationInputEl.value = getSavedInput(); syncLanguageSelectors(); }
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
    await preloadLocalTranslation(modelName); setLocalConversationState("ok", "ready"); setLocalModelStatus("Local model loaded"); updateOfflinePairStatus(); log("local translation model loaded");
  } catch (error) { setLocalConversationState("err", "load failed"); setLocalModelStatus("Local model failed to load"); log("local model load failed:", error instanceof Error ? error.message : String(error)); }
}
async function downloadOfflineModels() {
  try {
    if (!isLocalTranslationEnabled()) throw new Error("Local translation model is not enabled in config.js");
    const { sourceLanguage, targetLanguage, modelName } = getCurrentLanguageSelection();
    if (!modelName) throw new Error(`Language pair not supported yet: ${sourceLanguage} → ${targetLanguage}`);
    setLocalConversationState("warn", "downloading model"); setLocalModelStatus("Downloading selected model..."); setLocalRecordingStatus("Preparing selected offline model..."); log("downloading selected offline translation model"); log("using translation model:", modelName);
    await preloadLocalTranslation(modelName); saveDownloadedModel(modelName); updateDownloadedPairsList(); updateOfflinePairStatus(); setLocalConversationState("ok", "offline ready"); setLocalModelStatus("Selected model downloaded"); setLocalRecordingStatus("Selected offline model ready"); log("selected offline translation model downloaded");
  } catch (error) { setLocalConversationState("err", "download failed"); setLocalModelStatus("Offline model download failed"); setLocalRecordingStatus("Offline download failed"); log("offline model download failed:", error instanceof Error ? error.message : String(error)); }
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
  Object.assign(live, { session: live.session + 1, committed: 0, lastText: "", tail: "", segments: [], preview: "", previewSource: "", queue: [], idleTimer: null, langApplied: false });
}
function renderLiveTranslation() { setTranslationOutput(live.segments.join(" "), live.preview); }
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
  live.queue.push(trimmed); live.preview = ""; live.previewSource = "";
}
async function translateLiveSegment(sourceText) {
  const { sourceLanguage, targetLanguage, modelName } = getCurrentLanguageSelection();
  if (!modelName) { log(`live translation skipped, unsupported pair: ${sourceLanguage} → ${targetLanguage}`); return ""; }
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
          const text = await translateLiveSegment(live.queue.shift());
          if (live.session !== session) return;
          if (!text) continue;
          live.segments.push(text); live.preview = ""; live.previewSource = ""; renderLiveTranslation(); speakText(text, { queue: true });
        }
        const tail = live.tail.trim();
        // The tail is retranslated from scratch as it grows, so only the newest result is kept.
        if (tail && tail !== live.previewSource && live.active) {
          const text = await translateLiveSegment(tail);
          if (live.session !== session) return;
          if (text && !live.queue.length && live.tail.trim() === tail) { live.preview = text; live.previewSource = tail; renderLiveTranslation(); }
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
function handleLivePartial(text) {
  // Unchanged partials mean silence, so leave the idle timer running to settle the tail.
  if (text === live.lastText) return;
  live.lastText = text;
  const sentenceEnd = lastSentenceEnd(text.slice(live.committed));
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
function finishLiveTranslation(text) {
  clearTimeout(live.idleTimer); live.idleTimer = null;
  const tail = text.slice(live.committed);
  live.committed = text.length; live.tail = ""; live.lastText = text; live.preview = ""; live.previewSource = "";
  queueLiveSegment(tail); pumpLiveTranslation();
}

saveContextBtn?.addEventListener("click", () => { const value = translationInputEl?.value || ""; saveInput(value); saveSourceLanguage(sourceLanguageEl?.value || "English"); saveTargetLanguage(targetLanguageEl?.value || "Spanish"); log("saved translation input"); });
clearTextBtn?.addEventListener("click", () => { if (translationInputEl) translationInputEl.value = ""; saveInput(""); });
copyTranslationBtn?.addEventListener("click", async () => { const text = translationOutputEl?.textContent?.trim(); if (!text || text === DEFAULT_TRANSLATION_OUTPUT) return; try { await navigator.clipboard.writeText(text); log("copied translation"); } catch { log("copy translation failed"); } });
clearOutputBtn?.addEventListener("click", () => setTranslationOutput(""));
quickPhraseButtons.forEach((button) => button.addEventListener("click", () => { const phrase = button.getAttribute("data-phrase") || ""; if (translationInputEl) translationInputEl.value = phrase; saveInput(phrase); }));
sourceLanguageEl?.addEventListener("change", () => { saveSourceLanguage(sourceLanguageEl.value); syncLanguageSelectors(); });
targetLanguageEl?.addEventListener("change", () => { saveTargetLanguage(targetLanguageEl.value); if (sourceLanguageEl?.value === "English") preferredEnglishTarget = targetLanguageEl.value; syncLanguageSelectors(sourceLanguageEl?.value, targetLanguageEl.value); });
swapLanguagesBtn?.addEventListener("click", () => { const currentSource = sourceLanguageEl?.value; const currentTarget = targetLanguageEl?.value; if (!currentSource || !currentTarget) return; if (!(SUPPORTED_LANGUAGE_PAIRS[currentTarget] || []).includes(currentSource)) { log(`swap not supported for: ${currentSource} → ${currentTarget}`); return; } syncLanguageSelectors(currentTarget, currentSource); log(`swapped languages: ${currentTarget} → ${currentSource}`); });
speakResponsesEl?.addEventListener("change", () => { saveSpeakResponses(Boolean(speakResponsesEl.checked)); log("speak responses:", speakResponsesEl.checked ? "enabled" : "disabled"); if (!speakResponsesEl.checked) stopSpeaking(); });
window.addEventListener("local-translation-progress", (event) => { const detail = event.detail || {}; const file = detail.file || detail.name || detail.status || "model"; const progress = typeof detail.progress === "number" ? ` ${Math.round(detail.progress * 100)}%` : ""; setLocalModelStatus(`Loading ${file}${progress}`); });
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
  const liveMode = Boolean(detail.autoTranslate) && Boolean(detail.live) && isLocalTranslationEnabled();
  // The model must be chosen before the first segment is translated, not after the session ends.
  if (liveMode && detail.lang && !live.langApplied) { live.langApplied = true; applyDetectedSourceLanguage(detail.lang); }
  if (!detail.final) { setLocalRecordingStatus(liveMode ? "Translating while you speak…" : "Listening…"); if (liveMode) handleLivePartial(text); return; }
  saveInput(text); setLocalRecordingStatus("Final transcript ready");
  log(`live transcript${detail.lang ? ` (${detail.lang})` : ""}:`, text);
  applyDetectedSourceLanguage(detail.lang);
  if (liveMode) finishLiveTranslation(text);
  else if (detail.autoTranslate) void runLocalTranslation();
});
toggleLogBtn?.addEventListener("click", () => { const isHidden = logEl.hasAttribute("hidden"); if (isHidden) { logEl.removeAttribute("hidden"); toggleLogBtn.textContent = "Hide activity"; } else { logEl.setAttribute("hidden", "hidden"); toggleLogBtn.textContent = "Show activity"; } });
downloadOfflineModelsBtn?.addEventListener("click", () => void downloadOfflineModels());
removeSelectedModelBtn?.addEventListener("click", async () => { const { sourceLanguage, targetLanguage, modelName } = getCurrentLanguageSelection(); if (!modelName) { log(`cannot remove unsupported pair: ${sourceLanguage} → ${targetLanguage}`); return; } await releaseLocalTranslation(modelName); removeDownloadedModel(modelName); updateDownloadedPairsList(); updateOfflinePairStatus(); log("removed selected model readiness record:", modelName); log("browser-managed Transformers.js cache files may remain until browser storage is cleared"); if (navigator.serviceWorker?.controller) navigator.serviceWorker.controller.postMessage({ type: "REMOVE_MODEL_CACHE", modelName }); });

syncInput(); syncSpeakResponsesInput(); updateDownloadedPairsList(); setTranslationOutput(""); setLocalModelStatus(isLocalTranslationEnabled() ? "Local translation available" : "Local translation disabled in config"); setLocalConversationState(isLocalTranslationEnabled() ? "warn" : "err", isLocalTranslationEnabled() ? "idle" : "disabled"); setLocalRecordingStatus("Text translation mode");