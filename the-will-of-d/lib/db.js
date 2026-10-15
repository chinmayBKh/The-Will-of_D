'use strict';
/**
 * Local SQLite storage (Node's built-in node:sqlite — nothing to install).
 *  - One file: <dataDir>/wod.db, created and migrated automatically.
 *  - dataDir lives OUTSIDE the project by default (~/.the-will-of-d), so re-unzipping or
 *    deleting the project can never touch your chats. Override with WOD_DATA_DIR.
 *  - Daily automatic backups (last 7 kept) and a full JSON export/import.
 *  - First run auto-imports old v2 JSON data (characters.json / chats.json / lorebook.json).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const DEFAULT_DIR = process.env.WOD_DATA_DIR || path.join(os.homedir(), '.the-will-of-d');
const uid = () => Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
const now = () => Date.now();
const json = (v) => (v == null ? null : JSON.stringify(v));
const parse = (s, d = null) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };

// ---------------------------------------------------------------- schema (append-only: never edit an old step)
const MIGRATIONS = [
  `CREATE TABLE characters (
     id TEXT PRIMARY KEY, position INTEGER NOT NULL, name TEXT NOT NULL,
     avatar TEXT NOT NULL DEFAULT '', background TEXT NOT NULL DEFAULT '', greeting TEXT NOT NULL DEFAULT '',
     personality TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', scenario TEXT NOT NULL DEFAULT '',
     mes_example TEXT NOT NULL DEFAULT '', post_history_instructions TEXT NOT NULL DEFAULT '',
     created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
   CREATE TABLE sessions (
     char_id TEXT PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
     summary TEXT NOT NULL DEFAULT '', summarized_count INTEGER NOT NULL DEFAULT 0, mood_json TEXT);
   CREATE TABLE messages (
     id TEXT PRIMARY KEY, char_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
     seq INTEGER NOT NULL, sender TEXT NOT NULL, text TEXT NOT NULL, ts INTEGER NOT NULL DEFAULT 0, meta_json TEXT);
   CREATE INDEX messages_by_chat ON messages(char_id, seq);
   CREATE TABLE lore (id TEXT PRIMARY KEY, position INTEGER NOT NULL, keys_json TEXT NOT NULL, content TEXT NOT NULL);
   CREATE TABLE connections (
     id TEXT PRIMARY KEY, label TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
     api_key TEXT NOT NULL DEFAULT '', base_url TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
   CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);`,
];

// ---------------------------------------------------------------- roman numerals for clones
const ROMAN = [[1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']];
const toRoman = (n) => { let r = ''; for (const [v, s] of ROMAN) while (n >= v) { r += s; n -= v; } return r; };
const fromRoman = (s) => { let n = 0, i = 0; s = s.toUpperCase(); for (const [v, sym] of ROMAN) while (s.startsWith(sym, i)) { n += v; i += sym.length; } return n; };
const CLONE_RE = /\s*\(([IVXLCDM]+)\)$/i;

const CHAR_FIELDS = ['name', 'avatar', 'background', 'greeting', 'personality', 'description', 'scenario', 'mes_example', 'post_history_instructions'];
const pickChar = (src) => Object.fromEntries(CHAR_FIELDS.filter((k) => src[k] !== undefined).map((k) => [k, String(src[k] ?? '')]));
const relUrl = (u) => String(u || '').replace(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/, '');   // old data stored absolute URLs

// v2 chats contained UI error/failover text inside the history; strip it.
const LEGACY_ERROR = /^⚠️ ERROR: Connection fault\.?$/;
const LEGACY_FAILOVER = /^⚠️ \[FAILOVER TO (LOCAL|CLOUD)\]\s*/;

const readJSON = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };

class DB {
  constructor(dir = DEFAULT_DIR, { backups = true } = {}) {
    this.dir = dir;
    this.uploadsDir = path.join(dir, 'uploads');
    this.backupDir = path.join(dir, 'backups');
    fs.mkdirSync(this.uploadsDir, { recursive: true });
    this.file = path.join(dir, 'wod.db');
    this.sql = new DatabaseSync(this.file);
    this.sql.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    this._migrate();
    if (backups) this._backup();
  }

  // ---------- plumbing ----------
  _migrate() {
    let v = this.sql.prepare('PRAGMA user_version').get().user_version;
    for (; v < MIGRATIONS.length; v++) {
      this.tx(() => { this.sql.exec(MIGRATIONS[v]); this.sql.exec(`PRAGMA user_version = ${v + 1}`); });
    }
  }
  tx(fn) {                                   // re-entrant: an inner tx simply joins the outer one
    if (this._depth) return fn();
    this._depth = 1; this.sql.exec('BEGIN IMMEDIATE');
    try { const r = fn(); this.sql.exec('COMMIT'); return r; } catch (e) { this.sql.exec('ROLLBACK'); throw e; } finally { this._depth = 0; }
  }
  get(q, ...p) { return this.sql.prepare(q).get(...p); }
  all(q, ...p) { return this.sql.prepare(q).all(...p); }
  run(q, ...p) { return this.sql.prepare(q).run(...p); }
  close() { try { this.sql.close(); } catch { /* already closed */ } }
  _meta(key) { return this.get('SELECT value FROM meta WHERE key = ?', key)?.value; }
  _setMeta(key, value) { this.run('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, String(value)); }

  /** One consistent snapshot per day (VACUUM INTO is safe while the app runs); keep the newest 7. */
  _backup() {
    try {
      fs.mkdirSync(this.backupDir, { recursive: true });
      const target = path.join(this.backupDir, `wod-${new Date().toISOString().slice(0, 10)}.db`);
      if (!fs.existsSync(target) && this.get('SELECT COUNT(*) n FROM characters').n > 0) this.sql.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
      fs.readdirSync(this.backupDir).filter((f) => /^wod-.*\.db$/.test(f)).sort().slice(0, -7).forEach((f) => fs.unlinkSync(path.join(this.backupDir, f)));
    } catch (e) { console.warn(`Backup skipped: ${e.message}`); }
  }

  // ---------- characters ----------
  characters() { return this.all('SELECT * FROM characters ORDER BY position').map(({ position, created_at, updated_at, ...c }) => c); }
  findCharacter(id) { return this.characters().find((c) => String(c.id) === String(id)); }
  addCharacter(data, id = uid()) {
    const c = { name: 'Unnamed', greeting: '', ...pickChar(data) };
    if (!c.greeting) c.greeting = `Hello, I am ${c.name}.`;
    const pos = this.get('SELECT COALESCE(MAX(position),0)+1 p FROM characters').p;
    this.run(`INSERT INTO characters(id,position,name,avatar,background,greeting,personality,description,scenario,mes_example,post_history_instructions,created_at,updated_at)
              VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, pos, c.name, c.avatar || '', c.background || '', c.greeting, c.personality || '', c.description || '', c.scenario || '', c.mes_example || '', c.post_history_instructions || '', now(), now());
    return this.findCharacter(id);
  }
  updateCharacter(id, data) {
    const cur = this.findCharacter(id);
    if (!cur) return null;
    const c = { ...cur, ...pickChar(data) };                                  // whitelist: body can never overwrite `id`
    this.run(`UPDATE characters SET name=?,avatar=?,background=?,greeting=?,personality=?,description=?,scenario=?,mes_example=?,post_history_instructions=?,updated_at=? WHERE id=?`,
      c.name, c.avatar, c.background, c.greeting, c.personality, c.description, c.scenario, c.mes_example, c.post_history_instructions, now(), cur.id);
    return this.findCharacter(cur.id);
  }
  cloneCharacter(id) {
    const src = this.findCharacter(id);
    if (!src) return null;
    const base = src.name.replace(CLONE_RE, '').trim();
    const family = this.characters().map((c) => c.name).filter((n) => n.replace(CLONE_RE, '').trim() === base);
    const highest = Math.max(0, ...family.map((n) => { const m = n.match(CLONE_RE); return m ? fromRoman(m[1]) : 0; }));
    return this.addCharacter({ ...src, name: `${base} (${toRoman(highest + 1)})` });
  }
  deleteCharacter(id) { this.run('DELETE FROM characters WHERE id = ?', String(id)); }   // sessions + messages cascade

  // ---------- chat sessions ----------
  getSession(charId) {
    const s = this.get('SELECT * FROM sessions WHERE char_id = ?', String(charId));
    const history = this.all('SELECT id,sender,text,ts,meta_json FROM messages WHERE char_id = ? ORDER BY seq', String(charId))
      .map(({ meta_json, ...m }) => ({ ...m, ...(meta_json ? { meta: parse(meta_json, {}) } : {}) }));
    return { history, summary: s?.summary || '', summarizedCount: s?.summarized_count || 0, mood: parse(s?.mood_json) };
  }
  saveSession(charId, s) {
    charId = String(charId);
    this.tx(() => {
      this.run(`INSERT INTO sessions(char_id,summary,summarized_count,mood_json) VALUES(?,?,?,?)
                ON CONFLICT(char_id) DO UPDATE SET summary=excluded.summary, summarized_count=excluded.summarized_count, mood_json=excluded.mood_json`,
        charId, s.summary || '', s.summarizedCount || 0, json(s.mood));
      const keep = new Set(s.history.map((m) => m.id));
      for (const { id } of this.all('SELECT id FROM messages WHERE char_id = ?', charId)) if (!keep.has(id)) this.run('DELETE FROM messages WHERE id = ?', id);
      const up = this.sql.prepare(`INSERT INTO messages(id,char_id,seq,sender,text,ts,meta_json) VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET seq=excluded.seq, text=excluded.text, meta_json=excluded.meta_json`);
      s.history.forEach((m, i) => up.run(m.id, charId, i, m.sender, m.text, m.ts || 0, json(m.meta)));
    });
  }
  clearSession(charId) { this.run('DELETE FROM messages WHERE char_id = ?', String(charId)); this.run('DELETE FROM sessions WHERE char_id = ?', String(charId)); }

  // ---------- lorebook ----------
  lore() { return this.all('SELECT id,keys_json,content FROM lore ORDER BY position').map((e) => ({ id: e.id, keys: parse(e.keys_json, []), content: e.content })); }
  addLore(keys, content, id = uid()) {
    const list = (Array.isArray(keys) ? keys : String(keys).split(',')).map((k) => String(k).trim()).filter(Boolean);
    const e = { id, keys: list, content: String(content || '').trim() };
    if (e.keys.length && e.content) this.run('INSERT INTO lore(id,position,keys_json,content) VALUES(?,(SELECT COALESCE(MAX(position),0)+1 FROM lore),?,?)', id, JSON.stringify(e.keys), e.content);
    return e;
  }
  deleteLore(id) { this.run('DELETE FROM lore WHERE id = ?', String(id)); }

  // ---------- connections (API keys live ONLY here, never sent back to the browser) ----------
  _conns() { return this.all('SELECT * FROM connections ORDER BY created_at, rowid').map(DB.fromRow); }
  static fromRow(r) { return { id: r.id, label: r.label, provider: r.provider, model: r.model, apiKey: r.api_key, baseUrl: r.base_url }; }
  getConnection(id) { const r = this.get('SELECT * FROM connections WHERE id = ?', String(id)); return r ? DB.fromRow(r) : null; }
  connectionsPublic() { return this._conns().map(DB.mask); }
  static mask(c) {
    const { apiKey, ...rest } = c;
    return { ...rest, hasKey: !!apiKey, keyPreview: apiKey ? `••••${apiKey.slice(-4)}` : '' };
  }
  addConnection(d) {
    const id = uid();
    this.run('INSERT INTO connections(id,label,provider,model,api_key,base_url,created_at) VALUES(?,?,?,?,?,?,?)', id, d.label, d.provider, d.model, d.apiKey || '', d.baseUrl || '', now());
    return this.getConnection(id);
  }
  updateConnection(id, d) {
    const cur = this.getConnection(id);
    if (!cur) return null;
    this.run('UPDATE connections SET label=?,provider=?,model=?,base_url=?,api_key=? WHERE id=?',
      d.label ?? cur.label, d.provider ?? cur.provider, d.model ?? cur.model, d.baseUrl ?? cur.baseUrl, d.apiKey ? d.apiKey : cur.apiKey, id);   // blank key = keep saved one
    return this.getConnection(id);
  }
  deleteConnection(id) { this.run('DELETE FROM connections WHERE id = ?', String(id)); }

  // ---------------------------------------------------------------- export / import
  /** Everything except API keys. Safe to keep as your own backup. */
  exportAll() {
    const sessions = {};
    for (const c of this.characters()) { const s = this.getSession(c.id); if (s.history.length) sessions[c.id] = s; }
    return { app: 'the-will-of-d', version: 3, exportedAt: new Date().toISOString(), characters: this.characters(), sessions, lorebook: this.lore() };
  }
  /** Merge an export (or a v2 JSON bundle). Existing ids are skipped, never overwritten. */
  importAll(data) {
    const stats = { characters: 0, messages: 0, lore: 0, skipped: 0 };
    this.tx(() => {
      const have = new Set(this.characters().map((c) => String(c.id)));
      for (const raw of data.characters || []) {
        const id = String(raw.id || uid());
        if (have.has(id)) { stats.skipped++; continue; }
        this.addCharacter({ ...raw, avatar: relUrl(raw.avatar), background: relUrl(raw.background) }, id);
        have.add(id); stats.characters++;
      }
      for (const [cid, raw] of Object.entries(data.sessions || {})) {
        if (!have.has(cid) || this.get('SELECT 1 x FROM messages WHERE char_id = ? LIMIT 1', cid)) continue;   // never merge into an existing chat
        const rawHist = Array.isArray(raw) ? raw : raw.history || [];
        const history = rawHist
          .filter((m) => m && m.text && !(m.sender === 'character' && LEGACY_ERROR.test(String(m.text).trim())))
          .map((m) => ({ id: m.id || uid(), sender: m.sender === 'user' ? 'user' : 'character', text: String(m.text).replace(LEGACY_FAILOVER, ''), ts: m.ts || 0, meta: m.meta }));
        this.saveSession(cid, { history, summary: raw.summary || '', summarizedCount: raw.summarizedCount || 0, mood: raw.mood || null });
        stats.messages += history.length;
      }
      const haveLore = new Set(this.lore().map((e) => e.id));
      for (const e of data.lorebook || data.entries || []) {
        if (e.id && haveLore.has(String(e.id))) continue;
        if (this.addLore(e.keys || [], e.content || '', String(e.id || uid())).keys.length) stats.lore++;
      }
    });
    return stats;
  }

  /** Read old v2 files (characters.json, chats.json, lorebook.json) + their uploads. Source files are never modified. */
  importLegacyDir(dir) {
    const characters = readJSON(path.join(dir, 'characters.json'), { characters: [] }).characters || [];
    const sessions = readJSON(path.join(dir, 'chats.json'), { chats: {} }).chats || {};
    const lorebook = readJSON(path.join(dir, 'lorebook.json'), { entries: [] }).entries || [];
    let images = 0;
    for (const up of [path.join(dir, 'uploads'), path.join(dir, '..', 'uploads')]) {
      if (!fs.existsSync(up)) continue;
      for (const f of fs.readdirSync(up)) {
        const dest = path.join(this.uploadsDir, f);
        if (/\.(png|jpe?g|webp|gif)$/i.test(f) && !fs.existsSync(dest)) { fs.copyFileSync(path.join(up, f), dest); images++; }
      }
    }
    return { ...this.importAll({ characters, sessions, lorebook }), images };
  }

  /** First run only, and only into an empty database: look for old data in the usual places. */
  autoImportLegacy(extraDirs = []) {
    if (this._meta('legacy_import_done')) return null;
    if (this.get('SELECT COUNT(*) n FROM characters').n > 0) { this._setMeta('legacy_import_done', '1'); return null; }
    for (const dir of [process.env.WOD_IMPORT_DIR, ...extraDirs].filter(Boolean)) {
      if (!fs.existsSync(path.join(dir, 'characters.json'))) continue;
      const r = this.importLegacyDir(dir);
      this._setMeta('legacy_import_done', '1');
      this._backup();                          // snapshot right away
      return { dir, ...r };
    }
    return null;                               // nothing found: try again next start while the database is still empty
  }
}

module.exports = { DB, uid, DEFAULT_DIR };
