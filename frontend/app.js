import { isLocalTranslationEnabled, preloadLocalTranslation, runLocalTranslationPrompt } from "./local-translation.js";

const DEFAULT_TRANSLATION_OUTPUT = "Your translated text will appear here.";

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

const LANGUAGE_MODEL_MAP = {
  "English:Spanish": "Xenova/opus-mt-en-es",
  "Spanish:English": "Xenova/opus-mt-es-en",
  "English:German": "Xenova/opus-mt-en-de",
  "German:English": "Xenova/opus-mt-de-en",
};

const SUPPORTED_LANGUAGE_PAIRS = {
  English: ["Spanish", "German"],
  Spanish: ["English"],
  German: ["English"],
};

let runningLocalInference = false;
let isSpeakingResponse = false;

function log(...parts) {
  const line = parts.join(" ");
  console.log(line);
  logEl.textContent += line + "\n";
}

function setTranslationOutput(text) {
  if (translationOutputEl) {
    translationOutputEl.textContent = text || DEFAULT_TRANSLATION_OUTPUT;
  }
}

function setLocalModelStatus(text) {
  if (localModelStatusEl) {
    localModelStatusEl.textContent = text;
  }
}

function setLocalConversationState(kind, text) {
  if (localConversationStateEl) {
    localConversationStateEl.className = `status ${kind}`;
    localConversationStateEl.textContent = text;
  }
}

function setLocalRecordingStatus(text) {
  if (localRecordingStatusEl) {
    localRecordingStatusEl.textContent = text;
  }
}

function getSavedSpeakResponses() {
  try {
    return localStorage.getItem(SPEAK_RESPONSES_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function saveSpeakResponses(value) {
  try {
    localStorage.setItem(SPEAK_RESPONSES_STORAGE_KEY, String(value));
  } catch {
    // ignore storage errors
  }
}

function getSavedInput() {
  try {
    return localStorage.getItem(INPUT_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function saveInput(value) {
  try {
    localStorage.setItem(INPUT_STORAGE_KEY, value);
  } catch {
    // ignore storage errors
  }
}

function getSavedSourceLanguage() {
  try {
    return localStorage.getItem(SOURCE_LANGUAGE_STORAGE_KEY) || "English";
  } catch {
    return "English";
  }
}

function saveSourceLanguage(value) {
  try {
    localStorage.setItem(SOURCE_LANGUAGE_STORAGE_KEY, value);
  } catch {
    // ignore storage errors
  }
}

function getSavedTargetLanguage() {
  try {
    return localStorage.getItem(TARGET_LANGUAGE_STORAGE_KEY) || "Spanish";
  } catch {
    return "Spanish";
  }
}

function saveTargetLanguage(value) {
  try {
    localStorage.setItem(TARGET_LANGUAGE_STORAGE_KEY, value);
  } catch {
    // ignore storage errors
  }
}

function getCurrentLanguageSelection() {
  const sourceLanguage = sourceLanguageEl?.value || getSavedSourceLanguage();
  const targetLanguage = targetLanguageEl?.value || getSavedTargetLanguage();
  const modelKey = `${sourceLanguage}:${targetLanguage}`;
  const modelName = LANGUAGE_MODEL_MAP[modelKey];
  return { sourceLanguage, targetLanguage, modelKey, modelName };
}

function getDownloadedModels() {
  try {
    return JSON.parse(localStorage.getItem(DOWNLOADED_MODELS_STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveDownloadedModel(modelName) {
  const models = new Set(getDownloadedModels());
  models.add(modelName);
  try {
    localStorage.setItem(DOWNLOADED_MODELS_STORAGE_KEY, JSON.stringify([...models]));
  } catch {
    // ignore storage errors
  }
}

function removeDownloadedModel(modelName) {
  const models = getDownloadedModels().filter((model) => model !== modelName);
  try {
    localStorage.setItem(DOWNLOADED_MODELS_STORAGE_KEY, JSON.stringify(models));
  } catch {
    // ignore storage errors
  }
}

function getLanguagePairLabelForModel(modelName) {
  const entry = Object.entries(LANGUAGE_MODEL_MAP).find(([, value]) => value === modelName);
  if (!entry) {
    return modelName;
  }
  return entry[0].replace(":", " → ");
}

function updateDownloadedPairsList() {
  if (!downloadedPairsListEl) {
    return;
  }

  const models = getDownloadedModels();
  downloadedPairsListEl.textContent = models.length > 0
    ? models.map(getLanguagePairLabelForModel).join(", ")
    : "None yet.";
}

function updateOfflinePairStatus() {
  if (!offlinePairStatusEl) {
    return;
  }

  const { sourceLanguage, targetLanguage, modelName } = getCurrentLanguageSelection();
  if (!modelName) {
    offlinePairStatusEl.textContent = `Unsupported pair: ${sourceLanguage} → ${targetLanguage}`;
    if (offlineReadyBadgeEl) {
      offlineReadyBadgeEl.textContent = "Unsupported pair";
    }
    return;
  }

  const downloaded = getDownloadedModels().includes(modelName);
  offlinePairStatusEl.textContent = downloaded
    ? `${sourceLanguage} → ${targetLanguage} is downloaded for offline use.`
    : `${sourceLanguage} → ${targetLanguage} is not downloaded yet.`;

  if (offlineReadyBadgeEl) {
    offlineReadyBadgeEl.textContent = downloaded ? "Ready offline" : "Needs download";
  }

  if (removeSelectedModelBtn) {
    removeSelectedModelBtn.disabled = !downloaded;
  }
}

function renderLanguageOptions(selectEl, values, selectedValue) {
  if (!selectEl) {
    return;
  }

  selectEl.innerHTML = values
    .map((value) => `<option value="${value}">${value}</option>`)
    .join("");

  if (values.includes(selectedValue)) {
    selectEl.value = selectedValue;
  } else if (values.length > 0) {
    selectEl.value = values[0];
  }
}

function syncLanguageSelectors(preferredSource, preferredTarget) {
  const savedSource = preferredSource || getSavedSourceLanguage();
  const supportedSources = Object.keys(SUPPORTED_LANGUAGE_PAIRS);
  renderLanguageOptions(sourceLanguageEl, supportedSources, savedSource);

  const activeSource = sourceLanguageEl?.value || supportedSources[0];
  const supportedTargets = SUPPORTED_LANGUAGE_PAIRS[activeSource] || [];
  renderLanguageOptions(targetLanguageEl, supportedTargets, preferredTarget || getSavedTargetLanguage());

  if (sourceLanguageEl?.value) {
    saveSourceLanguage(sourceLanguageEl.value);
  }
  if (targetLanguageEl?.value) {
    saveTargetLanguage(targetLanguageEl.value);
  }

  if (swapLanguagesBtn) {
    const reverseTargets = SUPPORTED_LANGUAGE_PAIRS[targetLanguageEl?.value || ""] || [];
    swapLanguagesBtn.disabled = !reverseTargets.includes(sourceLanguageEl?.value || "");
  }

  updateOfflinePairStatus();
}

function syncInput() {
  if (translationInputEl) {
    translationInputEl.value = getSavedInput();
  }
  syncLanguageSelectors();
}

function syncSpeakResponsesInput() {
  if (speakResponsesEl) {
    speakResponsesEl.checked = getSavedSpeakResponses();
  }
}

function stopSpeaking() {
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
  isSpeakingResponse = false;
  setLocalConversationState("ok", "ready");
}

function speakText(text) {
  if (!getSavedSpeakResponses() || !text || !("speechSynthesis" in window)) {
    return;
  }

  stopSpeaking();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1;
  utterance.pitch = 1;
  utterance.onstart = () => {
    isSpeakingResponse = true;
    setLocalConversationState("warn", "speaking");
    setLocalRecordingStatus("Speaking translation...");
  };
  utterance.onend = () => {
    isSpeakingResponse = false;
    setLocalConversationState("ok", "ready");
    setLocalRecordingStatus("Text translation mode");
  };
  utterance.onerror = () => {
    isSpeakingResponse = false;
    setLocalConversationState("err", "speech error");
  };
  window.speechSynthesis.speak(utterance);
}

async function loadLocalModel() {
  try {
    if (!isLocalTranslationEnabled()) {
      throw new Error("Local translation model is not enabled in config.js");
    }

    const { sourceLanguage, targetLanguage, modelName } = getCurrentLanguageSelection();

    if (!modelName) {
      throw new Error(`Language pair not supported yet: ${sourceLanguage} → ${targetLanguage}`);
    }

    setLocalConversationState("warn", "loading model");
    setLocalModelStatus("Loading local model...");
    log("loading local translation model");
    log("using translation model:", modelName);
    await preloadLocalTranslation(modelName);
    setLocalConversationState("ok", "ready");
    setLocalModelStatus("Local model loaded");
    updateOfflinePairStatus();
    log("local translation model loaded");
  } catch (error) {
    setLocalConversationState("err", "load failed");
    setLocalModelStatus("Local model failed to load");
    log("local model load failed:", error instanceof Error ? error.message : String(error));
  }
}

async function downloadOfflineModels() {
  try {
    if (!isLocalTranslationEnabled()) {
      throw new Error("Local translation model is not enabled in config.js");
    }

    const { sourceLanguage, targetLanguage, modelName } = getCurrentLanguageSelection();

    if (!modelName) {
      throw new Error(`Language pair not supported yet: ${sourceLanguage} → ${targetLanguage}`);
    }

    setLocalConversationState("warn", "downloading model");
    setLocalModelStatus("Downloading selected model...");
    setLocalRecordingStatus("Preparing selected offline model...");
    log("downloading selected offline translation model");
    log("using translation model:", modelName);

    await preloadLocalTranslation(modelName);
    saveDownloadedModel(modelName);
    updateDownloadedPairsList();
    updateOfflinePairStatus();

    setLocalConversationState("ok", "offline ready");
    setLocalModelStatus("Selected model downloaded");
    setLocalRecordingStatus("Selected offline model ready");
    log("selected offline translation model downloaded");
  } catch (error) {
    setLocalConversationState("err", "download failed");
    setLocalModelStatus("Offline model download failed");
    setLocalRecordingStatus("Offline download failed");
    log("offline model download failed:", error instanceof Error ? error.message : String(error));
  }
}

async function runLocalTranslation() {
  if (runningLocalInference) {
    return;
  }

  try {
    runningLocalInference = true;
    if (!isLocalTranslationEnabled()) {
      throw new Error("Local translation model is not enabled in config.js");
    }

    const inputText = (translationInputEl?.value || getSavedInput() || "").trim();
    if (!inputText) {
      throw new Error("Enter translation text first");
    }

    const { sourceLanguage, targetLanguage, modelName } = getCurrentLanguageSelection();
    const prompt = inputText;

    if (!modelName) {
      throw new Error(`Language pair not supported yet: ${sourceLanguage} → ${targetLanguage}`);
    }

    setLocalConversationState("warn", "thinking");
    setLocalModelStatus("Loading / running local model...");
    setLocalRecordingStatus("Running local translation...");
    log("running local translation");
    log("translation input:", prompt);
    log("using translation model:", modelName);

    const text = await runLocalTranslationPrompt({
      prompt,
      model: modelName,
      onToken: (chunk) => {
        if (chunk?.trim()) {
          log("local output:", chunk);
        }
      }
    });

    if (!text?.trim()) {
      throw new Error("Model returned empty translation output");
    }

    setLocalConversationState(getSavedSpeakResponses() ? "warn" : "ok", getSavedSpeakResponses() ? "preparing speech" : "ready");
    setLocalModelStatus("Local model complete");
    setLocalRecordingStatus("Translation complete");
    setTranslationOutput(text);
    log("translation:", text);
    speakText(text);
  } catch (error) {
    setLocalConversationState("err", "inference failed");
    setLocalModelStatus("Local model failed");
    setLocalRecordingStatus("Translation failed");
    log("local run failed:", error instanceof Error ? error.message : String(error));
  } finally {
    runningLocalInference = false;
  }
}

saveContextBtn?.addEventListener("click", () => {
  const value = translationInputEl?.value || "";
  saveInput(value);
  saveSourceLanguage(sourceLanguageEl?.value || "English");
  saveTargetLanguage(targetLanguageEl?.value || "Spanish");
  log("saved translation input");
});

clearTextBtn?.addEventListener("click", () => {
  if (translationInputEl) {
    translationInputEl.value = "";
  }
  saveInput("");
});

copyTranslationBtn?.addEventListener("click", async () => {
  const text = translationOutputEl?.textContent?.trim();
  if (!text || text === DEFAULT_TRANSLATION_OUTPUT) {
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    log("copied translation");
  } catch {
    log("copy translation failed");
  }
});

clearOutputBtn?.addEventListener("click", () => {
  setTranslationOutput("");
});

quickPhraseButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const phrase = button.getAttribute("data-phrase") || "";
    if (translationInputEl) {
      translationInputEl.value = phrase;
    }
    saveInput(phrase);
  });
});

sourceLanguageEl?.addEventListener("change", () => {
  saveSourceLanguage(sourceLanguageEl.value);
  syncLanguageSelectors();
});

targetLanguageEl?.addEventListener("change", () => {
  saveTargetLanguage(targetLanguageEl.value);
  syncLanguageSelectors(sourceLanguageEl?.value, targetLanguageEl.value);
});

swapLanguagesBtn?.addEventListener("click", () => {
  const currentSource = sourceLanguageEl?.value;
  const currentTarget = targetLanguageEl?.value;

  if (!currentSource || !currentTarget) {
    return;
  }

  const reverseTargets = SUPPORTED_LANGUAGE_PAIRS[currentTarget] || [];
  if (!reverseTargets.includes(currentSource)) {
    log(`swap not supported for: ${currentSource} → ${currentTarget}`);
    return;
  }

  syncLanguageSelectors(currentTarget, currentSource);
  log(`swapped languages: ${currentTarget} → ${currentSource}`);
});

speakResponsesEl?.addEventListener("change", () => {
  saveSpeakResponses(Boolean(speakResponsesEl.checked));
  log("speak responses:", speakResponsesEl.checked ? "enabled" : "disabled");
  if (!speakResponsesEl.checked) {
    stopSpeaking();
  }
});

window.addEventListener("local-translation-progress", (event) => {
  const detail = event.detail || {};
  const file = detail.file || detail.name || detail.status || "model";
  const progress = typeof detail.progress === "number" ? ` ${Math.round(detail.progress * 100)}%` : "";
  setLocalModelStatus(`Loading ${file}${progress}`);
});

runLocalBtn?.addEventListener("click", () => {
  void runLocalTranslation();
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

downloadOfflineModelsBtn?.addEventListener("click", () => {
  void downloadOfflineModels();
});

removeSelectedModelBtn?.addEventListener("click", async () => {
  const { sourceLanguage, targetLanguage, modelName } = getCurrentLanguageSelection();
  if (!modelName) {
    log(`cannot remove unsupported pair: ${sourceLanguage} → ${targetLanguage}`);
    return;
  }

  removeDownloadedModel(modelName);
  updateDownloadedPairsList();
  updateOfflinePairStatus();
  log("removed selected model from offline list:", modelName);

  if (navigator.serviceWorker?.controller) {
    navigator.serviceWorker.controller.postMessage({ type: "REMOVE_MODEL_CACHE", modelName });
  }
});

syncInput();
syncSpeakResponsesInput();
updateDownloadedPairsList();
setTranslationOutput("");
setLocalModelStatus(isLocalTranslationEnabled() ? "Local translation available" : "Local translation disabled in config");
setLocalConversationState(isLocalTranslationEnabled() ? "warn" : "err", isLocalTranslationEnabled() ? "idle" : "disabled");
setLocalRecordingStatus("Text translation mode");
