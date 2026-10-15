'use strict';
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const multer = require('multer');

try { if (process.loadEnvFile) process.loadEnvFile(path.join(__dirname, '.env')); } catch { /* .env is optional (only PORT) */ }

const { DB } = require('./lib/db');
const providers = require('./lib/providers');
const chat = require('./lib/chat');

function createApp(db = new DB()) {
  const app = express();
  const uploadsDir = db.uploadsDir;

  // Keys are stored server-side and this API can spend them, so only local pages may talk to it.
  app.use(cors({ origin: [/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/] }));
  app.use(express.json({ limit: '50mb' }));
  app.use('/uploads', express.static(uploadsDir));

  const EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' };
  const upload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => cb(null, uploadsDir),
      filename: (req, file, cb) => cb(null, `img-${Date.now()}-${Math.round(Math.random() * 1e9)}${EXT[file.mimetype]}`),
    }),
    limits: { fileSize: 8 * 1024 * 1024 },
    fileFilter: (req, file, cb) => cb(EXT[file.mimetype] ? null : new Error('Only PNG, JPEG, WebP or GIF images are allowed.'), !!EXT[file.mimetype]),
  });

  const route = (fn) => (req, res) => Promise.resolve().then(() => fn(req, res)).then((out) => { if (!res.headersSent) res.json(out ?? { ok: true }); }).catch((err) => {
    const isProvider = err instanceof providers.ProviderError;
    const status = isProvider ? 502 : (err.status >= 400 && err.status < 600 ? err.status : 500);
    if (status >= 500 && !isProvider) console.error(err);
    res.status(status).json({ error: err.message, hint: err.hint || '', provider: err.provider, history: err.history });
  });
  const need = (cond, msg) => { if (!cond) throw chat.httpError(400, msg); };

  // ---------- uploads ----------
  app.post('/api/upload', (req, res) => upload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No image uploaded.' });
    res.json({ url: `/uploads/${req.file.filename}` });
  }));

  // ---------- providers & connections ----------
  app.get('/api/providers', (req, res) => res.json(providers.publicProviders()));
  app.get('/api/connections', (req, res) => res.json(db.connectionsPublic()));

  const connBody = (b) => ({ label: String(b.label || '').trim(), provider: String(b.provider || ''), model: String(b.model || '').trim(), apiKey: String(b.apiKey || '').trim(), baseUrl: String(b.baseUrl || '').trim() });
  const validate = (c, partial) => {
    need(providers.PROVIDERS[c.provider], 'Choose a provider.');
    need(c.model, 'Choose or type a model.');
    if (!partial) need(!providers.PROVIDERS[c.provider].needsKey || c.apiKey, 'Paste an API key.');
  };
  app.post('/api/connections', route((req) => {
    const c = connBody(req.body); validate(c);
    c.label ||= `${providers.PROVIDERS[c.provider].name} · ${c.model}`;
    return { connection: DB.mask(db.addConnection(c)) };
  }));
  app.put('/api/connections/:id', route((req) => {
    const c = connBody(req.body); validate(c, true);
    c.label ||= `${providers.PROVIDERS[c.provider].name} · ${c.model}`;
    const u = db.updateConnection(req.params.id, c);
    if (!u) throw chat.httpError(404, 'Connection not found.');
    return { connection: DB.mask(u) };
  }));
  app.delete('/api/connections/:id', route((req) => { db.deleteConnection(req.params.id); return { ok: true }; }));

  // draft connection from the form; a blank key falls back to the saved one
  const draft = (b) => {
    const c = connBody(b);
    if (b.id) { const saved = db.getConnection(b.id); if (saved) { c.apiKey ||= saved.apiKey; c.provider ||= saved.provider; c.baseUrl ||= saved.baseUrl; c.model ||= saved.model; c.label ||= saved.label; } }
    return c;
  };
  app.post('/api/models', route(async (req) => ({ models: await providers.listModels(draft(req.body)) })));
  app.post('/api/connections/test', route(async (req) => {
    const c = draft(req.body); validate(c, true);
    const t0 = Date.now();
    try {
      const { text } = await providers.chat(c, { system: 'Reply with the single word OK.', messages: [{ role: 'user', content: 'ping' }], maxTokens: 512, temperature: 0 });
      return { ok: true, ms: Date.now() - t0, reply: text.trim().slice(0, 60) };
    } catch (e) {
      if (e.code === 'max_tokens') return { ok: true, ms: Date.now() - t0, reply: '(connected; model spent its tokens thinking)' };
      throw e;
    }
  }));

  // ---------- characters ----------
  app.get('/api/characters', (req, res) => res.json(db.characters()));
  app.post('/api/characters', route((req) => {
    need(req.body.name?.trim() && req.body.personality?.trim(), 'Name and personality are required.');
    return { character: db.addCharacter(req.body) };
  }));
  app.put('/api/characters/:id', route((req) => {
    const c = db.updateCharacter(req.params.id, req.body);
    if (!c) throw chat.httpError(404, 'Character not found.');
    return { character: c };
  }));
  app.post('/api/characters/:id/clone', route((req) => {
    const c = db.cloneCharacter(req.params.id);
    if (!c) throw chat.httpError(404, 'Character not found.');
    return { character: c };
  }));
  app.delete('/api/characters/:id', route((req) => { db.deleteCharacter(req.params.id); return { ok: true }; }));

  // ---------- lorebook ----------
  app.get('/api/lorebook', (req, res) => res.json(db.lore()));
  app.post('/api/lorebook', route((req) => {
    const e = db.addLore(req.body.keys || '', req.body.content);
    need(e.keys.length && e.content, 'Add at least one keyword and some content.');
    return { entry: e };
  }));
  app.delete('/api/lorebook/:id', route((req) => { db.deleteLore(req.params.id); return { ok: true }; }));

  // ---------- backup: export / import everything (API keys are never included) ----------
  app.get('/api/export', (req, res) => {
    res.setHeader('Content-Disposition', `attachment; filename="the-will-of-d-backup-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json(db.exportAll());
  });
  app.post('/api/import', route((req) => {
    need(Array.isArray(req.body?.characters), 'This does not look like a Will of D backup file.');
    return { imported: db.importAll(req.body) };
  }));

  // ---------- chat ----------
  app.get('/api/chat/:id', route((req) => chat.getSessionView(db, req.params.id)));
  app.post('/api/chat/:id', route((req) => chat.converse(db, {
    charId: req.params.id, message: req.body.message, regenerate: !!req.body.regenerate,
    connectionId: req.body.connectionId, fallbackId: req.body.fallbackId, settings: req.body.settings,
  })));
  app.post('/api/chat/:id/mood', route((req) => chat.refineMood(db, { charId: req.params.id, connectionId: req.body.connectionId })));
  app.put('/api/chat/:id/summary', route((req) => chat.setSummary(db, req.params.id, req.body.summary)));
  app.delete('/api/chat/:id/messages', route((req) => chat.deleteMessages(db, req.params.id, Array.isArray(req.body.ids) ? req.body.ids : [])));
  app.delete('/api/chat/:id', route((req) => { db.clearSession(req.params.id); return { ok: true }; }));

  // ---------- optional: serve the production client build ----------
  const dist = path.join(__dirname, '..', 'the-will-of-d-client', 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.use((req, res, next) => (req.method === 'GET' && !req.path.startsWith('/api') ? res.sendFile(path.join(dist, 'index.html')) : next()));
  }
  return app;
}

module.exports = { createApp };

if (require.main === module) {
  const PORT = Number(process.env.PORT) || 5000;
  const db = new DB();
  const imported = db.autoImportLegacy([path.join(__dirname, 'data'), path.join(__dirname, '..', 'import-from-v2')]);
  if (imported) console.log(`\n📦 Restored old data from ${imported.dir}: ${imported.characters} characters, ${imported.messages} messages, ${imported.lore} lore entries, ${imported.images} images.`);
  createApp(db).listen(PORT, '127.0.0.1', () => console.log(`\n🏴‍☠️  The Will of D — engine on http://localhost:${PORT}\n💾  Your data: ${db.dir}\n`));
  process.on('SIGINT', () => { db.close(); process.exit(0); });
}
