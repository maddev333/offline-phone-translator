# Offline Phone Translator

A small browser-based offline translation prototype served by a minimal TypeScript/Express app.

## Features
- local, in-browser translation with Transformers.js
- downloadable language-pair models for offline use
- English ↔ Spanish support
- English ↔ German support
- optional speech synthesis for translated text
- service worker for offline app-shell caching

## Project layout
- `frontend/` — static browser app
- `src/` — local Express server
- `dist/` — compiled server output
- `context/` — local project notes

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
```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Scripts
- `npm run dev` — run the local server
- `npm run build` — compile the TypeScript server
- `npm start` — run the compiled server

## Notes
- Translation runs in the browser, not on the server.
- The server only serves static files and a health endpoint.
- Downloaded model tracking is stored in browser local storage.
- The service worker caches app assets for repeat/offline use.

## Current scope
This repo is intentionally focused on text translation only.

It does not include:
- authentication in the active frontend flow
- realtime voice translation in the active app
- MCP integrations in the active app
- cloud inference for translation

## Repository note
An older experimental realtime/MCP backend has been moved to `archive/legacy-realtime-app/` for reference.

The active translator server is currently defined by:
- `src/app.ts`
- `src/index.ts`
- `frontend/`
