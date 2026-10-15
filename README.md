# 🏴‍☠️ The Will of D

Roleplay chat with AI characters. Bring your own AI: **Gemini, OpenAI, Claude, OpenRouter, Groq, Ollama (local) or any OpenAI-compatible server**. The whole UI changes mood with the conversation.

## Quick start
```bash
npm run setup     # once: installs everything
npm start         # API on :5000 + UI on http://localhost:5173
```
Windows: double-click `start.bat`. Needs Node 22.13+ (you have 24 ✓ — SQLite is built in, nothing extra to install).

## Connect an AI (no keys in code or .env)
Click **AI connection** (bottom-left) → **Add connection**:
1. pick a **provider**  2. pick a **model** (press *Fetch models* for the live list from your account)
3. paste your **API key**  4. give it a **name tag**  → *Test connection* → *Save*.

Keys are saved only in `the-will-of-d/data/connections.json` (git-ignored) and are never sent back to the browser.
Switch connections from the chat header. Optionally mark one as **Fallback**: it is used only if the active one fails, and the reply is labelled when that happens.

## Mood themes
The theme follows the vibe of the chat: playful/warm → **Luffy** (sunny sky, straw hat, gold crown); grim/hostile → **Blackbeard** (violet storm, skull & sabres); otherwise **Grand Line**.
- Instant, free word-based mood detection runs on every reply; it needs a sustained vibe (a couple of messages) to switch, so it never flickers.
- *Settings → Behavior → AI mood sensing* adds a model's second opinion (one small extra request).
- Pin a theme any time with the ✦ 🧭 ☀️ ☠️ switch in the header.
- Want your own character art? Drop `luffy.png` / `blackbeard.png` (transparent PNG) into `the-will-of-d-client/public/themes/`. See the README there.

## Your data (SQLite)
Everything — characters, chats, memory, lorebook, API keys, avatars — lives in **one folder outside the project**:
`C:\Users\<you>\.the-will-of-d\` (Windows) or `~/.the-will-of-d/` (Mac/Linux). The server prints the exact path on start. Move it with the `WOD_DATA_DIR` environment variable.
- `wod.db` — the database. Created and upgraded automatically; schema changes ship as versioned migrations, so updates never wipe it.
- `backups/` — an automatic snapshot once a day, newest 7 kept.
- `uploads/` — avatars and backgrounds.
Re-unzipping, updating or deleting the project folder can no longer touch your chats. **Back up that folder** (or use the ⬇ Backup button, which downloads everything except API keys as one file; ⬆ Restore adds it back, never overwriting).

## Getting your old chats back
`import-from-v2/` contains your original characters, chats, lorebook and avatars. On the **first start** with an empty database they are imported automatically (the console prints what was restored). The originals are never modified or deleted. To import other old data later: set `WOD_IMPORT_DIR` to a folder with `characters.json`/`chats.json`/`lorebook.json` before the first start, or use ⬆ Restore with a backup file.
You will need to add your API key again in the UI.

## Layout
```
the-will-of-d/          Express API  (lib/: db (SQLite), providers, prompt, mood, chat)  · npm test
import-from-v2/         your old data, imported once on first start
the-will-of-d-client/   React + Vite UI (plain CSS, themes via CSS variables)
```
See `AUDIT.md` for what was found in v2 and what changed.
