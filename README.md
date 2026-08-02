# Offline Phone Translator

A small browser-based offline translation prototype that can run as a static site or via a minimal TypeScript/Express app.

## Features
- local, in-browser translation with Transformers.js
- downloadable language-pair models for offline use
- 21 languages paired with English, in whichever directions have a published model
- live, on-device Nemotron transcription through WebGPU across 22 spoken languages
- selectable spoken language, or automatic language detection
- automatic translation-direction switching from the detected speech language
- optional automatic translation of final live transcripts
- browser-cached ASR model files for repeat/offline use
- optional speech synthesis for translated text
- document OCR page: photograph a page, read it with GLM-OCR on WebGPU, translate it into English
- service worker for offline app-shell caching

## Pages
- `frontend/index.html` — speak and translate (text input, live transcription, conversation mode)
- `frontend/ocr.html` — document OCR and translation from a photo

## Project layout
- `frontend/` — static browser app
- `src/` — optional local Express server for local development
- `dist/` — compiled server output
- `context/` — local project notes
- `.github/workflows/` — GitHub Pages deployment workflow

## Configuration
`frontend/config.js` is committed with working defaults. `frontend/config.example.js` documents the same shape if you need to recreate or customise it:

```js
window.__APP_CONFIG__ = {
  localTranslation: {
    enabled: true,
    model: "Xenova/opus-mt-en-es",
    device: "wasm",
    dtype: "fp32",
    maxNewTokens: 96,
  },
  ocr: {
    enabled: true,
    model: "onnx-community/GLM-OCR-ONNX",
    device: "webgpu",
    dtype: "q4f16",
    maxNewTokens: 1024,
    maxImageSide: 1400,
  },
};
```

## Document OCR
The OCR page runs [`onnx-community/GLM-OCR-ONNX`](https://huggingface.co/onnx-community/GLM-OCR-ONNX),
the Transformers.js export of `zai-org/GLM-OCR`, entirely in the browser on WebGPU.
At the default `q4f16` precision the three ONNX sessions total about 630 MB and are
cached by the browser for offline use, exactly like the ASR model.

Recognition itself is script-independent, so the language selector on that page only
chooses which `opus-mt-<lang>-en` model translates the recognised text. Photos are
scaled down to `maxImageSide` before recognition, because GLM-OCR emits one visual
token per 28x28 pixel block and a full-resolution phone photo would not fit in memory.

The repo declares external ONNX data only for its fp32/fp16 weights, so
`frontend/local-ocr.js` passes its own `use_external_data_format` map; without it the
quantized weights load without their `.onnx_data` blobs.

## Languages
`frontend/languages.js` is the single source of truth. It records, per language, the
Nemotron `lang_id` prompt value and which `Xenova/opus-mt-*` translation models exist.

Every translation route pivots through English, because that is what the OPUS-MT
models provide. Coverage is uneven and deliberately so:

- **Both directions** — Arabic, Chinese, Czech, Danish, Dutch, Finnish, French, German, Hindi, Hungarian, Italian, Russian, Spanish, Swedish, Ukrainian, Vietnamese
- **Into English only** — Japanese, Korean, Polish, Turkish
- **From English only** — Romanian

All 21 plus English can be transcribed. Languages the ASR model supports but that have
no published translation model (for example Portuguese, Greek, Bulgarian, Slovak) are
intentionally omitted rather than failing at download time.

The spoken-language selector defaults to auto-detect. In that mode the model appends a
`<xx-XX>` tag to the transcript, which the app uses to switch the translation direction
automatically. Picking an explicit language conditions the encoder directly and is
slightly more accurate.

## Run locally
### Option 1: local server
```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

### Option 2: static preview
Serve `frontend/` with any static file server.

## Scripts
- `npm run dev` — run the local server
- `npm run build` — compile the optional TypeScript server
- `npm start` — run the compiled server

## Notes
- Translation runs in the browser, not on the server.
- The server is optional and only serves static files plus a health endpoint.
- Downloaded model tracking is stored in browser local storage as readiness metadata; the browser cache is verified when the model is loaded.
- Failed model loads can be retried, and releasing a model disposes its in-memory pipeline when supported.
- The service worker caches same-origin app assets only. CDN libraries and Hugging Face model files keep their own caches so large models are never stored twice.
- Service worker cleanup only removes caches prefixed with `offline-phone-translator-static-`, so shipping an app update never wipes the downloaded translation or ASR models.
- Removing a translation model clears readiness metadata and matching app-owned cache entries. Transformers.js-managed cache files may remain until browser storage is cleared.
- Removing the ASR model deletes the `nemotron-asr-int4-v1` cache directly from the page, so the space is reclaimed reliably.
- GitHub Pages deployment serves the `frontend/` directory as a static site.

## Deploy to GitHub Pages
1. Push this repo to GitHub.
2. Ensure the default branch is `main`.
3. In GitHub, open **Settings → Pages**.
4. Set **Source** to **GitHub Actions**.
5. Push to `main` or run the **Deploy to GitHub Pages** workflow manually.

The workflow publishes the contents of `frontend/`.

Your site will be available at:
- `https://<your-user>.github.io/<your-repo>/`

## Current scope
This repo combines manual text translation with optional live, on-device speech transcription. Final Nemotron transcripts can populate the existing translation input and, when enabled, start local translation automatically.

It does not include:
- authentication in the active frontend flow
- cloud speech or translation inference
- MCP integrations in the active app

Live transcription requires WebGPU. Manual text translation remains available when WebGPU is unsupported.

## Repository note
The active translator app is defined by:
- `frontend/`
- optionally `src/app.ts`
- optionally `src/index.ts`