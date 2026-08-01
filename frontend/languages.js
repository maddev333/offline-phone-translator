// Shared language table for live transcription and local translation.
//
// asrLangId values come from the Nemotron prompt dictionary (num_prompts: 128):
// https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b/blob/main/processor_config.json
//
// toEnglish / fromEnglish record which Xenova/opus-mt-* repos actually exist.
// Several languages the ASR model handles have no published model in one
// direction, so they are deliberately one-way here.

export const AUTO_DETECT_LANG_ID = 101;

export const LANGUAGES = {
  English: { code: "en", asrLocale: "en-US", asrLangId: 0 },
  Arabic: { code: "ar", asrLocale: "ar-AR", asrLangId: 7, toEnglish: true, fromEnglish: true },
  Chinese: { code: "zh", asrLocale: "zh-CN", asrLangId: 4, toEnglish: true, fromEnglish: true },
  Czech: { code: "cs", asrLocale: "cs-CZ", asrLangId: 22, toEnglish: true, fromEnglish: true },
  Danish: { code: "da", asrLocale: "da-DK", asrLangId: 25, toEnglish: true, fromEnglish: true },
  Dutch: { code: "nl", asrLocale: "nl-NL", asrLangId: 16, toEnglish: true, fromEnglish: true },
  Finnish: { code: "fi", asrLocale: "fi-FI", asrLangId: 26, toEnglish: true, fromEnglish: true },
  French: { code: "fr", asrLocale: "fr-FR", asrLangId: 8, toEnglish: true, fromEnglish: true },
  German: { code: "de", asrLocale: "de-DE", asrLangId: 9, toEnglish: true, fromEnglish: true },
  Hindi: { code: "hi", asrLocale: "hi-IN", asrLangId: 6, toEnglish: true, fromEnglish: true },
  Hungarian: { code: "hu", asrLocale: "hu-HU", asrLangId: 23, toEnglish: true, fromEnglish: true },
  Italian: { code: "it", asrLocale: "it-IT", asrLangId: 15, toEnglish: true, fromEnglish: true },
  Japanese: { code: "ja", asrLocale: "ja-JP", asrLangId: 10, toEnglish: true },
  Korean: { code: "ko", asrLocale: "ko-KR", asrLangId: 14, toEnglish: true },
  Polish: { code: "pl", asrLocale: "pl-PL", asrLangId: 17, toEnglish: true },
  Romanian: { code: "ro", asrLocale: "ro-RO", asrLangId: 20, fromEnglish: true },
  Russian: { code: "ru", asrLocale: "ru-RU", asrLangId: 11, toEnglish: true, fromEnglish: true },
  Spanish: { code: "es", asrLocale: "es-ES", asrLangId: 2, toEnglish: true, fromEnglish: true },
  Swedish: { code: "sv", asrLocale: "sv-SE", asrLangId: 24, toEnglish: true, fromEnglish: true },
  Turkish: { code: "tr", asrLocale: "tr-TR", asrLangId: 18, toEnglish: true },
  Ukrainian: { code: "uk", asrLocale: "uk-UA", asrLangId: 19, toEnglish: true, fromEnglish: true },
  Vietnamese: { code: "vi", asrLocale: "vi-VN", asrLangId: 33, toEnglish: true, fromEnglish: true },
};

// Every translation route pivots through English, matching the available models.
export const LANGUAGE_MODEL_MAP = (() => {
  const map = {};
  for (const [name, info] of Object.entries(LANGUAGES)) {
    if (info.fromEnglish) map[`English:${name}`] = `Xenova/opus-mt-en-${info.code}`;
    if (info.toEnglish) map[`${name}:English`] = `Xenova/opus-mt-${info.code}-en`;
  }
  return map;
})();

export const SUPPORTED_LANGUAGE_PAIRS = (() => {
  const pairs = {};
  for (const key of Object.keys(LANGUAGE_MODEL_MAP)) {
    const [source, target] = key.split(":");
    if (!pairs[source]) pairs[source] = [];
    pairs[source].push(target);
  }
  for (const targets of Object.values(pairs)) targets.sort();
  return pairs;
})();

// A two-person conversation needs both directions, so one-way languages such as
// Japanese (to English only) or Romanian (from English only) cannot be a partner.
export const CONVERSATION_PARTNER_LANGUAGES = Object.entries(LANGUAGES)
  .filter(([, info]) => info.toEnglish && info.fromEnglish)
  .map(([name]) => name);

// Resolves a locale tag such as "es-ES" (or a bare "es") to a language name.
export function findLanguageByLocale(locale) {
  const normalized = String(locale || "").trim().toLowerCase();
  if (!normalized) return null;

  const entries = Object.entries(LANGUAGES);
  const exact = entries.find(([, info]) => info.asrLocale.toLowerCase() === normalized);
  if (exact) return exact[0];

  const base = normalized.split("-")[0];
  const byCode = entries.find(([, info]) => info.code === base);
  return byCode ? byCode[0] : null;
}
