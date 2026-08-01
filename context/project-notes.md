# Project Notes

My name is Nick.

This repository is a browser-based offline translation prototype with:
- a minimal Express server for local hosting
- a static frontend in `frontend/`
- local translation via Transformers.js in the browser
- service-worker caching for offline app-shell support, scoped to app-owned caches
- retryable model loading and explicit in-memory pipeline release

Current supported language directions:
- English → Spanish
- Spanish → English
- English → German
- German → English

Current scope:
- text translation only
- optional speech synthesis for translated output
- no authentication
- no realtime voice features
- no MCP integration