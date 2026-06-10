# Offline Phone Translator

A standalone browser-based offline translation prototype built with TypeScript and Transformers.js.

## What it does
- loads browser-compatible translation models like `Xenova/opus-mt-en-es`
- runs text translation locally using Transformers.js
- optionally speaks translated text with browser speech synthesis
- can be served as a tiny local web app

## Current scope
This project is currently a **text-only offline translation prototype**.

Input format:
- `translate English to Spanish: Hello, how are you?`
- `translate English to German: Where is the station?`

## Why this project exists
This repo was split away from a larger realtime voice/MCP app to focus on a simpler mobile-friendly offline translation direction.

## Project layout
- `frontend/` — static browser app
- `src/` — minimal Express server for local/static hosting

## Configuration
Edit `frontend/config.js` if needed:

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
1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the app:
   ```bash
   npm run dev
   ```
3. Open:
   ```
   http://localhost:3000
   ```
4. Click **Download offline models** once while online to preload supported translation models
5. Click **Load local model** for the currently selected language pair
6. Enter text to translate
7. Click **Run local translation**

## Scripts
- `npm run dev` — run local server
- `npm run build` — build TypeScript server
- `npm start` — run built server

## Notes
- The app now prefers translation-specific models for better language control.
- Current built-in language pairs are English↔Spanish and English↔German.
- Browser cache is enabled so downloaded model assets can be reused offline.
- A service worker caches the app shell for offline use after first load.
- Speech output currently uses browser/system voices.
- This is the first step toward offline phone translation, not the finished mobile UX.

## Likely next steps
- switch to a better translation-specific local model
- add mobile-first UI
- add offline/PWA caching
- add speech input pipeline for offline phone translation
