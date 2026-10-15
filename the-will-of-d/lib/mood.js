'use strict';
/**
 * Conversation "vibe" -> UI theme.
 *  - Instant, free, offline lexicon score of the latest exchange (always on).
 *  - Optional AI second opinion (a tiny classification call) blended in.
 *  - Smoothed over turns, with hysteresis, so the theme never flickers.
 * score: -1 (dark) … +1 (joyful).  theme: 'blackbeard' | 'grandline' (neutral) | 'luffy'
 */
const POS = new Set(`laugh laughing laughed haha hehe shishishi lol happy joy joyful glad love loved adventure friend friends nakama crew fun funny great awesome amazing wonderful thank thanks grateful celebrate celebration party feast meat delicious smile smiling smiled grin grinning grinned hope hopeful dream dreams freedom sunny bright warm cheer cheerful excited excitement yay hooray proud brave courage together promise treasure sail sailing victory peace gentle kind kindness cozy comfort safe blessing wonderful beautiful`.split(/\s+/));
const NEG = new Set(`kill killed killing murder blood bloody bleed bleeding death dead die dying dies corpse grave betray betrayed betrayal revenge vengeance dark darkness shadow shadows pain agony scream screaming hate hatred fear afraid terror dread despair hopeless doom cursed curse war massacre torture suffer suffering rage fury wrath cruel evil sinister bleak grim lonely empty ruin ruined slaughter grief mourn mourning weep sorrow tragic nightmare menace menacing`.split(/\s+/));
const EMOJI = { '😄': 1, '😂': 1, '😁': 1, '😊': 1, '🥳': 1, '❤': 1, '🍖': 1, '☀': 1, '💀': -1, '🩸': -1, '😢': -1, '😡': -1, '🖤': -1, '😈': -1, '⚔': -0.5 };
const NEGATORS = new Set(['not', 'no', 'never', "don't", "didn't", "isn't", "wasn't", "won't", 'without', "can't", 'cannot']);

function lex(text) {
  const toks = String(text || '').toLowerCase().match(/[\p{L}']+|[\u2600-\u27BF\u{1F300}-\u{1FAFF}]/gu) || [];
  let pos = 0, neg = 0;
  toks.forEach((t, i) => {
    let w = POS.has(t) ? 1 : NEG.has(t) ? -1 : (EMOJI[t] || 0);
    if (!w) return;
    if (toks.slice(Math.max(0, i - 2), i).some((p) => NEGATORS.has(p))) w = -w * 0.6;
    if (w > 0) pos += w; else neg -= w;
  });
  return (pos - neg) / (pos + neg + 1.5);
}

const clamp = (n, a = -1, b = 1) => Math.min(b, Math.max(a, n));
const turnLex = (userText, replyText) => clamp(0.4 * lex(userText) + 0.6 * lex(replyText));

function blend(prev, turn) {
  // a very strong turn moves the needle immediately; otherwise average with history
  return clamp(Math.abs(turn) > 0.5 ? 0.3 * prev + 0.7 * turn : 0.55 * prev + 0.45 * turn);
}

function pickTheme(s, prev) {
  if (prev === 'luffy') return s > 0.08 ? 'luffy' : s < -0.2 ? 'blackbeard' : 'grandline';
  if (prev === 'blackbeard') return s < -0.08 ? 'blackbeard' : s > 0.2 ? 'luffy' : 'grandline';
  return s > 0.2 ? 'luffy' : s < -0.2 ? 'blackbeard' : 'grandline';
}

/** base = score before this turn (kept so an AI opinion can re-score the same turn without double counting). */
function nextMood(prev, turn, source = 'lexicon') {
  const base = prev?.base ?? prev?.score ?? 0;
  const score = blend(base, turn);
  return { score: +score.toFixed(3), base: +base.toFixed(3), turn: +turn.toFixed(3), theme: pickTheme(score, prev?.theme), source };
}
const advance = (prev, turn) => nextMood({ ...(prev || {}), base: prev?.score ?? 0 }, turn, 'lexicon');

function moodFromHistory(history) {
  let m = null;
  const msgs = history.slice(-8);
  for (let i = 0; i < msgs.length; i++) {
    if (msgs[i].sender !== 'character') continue;
    const prevUser = msgs[i - 1]?.sender === 'user' ? msgs[i - 1].text : '';
    m = advance(m, turnLex(prevUser, msgs[i].text));
  }
  return m || { score: 0, base: 0, turn: 0, theme: 'grandline', source: 'lexicon' };
}

const AI_SYSTEM = 'You classify the emotional tone of a roleplay conversation for a UI. Reply with ONLY a JSON object: {"mood":"good"|"neutral"|"dark","confidence":0-1}. "good" = playful, warm, adventurous, hopeful, funny. "dark" = grim, violent, hostile, tragic, menacing, despairing. "neutral" = everything else.';
function parseAiMood(text) {
  const m = String(text || '').match(/\{[\s\S]*?\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    const c = clamp(Number(j.confidence ?? 0.7), 0, 1);
    return { good: 0.9 * c, dark: -0.9 * c, neutral: 0 }[String(j.mood).toLowerCase()] ?? null;
  } catch { return null; }
}

module.exports = { lex, turnLex, advance, nextMood, moodFromHistory, pickTheme, AI_SYSTEM, parseAiMood, clamp };
