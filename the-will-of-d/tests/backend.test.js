'use strict';
// Run with: npm test   (no network needed — all providers are mocked locally)
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { DB } = require('../lib/db');
const { createApp } = require('../server');
const mood = require('../lib/mood');

// ---------------------------------------------------------------- mock provider server
const seen = [];                       // every request the mock received
const mock = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => (body += c));
  req.on('end', () => {
    const json = body ? JSON.parse(body) : {};
    seen.push({ url: req.url, headers: req.headers, json });
    const send = (code, obj) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)); };
    const u = req.url;
    if (u.startsWith('/gemini/models?')) return send(200, { models: [
      { name: 'models/gemini-3.5-flash', displayName: 'Gemini 3.5 Flash', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-embedding-001', supportedGenerationMethods: ['embedContent'] },
      { name: 'models/gemini-3.1-flash-image', supportedGenerationMethods: ['generateContent'] }] });
    if (u.includes('/gemini/models/') && u.includes(':generateContent')) {
      if (u.includes('bad-model')) return send(404, { error: { message: 'models/bad-model is not found', status: 'NOT_FOUND' } });
      if (u.includes('thinker')) return send(200, { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '', thought: true }] } }] });
      const sys = json.systemInstruction.parts[0].text;
      if (sys.startsWith('You classify')) return send(200, { candidates: [{ content: { parts: [{ text: '{"mood":"dark","confidence":0.9}' }] } }] });
      if (sys.startsWith('You are a memory compaction')) return send(200, { candidates: [{ content: { parts: [{ text: '- remembered fact' }] } }] });
      return send(200, { candidates: [{ content: { parts: [{ text: 'Shishishi! Great adventure, my friend!' }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 7 } });
    }
    if (u === '/openai/models') return send(200, { data: [{ id: 'gpt-4o' }, { id: 'text-embedding-3-small' }, { id: 'whisper-1' }, { id: 'o3-mini' }] });
    if (u === '/openai/chat/completions') return send(200, { choices: [{ message: { content: 'openai says hi' }, finish_reason: 'stop' }] });
    if (u.startsWith('/anthropic/models')) return send(200, { data: [{ id: 'claude-x', display_name: 'Claude X' }] });
    if (u === '/anthropic/messages') return send(200, { content: [{ type: 'text', text: 'claude says hi' }], stop_reason: 'end_turn' });
    if (u === '/ollama/api/tags') return send(200, { models: [{ name: 'llama3.2:3b' }] });
    if (u === '/ollama/api/chat') return send(200, { message: { content: 'llama says hi' } });
    send(404, { error: 'unmocked ' + u });
  });
});

let server, api, db, tmp, MOCK;
const call = async (method, p, body) => {
  const r = await fetch(api + p, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() };
};

test.before(async () => {
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  MOCK = `http://127.0.0.1:${mock.address().port}`;
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wod-'));
  db = new DB(tmp);
  const app = createApp(db);
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  api = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); mock.close(); db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

// ---------------------------------------------------------------- tests
test('provider registry is served to the UI', async () => {
  const { body } = await call('GET', '/api/providers');
  assert.ok(['gemini', 'openai', 'anthropic', 'openrouter', 'groq', 'ollama', 'custom'].every((id) => body.some((p) => p.id === id)));
});

test('live model lists for every API shape, with non-chat models filtered out', async () => {
  const g = await call('POST', '/api/models', { provider: 'gemini', apiKey: 'k', baseUrl: `${MOCK}/gemini` });
  assert.deepEqual(g.body.models.map((m) => m.id), ['gemini-3.5-flash']);
  assert.equal(seen.at(-1).headers['x-goog-api-key'], 'k');            // key goes in a header, not the URL
  assert.ok(!seen.at(-1).url.includes('key='));
  const o = await call('POST', '/api/models', { provider: 'openai', apiKey: 'k', baseUrl: `${MOCK}/openai` });
  assert.deepEqual(o.body.models.map((m) => m.id), ['gpt-4o', 'o3-mini']);
  const a = await call('POST', '/api/models', { provider: 'anthropic', apiKey: 'k', baseUrl: `${MOCK}/anthropic` });
  assert.equal(a.body.models[0].id, 'claude-x');
  const l = await call('POST', '/api/models', { provider: 'ollama', baseUrl: `${MOCK}/ollama` });
  assert.equal(l.body.models[0].id, 'llama3.2:3b');
});

test('connections: key is stored, masked on read, and kept when the edit form leaves it blank', async () => {
  const add = await call('POST', '/api/connections', { provider: 'gemini', model: 'gemini-3.5-flash', apiKey: 'SECRET-1234', label: 'My Gemini', baseUrl: `${MOCK}/gemini` });
  assert.equal(add.status, 200);
  const list = (await call('GET', '/api/connections')).body;
  assert.equal(list[0].keyPreview, '••••1234');
  assert.ok(!JSON.stringify(list).includes('SECRET'));                   // never leaves the server
  await call('PUT', `/api/connections/${list[0].id}`, { provider: 'gemini', model: 'gemini-3.1-flash-lite', apiKey: '', label: 'Renamed', baseUrl: `${MOCK}/gemini` });
  assert.equal(db.getConnection(list[0].id).apiKey, 'SECRET-1234');
  assert.equal(db.getConnection(list[0].id).model, 'gemini-3.1-flash-lite');
  assert.equal((await call('POST', '/api/connections', { provider: 'openai', model: 'gpt-4o' })).status, 400);   // key required
});

let charId, gem, bad, think, oai;
test('chat: greeting is persisted, {{user}}/{{char}} filled everywhere, first turn is "user"', async () => {
  charId = (await call('POST', '/api/characters', { name: 'Luffy', greeting: 'Yo!', personality: '{{char}} loves meat and calls {{user}} nakama.', description: '{{char}} wears a straw hat.' })).body.character.id;
  gem = db._conns()[0].id;
  const s = (await call('GET', `/api/chat/${charId}`)).body;
  assert.equal(s.history.length, 1);
  assert.equal(s.history[0].text, 'Yo!');

  const r = await call('POST', `/api/chat/${charId}`, { message: 'Let us sail!', connectionId: gem, settings: { userName: 'Chinmay' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.history.at(-1).sender, 'character');
  const sent = seen.at(-1).json;
  assert.equal(sent.contents[0].role, 'user');                            // Gemini/Claude need a user-first conversation
  assert.equal(sent.contents[1].role, 'model');                           // …but the greeting is still in context
  const sys = sent.systemInstruction.parts[0].text;
  assert.match(sys, /Luffy loves meat and calls Chinmay nakama/);
  assert.match(sys, /Luffy wears a straw hat/);                           // old code only substituted in example dialogue
  assert.equal(sent.generationConfig.maxOutputTokens, 1024);              // old code ignored this setting
  assert.equal(r.body.history.at(-1).meta.model, 'gemini-3.1-flash-lite');
});

test('errors are surfaced with a hint, the user message is kept, no fake reply is saved', async () => {
  bad = db.addConnection({ label: 'Bad', provider: 'gemini', model: 'bad-model', apiKey: 'k', baseUrl: `${MOCK}/gemini` }).id;
  const before = (await call('GET', `/api/chat/${charId}`)).body.history.length;
  const r = await call('POST', `/api/chat/${charId}`, { message: 'hello?', connectionId: bad });
  assert.equal(r.status, 502);
  assert.match(r.body.error, /not found/);
  assert.match(r.body.hint, /Fetch models/);
  assert.equal(r.body.history.length, before + 1);
  assert.equal(r.body.history.at(-1).sender, 'user');
  // retry (regenerate) with a working connection answers the pending user message
  const ok = await call('POST', `/api/chat/${charId}`, { regenerate: true, connectionId: gem });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.history.at(-1).sender, 'character');
});

test('fallback is opt-in and disclosed (never silent, never written into the message text)', async () => {
  const r = await call('POST', `/api/chat/${charId}`, { message: 'again', connectionId: bad, fallbackId: gem });
  assert.equal(r.status, 200);
  assert.equal(r.body.fallback.from, 'Bad');
  assert.ok(!/FAILOVER/.test(r.body.history.at(-1).text));
  assert.equal(r.body.history.at(-1).meta.fallbackFrom, 'Bad');
});

test('reasoning model that burns its token budget gives a clear, fixable error', async () => {
  think = db.addConnection({ label: 'T', provider: 'gemini', model: 'thinker', apiKey: 'k', baseUrl: `${MOCK}/gemini` }).id;
  const r = await call('POST', `/api/chat/${charId}`, { message: 'think', connectionId: think });
  assert.equal(r.status, 502);
  assert.match(r.body.hint, /Max response tokens/);
  await call('POST', `/api/chat/${charId}`, { regenerate: true, connectionId: gem });
});

test('openai / anthropic / ollama adapters round-trip', async () => {
  oai = db.addConnection({ label: 'O', provider: 'openai', model: 'gpt-4o', apiKey: 'k', baseUrl: `${MOCK}/openai` }).id;
  const an = db.addConnection({ label: 'A', provider: 'anthropic', model: 'claude-x', apiKey: 'k', baseUrl: `${MOCK}/anthropic` }).id;
  const ol = db.addConnection({ label: 'L', provider: 'ollama', model: 'llama3.2:3b', baseUrl: `${MOCK}/ollama` }).id;
  for (const [id, expect] of [[oai, 'openai says hi'], [an, 'claude says hi'], [ol, 'llama says hi']]) {
    const r = await call('POST', `/api/chat/${charId}`, { message: 'hi', connectionId: id });
    assert.equal(r.body.history.at(-1).text, expect);
  }
  const reqOpenAI = seen.filter((s) => s.url === '/openai/chat/completions').at(-1).json;
  assert.ok('max_completion_tokens' in reqOpenAI && !('temperature' in reqOpenAI));
  assert.equal(seen.filter((s) => s.url === '/anthropic/messages').at(-1).json.messages[0].role, 'user');
  assert.equal(seen.filter((s) => s.url === '/ollama/api/chat').at(-1).json.options.num_ctx, 8192);
});

test('long chats: every message is summarized at most once, and in batches (old code re-summarized the same messages every turn)', async () => {
  const id = (await call('POST', '/api/characters', { name: 'Zoro', greeting: 'Tch.', personality: 'Stoic swordsman.' })).body.character.id;
  const settings = { maxContextBudget: 3072, maxOutputTokens: 512 };
  const isSummary = (s) => s.json?.systemInstruction?.parts?.[0]?.text?.startsWith('You are a memory compaction');
  const first = seen.length;
  const TURNS = 14;
  for (let i = 0; i < TURNS; i++) await call('POST', `/api/chat/${id}`, { message: `${'sword training '.repeat(60)}#${i}#`, connectionId: gem, settings });
  const calls = seen.slice(first).filter(isSummary);
  assert.ok(calls.length >= 1, 'summarization should have happened');
  assert.ok(calls.length <= 4, `expected batched summaries, got ${calls.length} for ${TURNS} turns`);
  const marks = calls.flatMap((c) => [...c.json.contents[0].parts[0].text.matchAll(/#(\d+)#/g)].map((m) => m[1]));
  assert.equal(new Set(marks).size, marks.length, 'a message was fed to the summarizer more than once');
  const s = db.getSession(id);
  assert.match(s.summary, /remembered fact/);
  assert.ok(s.summarizedCount > 0 && s.summarizedCount <= s.history.length);
});

test('delete messages by id, edit memory, clear chat', async () => {
  const s = (await call('GET', `/api/chat/${charId}`)).body;
  const victim = s.history.at(-1).id;
  const after = (await call('DELETE', `/api/chat/${charId}/messages`, { ids: [victim] })).body;
  assert.ok(!after.history.some((m) => m.id === victim));
  assert.equal((await call('PUT', `/api/chat/${charId}/summary`, { summary: 'Luffy is captain.' })).body.summary, 'Luffy is captain.');
});

test('characters: PUT cannot overwrite id; clones count up in roman numerals even after deletions', async () => {
  const c = (await call('POST', '/api/characters', { name: 'Obiwan', greeting: 'Hello', personality: 'Calm' })).body.character;
  const put = await call('PUT', `/api/characters/${c.id}`, { id: 'HACKED', name: 'Obiwan', personality: 'Calmer' });
  assert.equal(put.body.character.id, c.id);
  const c1 = (await call('POST', `/api/characters/${c.id}/clone`)).body.character;
  const c2 = (await call('POST', `/api/characters/${c.id}/clone`)).body.character;
  assert.deepEqual([c1.name, c2.name], ['Obiwan (I)', 'Obiwan (II)']);
  await call('DELETE', `/api/characters/${c1.id}`);
  const c3 = (await call('POST', `/api/characters/${c.id}/clone`)).body.character;
  assert.equal(c3.name, 'Obiwan (III)');                                  // old code produced a duplicate "(II)" here
});

test('lorebook keys are matched as whole words and empty keys never match everything', async () => {
  await call('POST', '/api/lorebook', { keys: 'Sasuke, ,Uchiha', content: 'Sasuke is the last Uchiha.' });
  const { matchLore } = require('../lib/prompt');
  assert.equal(matchLore(db.lore(), 'tell me about Sasuke').length, 1);
  assert.equal(matchLore(db.lore(), 'sasukeish nonsense').length, 0);
  assert.equal(matchLore(db.lore(), 'nothing relevant').length, 0);
});

// ---------------------------------------------------------------- storage
const tmpDir = (n) => fs.mkdtempSync(path.join(os.tmpdir(), `wod-${n}-`));
function writeLegacy(dir) {        // same shape as v2: data/*.json + sibling uploads/
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true }); fs.mkdirSync(path.join(dir, 'uploads'));
  fs.writeFileSync(path.join(dir, 'uploads', 'avatar-1.png'), 'png-bytes');
  fs.writeFileSync(path.join(dir, 'data', 'characters.json'), JSON.stringify({ characters: [
    { id: '111', name: 'Zoro', avatar: 'http://localhost:5000/uploads/avatar-1.png', greeting: 'Tch.', personality: 'Stoic', theme: 'amber' },
    { id: '222', name: 'Luffy', greeting: 'Yo!', personality: 'Cheerful' }] }));
  fs.writeFileSync(path.join(dir, 'data', 'chats.json'), JSON.stringify({ chats: {
    111: { history: [{ sender: 'character', text: 'Tch.' }, { sender: 'user', text: 'hi' },
      { sender: 'character', text: '⚠️ ERROR: Connection fault.' }, { sender: 'character', text: '⚠️ [FAILOVER TO LOCAL]\n\nReal reply' }], summary: 'old notes' },
    222: [{ sender: 'character', text: 'Yo!' }],
    999: { history: [{ sender: 'user', text: 'orphan chat of a deleted character' }] } } }));
  fs.writeFileSync(path.join(dir, 'data', 'lorebook.json'), JSON.stringify({ entries: [{ id: 'L1', keys: ['Sasuke'], content: 'Last Uchiha.' }, { id: 'L2', keys: [], content: 'no keys' }] }));
  return path.join(dir, 'data');
}

test('v2 JSON data is restored into SQLite: characters, chats, memory, lorebook, images; junk cleaned; source untouched', () => {
  const src = tmpDir('src'), legacyData = writeLegacy(src);
  const before = fs.readFileSync(path.join(legacyData, 'chats.json'), 'utf8');
  const d = new DB(tmpDir('new'));
  const r = d.autoImportLegacy([legacyData]);
  assert.deepEqual([r.characters, r.messages, r.lore, r.images], [2, 4, 1, 1]);   // orphan chat + keyless lore entry are not imported
  const z = d.getSession('111');
  assert.deepEqual(z.history.map((m) => m.text), ['Tch.', 'hi', 'Real reply']);   // error bubble dropped, failover prefix stripped
  assert.equal(z.summary, 'old notes');
  assert.ok(z.history.every((m) => m.id));
  assert.equal(d.findCharacter('111').avatar, '/uploads/avatar-1.png');           // absolute localhost URL made portable
  assert.ok(fs.existsSync(path.join(d.uploadsDir, 'avatar-1.png')));
  assert.equal(fs.readFileSync(path.join(legacyData, 'chats.json'), 'utf8'), before);
  assert.equal(d.autoImportLegacy([legacyData]), null);                           // runs once
  d.close();
});

test('data survives a restart, and a re-import never duplicates or overwrites', () => {
  const dir = tmpDir('persist'), legacyData = writeLegacy(tmpDir('src2'));
  let d = new DB(dir); d.autoImportLegacy([legacyData]);
  const s = d.getSession('222'); s.history.push({ id: 'x1', sender: 'user', text: 'new message', ts: 1 }); d.saveSession('222', s);
  d.close();
  d = new DB(dir);                                                                // "restart"
  assert.equal(d.characters().length, 2);
  assert.equal(d.getSession('222').history.at(-1).text, 'new message');
  const again = d.importLegacyDir(legacyData);
  assert.equal(again.characters, 0); assert.equal(again.skipped, 2);
  assert.equal(d.getSession('222').history.length, 2);
  d.close();
});

test('deleting a character removes its chat; export -> import round-trips into a fresh database; keys are never exported', () => {
  const d = new DB(tmpDir('rt')); d.importLegacyDir(writeLegacy(tmpDir('src3')));
  d.addConnection({ label: 'K', provider: 'openai', model: 'gpt-4o', apiKey: 'sk-SECRET' });
  const dump = d.exportAll();
  assert.ok(!JSON.stringify(dump).includes('sk-SECRET'));
  const fresh = new DB(tmpDir('rt2'));
  const st = fresh.importAll(JSON.parse(JSON.stringify(dump)));
  assert.deepEqual([st.characters, st.messages, st.lore], [2, 4, 1]);
  assert.equal(fresh.getSession('111').history.at(-1).text, 'Real reply');
  d.deleteCharacter('111');
  assert.equal(d.getSession('111').history.length, 0);
  assert.equal(d.get('SELECT COUNT(*) n FROM messages WHERE char_id = ?', '111').n, 0);
  d.close(); fresh.close();
});

test('a daily backup snapshot is written and is itself a valid database', () => {
  const dir = tmpDir('bk'); let d = new DB(dir); d.addCharacter({ name: 'A', personality: 'p' }); d.close();
  d = new DB(dir);                                                                // backup happens on start once data exists
  const files = fs.readdirSync(path.join(dir, 'backups'));
  assert.equal(files.length, 1);
  const copy = new DB(path.join(tmpDir('bk2')), { backups: false }); copy.close();
  const { DatabaseSync } = require('node:sqlite');
  const snap = new DatabaseSync(path.join(dir, 'backups', files[0]));
  assert.equal(snap.prepare('SELECT COUNT(*) n FROM characters').get().n, 1);
  snap.close(); d.close();
});

test('HTTP export/import endpoints', async () => {
  const dump = (await call('GET', '/api/export')).body;
  assert.ok(Array.isArray(dump.characters) && dump.app === 'the-will-of-d');
  assert.equal((await call('POST', '/api/import', dump)).body.imported.characters, 0);   // everything already present
  assert.equal((await call('POST', '/api/import', { nope: 1 })).status, 400);
});

test('mood engine: sustained joy -> luffy, sustained darkness -> blackbeard, with hysteresis', () => {
  let m = null;
  for (let i = 0; i < 3; i++) m = mood.advance(m, mood.turnLex('Let us go on an adventure, friend!', '*laughs* Shishishi! What a great, fun adventure! I love meat!'));
  assert.equal(m.theme, 'luffy');
  m = mood.advance(m, mood.turnLex('ok', 'Alright then.'));                // one neutral turn must not flip back
  assert.equal(m.theme, 'luffy');
  for (let i = 0; i < 4; i++) m = mood.advance(m, mood.turnLex('I will have my revenge.', 'Blood and darkness. Everyone will die. There is only despair and pain.'));
  assert.equal(m.theme, 'blackbeard');
  assert.ok(mood.lex('I am not happy') < 0, 'negation flips polarity');
});

test('AI mood refinement endpoint blends a model opinion', async () => {
  const r = await call('POST', `/api/chat/${charId}/mood`, { connectionId: gem });
  assert.equal(r.status, 200);
  assert.equal(r.body.mood.source, 'ai');
  assert.ok(r.body.mood.score < 0.2);
});
