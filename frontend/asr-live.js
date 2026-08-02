import { LANGUAGES, AUTO_DETECT_LANG_ID } from "./languages.js";
import {
  ASR_CACHE_NAME,
  ASR_REQUIRED_FILES,
  describeAsrModel,
  formatBytes,
  getModelCacheReport,
  invalidateModelCacheReport,
} from "./model-cache.js";

const SR = 16000;
const CHUNK_SAMPLES = 3200;
const ASR_LANGUAGE_STORAGE_KEY = "offline-translator-asr-language";
const state = { worker: null, ready: false, loading: false, listening: false, cached: false, requestId: 0, audioContext: null, stream: null, source: null, worklet: null, chunks: [], chunkLength: 0, langLocale: null };
const el = {
  status: document.getElementById("asrStatus"), progress: document.getElementById("asrProgress"), transcript: document.getElementById("asrTranscript"),
  load: document.getElementById("downloadAsrModel"), listen: document.getElementById("toggleLiveTranscription"), clear: document.getElementById("clearAsrModel"), autoTranslate: document.getElementById("autoTranslateTranscript"), liveTranslate: document.getElementById("liveTranslateTranscript"), language: document.getElementById("asrLanguage"), conversation: document.getElementById("conversationMode"),
};
function setStatus(text, kind = "warn") { if (!el.status) return; el.status.textContent = text; el.status.className = `status ${kind}`; }
function setProgress(text) { if (el.progress) el.progress.textContent = text; }
function setTranscript(text) { if (el.transcript) el.transcript.textContent = text || "Listening transcript will appear here."; }
function updateControls() {
  if (el.load) { el.load.disabled = state.ready || state.loading || state.listening; el.load.textContent = state.ready ? "ASR model ready" : state.loading ? "Downloading ASR model…" : state.cached ? "Load cached ASR model" : "Download ASR model"; }
  if (el.listen) { el.listen.disabled = !state.ready && !state.listening; el.listen.textContent = state.listening ? "Stop listening" : "Start listening"; }
  if (el.clear) el.clear.disabled = state.loading || state.listening || (!state.ready && !state.cached);
  // The language prompt is baked into the encoder state at streamStart, so it can only change between sessions.
  // A two-person conversation needs both languages recognised, which only auto-detect can do.
  if (el.language) {
    const conversationOn = Boolean(el.conversation?.checked);
    if (conversationOn) el.language.value = "auto";
    el.language.disabled = state.listening || conversationOn;
  }
}
function getSavedAsrLanguage() { try { return localStorage.getItem(ASR_LANGUAGE_STORAGE_KEY) || "auto"; } catch { return "auto"; } }
function saveAsrLanguage(value) { try { localStorage.setItem(ASR_LANGUAGE_STORAGE_KEY, value); } catch {} }
function renderAsrLanguageOptions() {
  if (!el.language) return;
  const saved = getSavedAsrLanguage();
  el.language.innerHTML = ['<option value="auto">Auto-detect</option>'].concat(Object.keys(LANGUAGES).map((name) => `<option value="${name}">${name}</option>`)).join("");
  el.language.value = LANGUAGES[saved] ? saved : "auto";
}
function getSelectedAsrLanguage() {
  const selected = el.conversation?.checked ? "auto" : el.language?.value || "auto";
  const info = LANGUAGES[selected];
  return info ? { langId: info.asrLangId, locale: info.asrLocale } : { langId: AUTO_DETECT_LANG_ID, locale: null };
}
function dispatchTranscript(text, lang, final, langMarks) { window.dispatchEvent(new CustomEvent("offline-translator:asr-transcript", { detail: { text, lang: lang || state.langLocale, langMarks: langMarks || [], final, autoTranslate: Boolean(el.autoTranslate?.checked), live: Boolean(el.liveTranslate?.checked) } })); }
function dispatchListeningState(listening) { window.dispatchEvent(new CustomEvent("offline-translator:asr-listening", { detail: { listening } })); }
function notifyModelCacheChanged() { invalidateModelCacheReport(); window.dispatchEvent(new CustomEvent("offline-translator:model-cache-changed", { detail: { source: "asr" } })); }
// The badge must reflect the real cache, not just whether this page session loaded the model:
// a fully cached 750 MB model should not read "not loaded" after a reload.
async function refreshCachedModelStatus() {
  const detail = describeAsrModel(await getModelCacheReport());
  state.cached = detail.state === "cached";
  if (state.ready || state.loading || state.listening) { updateControls(); return; }
  if (detail.state === "cached") { setStatus("ASR cached, not loaded", "ok"); setProgress(`Speech model is stored on this device (${formatBytes(detail.bytes) || "about 750 MB"}). Loading it into memory takes a few seconds.`); }
  else if (detail.state === "partial") { setStatus("ASR partly cached", "warn"); setProgress(`${detail.files} of ${ASR_REQUIRED_FILES.length} speech model files are cached; downloading fetches only what is missing.`); }
  else { setStatus("ASR model not downloaded", "warn"); setProgress("Download once, then the browser can reuse the cached model offline."); }
  updateControls();
}
function ensureWorker() {
  if (state.worker) return state.worker;
  const worker = new Worker(new URL("./asr/worker.js", import.meta.url), { type: "module" });
  worker.onmessage = (event) => {
    const message = event.data || {};
    if (message.requestId != null && message.requestId !== state.requestId) return;
    switch (message.type) {
      case "progress": { const amount = message.cached ? "cached" : message.total ? `${Math.round((message.loaded / message.total) * 100)}%` : `${Math.round((message.loaded || 0) / 1048576)} MB`; setProgress(`${message.label}: ${amount}`); break; }
      case "status": setProgress(message.detail || "Preparing speech model…"); break;
      case "ready": state.ready = true; state.loading = false; state.cached = true; setStatus(`ASR ready (${message.encoderEP || "WebGPU"})`, "ok"); setProgress("Model files are cached by the browser for later offline use."); updateControls(); notifyModelCacheChanged(); break;
      case "stream-ready": setStatus("Listening", "ok"); break;
      case "stream-tick": break;
      case "partial": setTranscript(message.text); dispatchTranscript(message.text, message.lang, false, message.langMarks); break;
      case "final": setTranscript(message.text); dispatchTranscript(message.text, message.lang, true, message.langMarks); setStatus(state.listening ? "Listening" : "ASR ready", "ok"); break;
      case "error": state.loading = false; void stopListening(false); setStatus("ASR error", "err"); setProgress(message.message || "Speech recognition failed."); updateControls(); break;
    }
  };
  worker.onerror = (event) => { state.loading = false; setStatus("ASR worker failed", "err"); setProgress(event.message || "Unable to start the speech worker."); updateControls(); };
  state.worker = worker; return worker;
}
async function loadModel() {
  if (state.ready || state.loading) return;
  if (!navigator.gpu) { setStatus("WebGPU unavailable", "err"); setProgress("Nemotron live transcription requires a WebGPU-capable browser and device."); return; }
  state.loading = true; setStatus(state.cached ? "Loading cached ASR" : "Downloading ASR", "warn"); setProgress(state.cached ? "Reading the speech model from the browser cache. No download needed." : "Downloading about 750 MB on first use. Keep this page open."); updateControls(); ensureWorker().postMessage({ type: "init" });
}
function flushAudio() {
  if (!state.worker || !state.listening || state.chunkLength === 0) return;
  const samples = new Float32Array(state.chunkLength); let offset = 0; for (const chunk of state.chunks) { samples.set(chunk, offset); offset += chunk.length; }
  state.chunks = []; state.chunkLength = 0; state.worker.postMessage({ type: "streamAudio", samples: samples.buffer, requestId: state.requestId }, [samples.buffer]);
}
function acceptAudio(frame) { if (!state.listening) return; state.chunks.push(frame); state.chunkLength += frame.length; if (state.chunkLength >= CHUNK_SAMPLES) flushAudio(); }
async function startListening() {
  if (state.listening || !state.ready) return;
  try {
    state.requestId += 1; state.chunks = []; state.chunkLength = 0;
    const { langId, locale } = getSelectedAsrLanguage(); state.langLocale = locale;
    state.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    state.audioContext = new AudioContext(); if (state.audioContext.state === "suspended") await state.audioContext.resume();
    await state.audioContext.audioWorklet.addModule(new URL("./asr/mic-processor.js", import.meta.url));
    state.source = state.audioContext.createMediaStreamSource(state.stream); state.worklet = new AudioWorkletNode(state.audioContext, "mic-processor", { processorOptions: { targetSampleRate: SR } });
    state.worklet.port.onmessage = (event) => acceptAudio(event.data); state.source.connect(state.worklet); state.worklet.connect(state.audioContext.destination); state.listening = true;
    setTranscript(""); setStatus("Starting microphone…", "warn"); dispatchListeningState(true); ensureWorker().postMessage({ type: "streamStart", langId, requestId: state.requestId }); updateControls();
  } catch (error) { await stopListening(false); setStatus("Microphone unavailable", "err"); setProgress(error?.name === "NotAllowedError" ? "Microphone permission was denied." : error?.message || String(error)); }
}
async function stopListening(finalize = true) {
  if (state.listening && finalize) { flushAudio(); state.worker?.postMessage({ type: "streamEnd", requestId: state.requestId }); }
  const wasListening = state.listening;
  state.listening = false; if (!finalize) state.requestId += 1;
  if (wasListening) dispatchListeningState(false);
  if (state.worklet) { state.worklet.port.onmessage = null; state.worklet.disconnect(); }
  state.source?.disconnect(); for (const track of state.stream?.getTracks?.() || []) track.stop(); if (state.audioContext && state.audioContext.state !== "closed") await state.audioContext.close();
  state.audioContext = null; state.stream = null; state.source = null; state.worklet = null; state.chunks = []; state.chunkLength = 0;
  if (state.ready) setStatus(finalize ? "Finishing transcript…" : "ASR ready", "warn"); updateControls();
}
async function clearModelCache() {
  if (state.listening) await stopListening(false);
  // Terminate first, then delete from the page: posting "clearCache" and calling
  // terminate() back to back can kill the worker before it handles the message.
  if (state.worker) { state.worker.terminate(); state.worker = null; }
  state.ready = false; state.loading = false;
  let cleared = true;
  try { await caches.delete(ASR_CACHE_NAME); } catch { cleared = false; }
  state.cached = !cleared;
  setStatus("ASR model not downloaded", "warn");
  setProgress(cleared ? "Download the speech model before starting live transcription." : "Could not remove the cached ASR model. Clear browser storage to reclaim the space.");
  updateControls();
  notifyModelCacheChanged();
}
el.load?.addEventListener("click", () => void loadModel());
el.listen?.addEventListener("click", () => void (state.listening ? stopListening(true) : startListening()));
el.clear?.addEventListener("click", () => void clearModelCache());
el.language?.addEventListener("change", () => saveAsrLanguage(el.language.value));
el.conversation?.addEventListener("change", () => updateControls());
// Skip events this module raised itself, so a failed removal keeps its error message.
window.addEventListener("offline-translator:model-cache-changed", (event) => { if (event.detail?.source !== "asr") void refreshCachedModelStatus(); });
window.addEventListener("pagehide", () => void stopListening(false));
document.addEventListener("visibilitychange", () => { if (document.hidden && state.listening) void stopListening(true); });
if (!navigator.gpu) { setStatus("WebGPU unavailable", "err"); setProgress("Manual text translation still works. Live Nemotron transcription is unavailable on this device."); } else { setStatus("Checking cached model…", "warn"); void refreshCachedModelStatus(); }
renderAsrLanguageOptions();
updateControls();