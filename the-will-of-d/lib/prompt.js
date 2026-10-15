'use strict';

const estimateTokens = (t) => (t ? Math.ceil(t.length / 4) : 0);   // rough: ~4 chars/token
const fill = (s, char, user) => String(s || '').replace(/{{\s*user\s*}}/gi, user).replace(/{{\s*char\s*}}/gi, char);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Lorebook: whole-word, case-insensitive match against recent messages. Empty keys are ignored. */
function matchLore(entries, text, limit = 6) {
  const out = [];
  for (const e of entries || []) {
    if (!e.content) continue;
    const hit = (e.keys || []).map((k) => String(k).trim()).filter(Boolean)
      .some((k) => new RegExp(`(^|[^\\p{L}\\p{N}])${esc(k)}($|[^\\p{L}\\p{N}])`, 'iu').test(text));
    if (hit) out.push(e.content);
    if (out.length >= limit) break;
  }
  return out;
}

function buildSystem({ char, userName, summary, lore, sceneDirector }) {
  const f = (s) => fill(s, char.name, userName);
  const p = [`You are roleplaying as ${char.name}. Stay in character. Never speak, act or decide for ${userName}; only write ${char.name}'s side (and the world around them).`];
  if (sceneDirector) p.push(`[SCENE DIRECTOR]\nBesides ${char.name}, you may briefly describe the environment and any secondary characters (NPCs) present, to keep the scene atmospheric.`);
  if (summary?.trim()) p.push(`[LONG-TERM MEMORY]\nEstablished earlier in this conversation:\n${summary.trim()}`);
  if (lore?.length) p.push(`[WORLD INFO]\n${lore.map((l) => `- ${f(l)}`).join('\n')}`);
  if (char.description) p.push(`[APPEARANCE]\n${f(char.description)}`);
  if (char.personality) p.push(`[PERSONALITY]\n${f(char.personality)}`);
  if (char.scenario) p.push(`[SCENARIO]\n${f(char.scenario)}`);
  if (char.mes_example) p.push(`[EXAMPLE DIALOGUE]\n${f(char.mes_example)}`);
  return p.join('\n\n');
}

/** history -> provider-neutral turns. Merges same-role neighbours, guarantees the first turn is "user". */
function toTurns(history, postInstructions = '') {
  const turns = [];
  for (const m of history) {
    const text = (m.text || '').trim();
    if (!text) continue;
    const role = m.sender === 'user' ? 'user' : 'assistant';
    const last = turns[turns.length - 1];
    if (last && last.role === role) last.content += `\n\n${text}`; else turns.push({ role, content: text });
  }
  if (turns[0]?.role === 'assistant') turns.unshift({ role: 'user', content: '*The scene begins.*' });
  const last = turns[turns.length - 1];
  if (postInstructions.trim() && last?.role === 'user') last.content += `\n\n[Style rules for your reply: ${postInstructions.trim()}]`;
  return turns;
}

/** How many of the oldest messages to drop. Drops down to 75% of budget so summaries happen in batches, not every turn. */
function pruneCount(history, inputBudget, systemTokens) {
  const cost = (m) => estimateTokens(m.text) + 4;
  let total = systemTokens + history.reduce((a, m) => a + cost(m), 0);
  if (total <= inputBudget) return { drop: 0, total };
  const target = Math.max(256, Math.floor(inputBudget * 0.75));
  let drop = 0;
  while (total > target && history.length - drop > 2) { total -= cost(history[drop]); drop++; }
  return { drop, total };
}

module.exports = { estimateTokens, fill, matchLore, buildSystem, toTurns, pruneCount };
