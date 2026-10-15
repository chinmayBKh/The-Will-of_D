'use strict';
const { uid } = require('./db');
const providers = require('./providers');
const { estimateTokens, matchLore, buildSystem, toTurns, pruneCount } = require('./prompt');
const mood = require('./mood');

const httpError = (status, message) => Object.assign(new Error(message), { status });
const num = (v, min, max, d) => { v = Number(v); return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d; };
const newMsg = (sender, text, meta) => ({ id: uid(), sender, text, ts: Date.now(), ...(meta ? { meta } : {}) });

// One request at a time per character: no read-modify-write races on chats.json.
const tails = new Map();
function withLock(key, fn) {
  const run = (tails.get(key) || Promise.resolve()).then(() => fn());
  const tail = run.catch(() => {});
  tails.set(key, tail);
  tail.then(() => { if (tails.get(key) === tail) tails.delete(key); });
  return run;
}

function cleanSettings(s = {}) {
  return {
    maxContextBudget: num(s.maxContextBudget, 1024, 65536, 8192),
    maxOutputTokens: num(s.maxOutputTokens, 64, 8192, 1024),
    temperature: num(s.temperature, 0, 1.5, 0.9),
    userName: String(s.userName || 'Navigator').slice(0, 40),
    sceneDirector: s.sceneDirector !== false,
  };
}

/** Load a session; a brand-new chat is seeded with the character's greeting (server-side, so it is persisted). */
function loadSession(db, char) {
  const s = db.getSession(char.id);
  if (!s.history.length) {
    s.history = [{ id: uid(), sender: 'character', text: char.greeting || `Hello, I am ${char.name}.`, ts: Date.now() }];
    db.saveSession(char.id, s);
  }
  if (!s.mood) s.mood = mood.moodFromHistory(s.history);
  return s;
}

const view = (s) => ({ history: s.history, summary: s.summary, mood: s.mood });

async function getSessionView(db, charId) {
  const char = db.findCharacter(charId);
  if (!char) throw httpError(404, 'Character not found.');
  return withLock(charId, async () => view(loadSession(db, char)));
}

async function summarize(conn, existing, chunk, char, userName) {
  const text = chunk.map((m) => `${m.sender === 'user' ? userName : char.name}: ${m.text}`).join('\n');
  const { text: out } = await providers.chat(conn, {
    system: 'You are a memory compaction engine for a roleplay chat. Merge the new messages into the existing notes. Keep only durable facts: events, decisions, promises, relationships, names, locations, emotional shifts. Be concise, factual, bullet-pointed. Output ONLY the updated notes.',
    messages: [{ role: 'user', content: `[EXISTING NOTES]\n${existing || 'None'}\n\n[NEW MESSAGES]\n${text}\n\n[UPDATED NOTES]` }],
    maxTokens: 1500, temperature: 0.3,
  });
  return out.trim();
}

async function converse(db, p) {
  return withLock(p.charId, async () => {
    const char = db.findCharacter(p.charId);
    if (!char) throw httpError(404, 'Character not found.');
    const conn = p.connectionId && db.getConnection(p.connectionId);
    if (!conn) throw httpError(400, 'No AI connection selected. Open Connections and add one.');
    const fallback = p.fallbackId && p.fallbackId !== conn.id ? db.getConnection(p.fallbackId) : null;
    const st = cleanSettings(p.settings);

    const session = loadSession(db, char);
    const h = session.history;
    if (p.regenerate) { if (h.length > 1 && h[h.length - 1].sender === 'character') h.pop(); }
    else {
      const text = String(p.message || '').trim();
      if (!text) throw httpError(400, 'Message is empty.');
      h.push(newMsg('user', text));
    }
    if (h[h.length - 1].sender !== 'user') throw httpError(400, 'There is no message to reply to.');
    db.saveSession(char.id, session);          // the user's message is safe even if the provider fails

    const fail = (err) => { err.history = session.history; throw err; };

    // ---- context budget: system + window must fit in (budget - reserved reply) ----
    const lastUser = h[h.length - 1].text;
    const lore = matchLore(db.lore(), h.slice(-4).map((m) => m.text).join('\n'));
    const inputBudget = Math.max(512, st.maxContextBudget - st.maxOutputTokens);
    let system = buildSystem({ char, userName: st.userName, summary: session.summary, lore, sceneDirector: st.sceneDirector });
    const { drop } = pruneCount(h, inputBudget, estimateTokens(system));

    // summarize only what has NOT been summarized yet (the old code re-summarized the same messages every turn)
    if (drop > session.summarizedCount) {
      try {
        session.summary = await summarize(conn, session.summary, h.slice(session.summarizedCount, drop), char, st.userName);
        session.summarizedCount = drop;
        system = buildSystem({ char, userName: st.userName, summary: session.summary, lore, sceneDirector: st.sceneDirector });
      } catch (e) { console.warn(`Memory summarization skipped: ${e.message}`); }
    }

    const windowMsgs = h.slice(drop);
    const req = { system, messages: toTurns(windowMsgs, char.post_history_instructions), maxTokens: st.maxOutputTokens, temperature: st.temperature, numCtx: st.maxContextBudget };

    // ---- generate. Fallback is opt-in and always disclosed; errors are never swallowed ----
    let result, used = conn, fallbackInfo = null;
    try { result = await providers.chat(conn, req); }
    catch (err) {
      if (!fallback) fail(err);
      try { result = await providers.chat(fallback, req); used = fallback; fallbackInfo = { from: conn.label, error: err.message }; }
      catch { fail(err); }       // report the PRIMARY failure; that is the one the user can fix
    }

    const reply = newMsg('character', result.text.trim(), { connection: used.label, model: used.model, ...(fallbackInfo ? { fallbackFrom: fallbackInfo.from } : {}) });
    h.push(reply);
    session.mood = mood.advance(session.mood, mood.turnLex(lastUser, reply.text));
    db.saveSession(char.id, session);

    const sysT = estimateTokens(system);
    const histT = windowMsgs.reduce((a, m) => a + estimateTokens(m.text) + 4, 0);
    return {
      ...view(session),
      fallback: fallbackInfo,
      usage: { system: sysT, history: histT, output: result.usage?.output || estimateTokens(reply.text), total: sysT + histT, budget: st.maxContextBudget, dropped: drop },
    };
  });
}

/** Optional AI second opinion on the vibe. Cheap, async, and its failure never affects chat. */
async function refineMood(db, { charId, connectionId }) {
  return withLock(charId, async () => {
    const char = db.findCharacter(charId);
    const conn = connectionId && db.getConnection(connectionId);
    if (!char || !conn) throw httpError(400, 'Mood check needs a character and a connection.');
    const session = loadSession(db, char);
    const recent = session.history.slice(-4).map((m) => `${m.sender === 'user' ? 'User' : char.name}: ${m.text.slice(0, 600)}`).join('\n');
    const { text } = await providers.chat(conn, { system: mood.AI_SYSTEM, messages: [{ role: 'user', content: recent }], maxTokens: 400, temperature: 0 });
    const ai = mood.parseAiMood(text);
    if (ai === null) return view(session);
    const lexTurn = session.mood?.turn ?? 0;
    session.mood = mood.nextMood(session.mood, clampMix(ai, lexTurn), 'ai');
    db.saveSession(char.id, session);
    return view(session);
  });
}
const clampMix = (ai, lexTurn) => mood.clamp(0.7 * ai + 0.3 * lexTurn);

async function editSession(db, charId, fn) {
  return withLock(charId, async () => {
    const char = db.findCharacter(charId);
    if (!char) throw httpError(404, 'Character not found.');
    const s = loadSession(db, char);
    fn(s);
    db.saveSession(charId, s);
    return view(s);
  });
}

const deleteMessages = (db, charId, ids) => editSession(db, charId, (s) => {
  const gone = new Set(ids);
  s.history = s.history.filter((m) => !gone.has(m.id));
  s.summarizedCount = Math.min(s.summarizedCount, s.history.length);
  if (s.mood) s.mood = mood.moodFromHistory(s.history);
});
const setSummary = (db, charId, summary) => editSession(db, charId, (s) => { s.summary = String(summary || ''); });

module.exports = { converse, refineMood, getSessionView, deleteMessages, setSummary, withLock, httpError, cleanSettings };
