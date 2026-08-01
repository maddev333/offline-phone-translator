# Offline Phone Translator

A small browser-based offline translation prototype that can run as a static site or via a minimal TypeScript/Express app.

## Features
- local, in-browser translation with Transformers.js
- downloadable language-pair models for offline use
- English ↔ Spanish support
- English ↔ German support
- live, on-device Nemotron transcription through WebGPU
- optional automatic translation of final live transcripts
- browser-cached ASR model files for repeat/offline use
- optional speech synthesis for translated text
- service worker for offline app-shell caching

## Project layout
- `frontend/` — static browser app
- `src/` — optional local Express server for local development
- `dist/` — compiled server output
- `context/` — local project notes
- `.github/workflows/` — GitHub Pages deployment workflow

## Configuration
Copy `frontend/config.example.js` to `frontend/config.js` if needed and adjust values:

```js
window.__APP_CONFIG__ = {
  localTranslation: {
    enabled: true,
    model: "Xenova/opus-mt-en-es",
    device: "wasm",
    dtype: "fp32",
    maxNewTokens: 96,
  },
};
```

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
- The service worker caches app assets for repeat/offline use and only deletes caches owned by this app.
- Removing a model clears readiness metadata and app-owned matching cache entries. Transformers.js-managed cache files may remain until browser storage is cleared.
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
An older experimental realtime/MCP backend has been moved to `archive/legacy-realtime-app/` for reference.

The active translator app is currently defined by:
- `frontend/`
- optionally `src/app.ts`
- optionally `src/index.ts`