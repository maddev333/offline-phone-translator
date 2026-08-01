# Project Notes

My name is Nick.

This repository is a browser-based offline translation prototype with:
- a minimal Express server for local hosting
- a static frontend in `frontend/`
- local translation via Transformers.js in the browser
- live on-device speech transcription via a Nemotron ONNX model on WebGPU
- service-worker caching for offline app-shell support, scoped to app-owned caches
- retryable model loading and explicit in-memory pipeline release

Current supported language directions:
- English ↔ Arabic, Chinese, Czech, Danish, Dutch, Finnish, French, German, Hindi, Hungarian, Italian, Russian, Spanish, Swedish, Ukrainian, Vietnamese
- Japanese, Korean, Polish, Turkish → English only
- English → Romanian only

All routes pivot through English because that is what the available `Xenova/opus-mt-*`
models cover. `frontend/languages.js` holds the table, including each language's
Nemotron `lang_id` prompt value.

Current scope:
- text translation
- live transcription in 22 languages, with auto-detect or an explicit spoken language
- automatic translation-direction switching from the detected speech language
- optional speech synthesis for translated output
- no authentication
- no cloud speech or translation inference
- no MCP integration