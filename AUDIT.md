# Audit of v2 → what was found, what changed

Legend: 🔴 breaks things · 🟠 wrong behaviour · 🟡 quality/cleanup

## Why "Gemini Cloud" kept falling back to Local
The real Gemini error was **never shown**. `executeGeminiCloud` failures were caught, then the server silently switched to Ollama and the UI showed only "⚠️ FAILOVER TO LOCAL". The client also replaced every server error with "Connection fault".
Plausible causes (can't be confirmed without your terminal output): wrong/expired key, key not loaded because the server was started from another folder (`.env` is read relative to the working directory), quota/billing on the chosen model, a safety block, or a reasoning model spending its whole `maxOutputTokens` on thinking (empty reply). Your git history shows cloud worked on `gemini-3.5-flash`; the uncommitted switch to `3.6-flash` (a real model) was likely a guess.
**Fix:** errors are now shown verbatim with a hint; a *Test connection* button; live model lists (no typos); fallback is opt-in and disclosed.

## Technical
- 🔴 API key hard-coded to one `.env` variable and one model string. → UI-managed connections (provider/model/key/name).
- 🔴 `AIManager.js` and `DatabaseManager.js` were dead duplicates (ES modules in a CommonJS package, never imported). Removed. `lowdb`, `dotenv` and `@google/genai` were unused or replaceable by `fetch`; removed.
- 🔴 `.env` with a real key was inside the zip you shared. It was never committed to git, but **rotate that key** in Google AI Studio.
- 🟠 Open CORS + uploads accepted any file type/size (an `.html` upload would be served from your origin). → CORS limited to localhost, server bound to 127.0.0.1, images only, 8 MB cap.
- 🟠 `PUT /characters/:id` spread the request body over the record (client could overwrite `id`). → field whitelist.
- 🟠 Read-modify-write on JSON files with no locking or atomic write; a corrupt file was silently treated as empty and then overwritten. → atomic writes, per-character lock, corrupt files backed up.
- 🟠 Max Response Tokens slider was sent but ignored. → honoured by all providers; reply tokens are reserved from the context budget.
- 🟠 Ollama used `/api/generate` with a pasted-together transcript, no `num_ctx` (so the context slider did nothing). → `/api/chat` with real roles and `num_ctx`.
- 🟡 Client used `idx` as React key, Vite-boilerplate `App.css` and an ignored `tailwind.config.cjs` (Tailwind 4 doesn't read it); the lorebook API had no UI.

## Logical / semantic
- 🔴 Memory summarisation re-summarised the **same** dropped messages on every turn (client sent the full history, server pruned it again each time), compounding the summary and adding a blocking LLM call to each message. → `summarizedCount` tracks what is already summarised; pruning drops to 75 % so summaries happen in batches.
- 🔴 Error and failover text was saved **into the chat history** (your `chats.json` has several), so the model read its own "⚠️ FAILOVER" lines. → never stored; old ones are cleaned on load.
- 🟠 Conversations began with a *model* turn (the greeting). Gemini/Claude require user-first. → a synthetic opening user turn; greeting stays in context.
- 🟠 `{{user}}`/`{{char}}` were replaced only in example dialogue. → everywhere. Default user name is now configurable.
- 🟠 Nothing stopped the model writing the user's lines. → explicit rule in the system prompt.
- 🟠 "Post-history instructions" were put in the system prompt (not post-history). → appended after the history, as the name says.
- 🟠 Lorebook scanned only the newest message and an empty key (`"a,,b"`) matched everything. → last 4 messages, whole-word match, empty keys ignored.
- 🟠 Client owned the history and sent it on every request (race-prone, bloated). → server owns it; the client sends one message.
- 🟡 Clone naming produced duplicates after a deletion (`(II)` twice). → highest numeral + 1.
- 🟡 Deleting a message doesn't invalidate old summaries (kept consistent via `summarizedCount` clamp, but memory text itself is yours to edit).
- 🟡 Token counts are ~4 chars/token estimates (poor for non-English text); shown as estimates.

## UI
Rebuilt from scratch: sidebar + header + feed + dock; header actions grouped in a ⋯ menu; real error banner with Retry; connection switcher; Settings (Context · Behavior · Memory · Lorebook); mobile drawer; plain CSS with theme variables (Tailwind removed — nothing needed it). Per-character colour palettes were replaced by the mood themes (the old `theme` field in your data is simply ignored).

## Storage (v3.1)
JSON files → SQLite (`node:sqlite`, no dependency): tables for characters, sessions, messages, lorebook, connections; versioned migrations; WAL + transactions; daily backups; data kept outside the project folder; JSON export/import. Your v2 data was restored: 14 characters, 9 chats / 191 messages, 23 lore entries, 8 images (counts verified against the originals). Old `localhost:5000` image URLs were rewritten to portable paths; v2 error/failover text was cleaned from chats.
Accounts/encryption were deliberately **not** added: each person runs their own copy with their own database, so there is nobody to hide data from.

## Verification done
- `npm test`: 19 backend tests (all four API shapes mocked, errors, fallback, summarisation, legacy data, mood, security-relevant behaviour).
- End-to-end in headless Chromium against your real `data/` copy: restore from your real v2 data, connection form, key never exposed, Luffy ↔ Blackbeard switching, error banner, mobile layout.
- **Not done:** no live calls to Google/OpenAI/Anthropic (no network in my environment), and I ran the API under a minimal Express stand-in rather than real Express 5. Please use *Test connection* with your own key first.
