# Changelog

### v0.0.7 — 2026-03-23
- **New:** Infinite scroll in Memory List — older conversations load automatically as you scroll
- **New:** Import deduplication — already-imported records are skipped; the success message shows how many were skipped
- **New:** Explicit sort order label on the sort button
- **Feat:** Gemini conversation capture migrated from XHR-based to DOM-based approach — more reliable and resilient to Gemini front-end changes
- **Fix:** Gemini messages now sort correctly when multiple messages share the same timestamp (uses turn index as tiebreaker)
- **Fix:** SPA navigation no longer corrupts Gemini conversation titles
- **Fix:** Grok passive capture no longer silently misses conversations

### v0.0.6 — 2026-03-15
- **Fix:** Theme changes now sync instantly across all open tabs — previously only the current tab updated when toggling dark/light mode
- **Fix:** Language changes now sync instantly across all open tabs — previously required a page reload to take effect
- **Fix:** Floating panel state (open/closed, active view) now persists across page reloads and site navigation — previously reset to the floating button on every page load
- **Refactor:** Replaced MainMenuView with MemoryMenuContent — memory menu content now lives in a dedicated component used by both sidebar and popup
- **Refactor:** Moved FloatingMemoryPanel from `src/ui/memory-panel/` to `src/popup/components/` for a single popup UI tree
- **Refactor:** Moved importers from `src/popup/components/importers/` → `src/importers/` for cleaner separation
- **Refactor:** Extracted shared `chrome.storage` utilities (`loadFromChrome`, `saveToChrome`, `subscribeChromeStorage`) into `src/utils/chrome-storage.ts` — used by both theme and language contexts
- **Refactor:** Extracted background processing into dedicated modules: `chunking.ts`, `domSync.ts`, `offscreen.ts`, `perplexityBgFetch.ts`
- **Refactor:** Extracted RAG prompt formatting and recall logic into `src/utils/rag.ts`, `src/utils/recall-button.ts`, `src/utils/recall-helpers.ts`

### v0.0.5 — 2026-03-12
- **Fix:** Gemini passive capture now uses updated DOM selectors (`<user-query>` / `<message-content>`) matching the current Gemini UI — conversations were silently missed after a Gemini front-end update.
- **Fix:** Gemini duplicate-capture eliminated — stable deterministic record IDs and XHR debounce (1 s) prevent the same conversation from being stored again on page reload or mid-stream.
- **Fix:** Recall button now shows a clear alert when the input is empty or memories have already been injected — prevents accidental double-injection on all platforms (ChatGPT, Claude, Gemini, Grok, Perplexity).
- **Fix:** Recall-injected `[System Context]` template is stripped before saving — only the real user query is stored in memory.
- **Fix:** Perplexity Recall button now appears immediately after the "Choose a model" button (correct position).
- **Fix:** Gemini conversation title now reads from the sidebar item instead of `document.title` for more accurate session names.
- **Fix:** Gemini text injection rewritten for more reliable input handling.
- **Fix:** Grok input detection improved — no more false "empty input" errors.
- **Fix:** Memory list deduplication improved for Gemini and ChatGPT sessions.
- **Improvement:** Recall button alerts now follow the extension's display language.

### v0.0.4 — 2026-03-06
- **New:** Grok (`grok.com`) support — conversations are silently captured while you browse.
- **New:** Gemini passive message capture — existing conversations on the page are automatically captured when you visit.

### v0.0.3 — 2026-03-02
- Perplexity (`perplexity.ai`) support — conversations are silently captured while you browse. Note: Perplexity itself does not support user data export, so each conversation must be visited individually to be collected.

### v0.0.2 — 2026-03-01
- Full Claude web support (`claude.ai`) — conversation capture, Recall button injection, and floating memory panel now work on Claude

### v0.0.1 — Initial Release 2026-02-24
- ChatGPT and Gemini conversation capture
- Hybrid vector + BM25 search with RRF fusion
- One-click Recall button (ChatGPT, Gemini)
- Favourite Prompts with Trie autocomplete and drag-and-drop folders
- Export / import JSON backup
- Floating memory panel
- 8 UI languages, dark / light theme
