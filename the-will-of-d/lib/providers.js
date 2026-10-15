'use strict';
/**
 * One adapter per API *shape*, one registry entry per *provider*.
 * Nothing here is hard-coded to a key or a model: the UI picks provider -> model -> key.
 * Plain fetch only (Node 18+), so there are no vendor SDKs to break or update.
 */

class ProviderError extends Error {
  constructor(message, { status, code, provider, hint } = {}) {
    super(message);
    this.name = 'ProviderError';
    Object.assign(this, { status, code, provider, hint });
  }
}

const PROVIDERS = {
  gemini: {
    name: 'Google Gemini', kind: 'gemini', needsKey: true,
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    keyUrl: 'https://aistudio.google.com/apikey',
    suggested: ['gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-3.1-flash-lite'],
  },
  openai: {
    name: 'OpenAI', kind: 'openai', needsKey: true,
    baseUrl: 'https://api.openai.com/v1', keyUrl: 'https://platform.openai.com/api-keys',
    maxTokensField: 'max_completion_tokens', noTemperature: true, suggested: [],
  },
  anthropic: {
    name: 'Anthropic Claude', kind: 'anthropic', needsKey: true,
    baseUrl: 'https://api.anthropic.com/v1', keyUrl: 'https://console.anthropic.com/settings/keys',
    suggested: ['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5'],
  },
  openrouter: {
    name: 'OpenRouter', kind: 'openai', needsKey: true,
    baseUrl: 'https://openrouter.ai/api/v1', keyUrl: 'https://openrouter.ai/keys', suggested: ['openrouter/auto'],
  },
  groq: {
    name: 'Groq', kind: 'openai', needsKey: true,
    baseUrl: 'https://api.groq.com/openai/v1', keyUrl: 'https://console.groq.com/keys', suggested: [],
  },
  ollama: {
    name: 'Ollama (local)', kind: 'ollama', needsKey: false, editableBase: true,
    baseUrl: 'http://localhost:11434', suggested: ['llama3.2:3b'],
  },
  custom: {
    name: 'Custom (OpenAI-compatible)', kind: 'openai', needsKey: false, editableBase: true,
    baseUrl: '', suggested: [],
  },
};

const publicProviders = () => Object.entries(PROVIDERS).map(([id, p]) => ({
  id, name: p.name, needsKey: p.needsKey, editableBase: !!p.editableBase,
  baseUrl: p.baseUrl, keyUrl: p.keyUrl || '', suggested: p.suggested,
}));

// ---------------------------------------------------------------- http
function friendlyHint(status, msg, provider) {
  const m = String(msg || '');
  if (/api key not valid|API_KEY_INVALID|invalid api key|incorrect api key|invalid x-api-key/i.test(m)) return 'The provider rejected this API key. Re-copy it (no spaces) or create a new one.';
  if (status === 401 || status === 403) return 'The key was rejected or lacks permission for this model.';
  if (status === 404) return 'Model not found for this key. Open Connections and press "Fetch models" to see what is actually available.';
  if (status === 429) return 'Rate limit or quota reached. Wait a moment, check your plan/billing, or switch connection.';
  if (status === 400 && /model/i.test(m)) return 'The model name may be wrong or retired. Refresh the model list.';
  return '';
}

async function http(provider, url, { method = 'GET', headers = {}, body, timeout = 120000 } = {}) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout),
    });
  } catch (e) {
    const code = e.cause?.code || e.code || e.name;
    if (e.name === 'TimeoutError') throw new ProviderError('The provider took too long to answer (timeout).', { provider, code: 'timeout' });
    if (code === 'ECONNREFUSED') {
      throw new ProviderError(`Cannot connect to ${new URL(url).origin}.`, { provider, code,
        hint: provider === 'ollama' ? 'Start Ollama (`ollama serve`) and make sure the model is pulled.' : 'Check the base URL and your internet connection.' });
    }
    throw new ProviderError(`Network error: ${e.cause?.message || e.message}`, { provider, code });
  }
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  if (!res.ok) {
    const raw = json?.error?.message || (typeof json?.error === 'string' ? json.error : '') || json?.message || text.slice(0, 300) || res.statusText;
    throw new ProviderError(raw, { provider, status: res.status, code: json?.error?.status || json?.error?.type || res.status, hint: friendlyHint(res.status, raw, provider) });
  }
  return json ?? {};
}

const tokenLimitError = (provider) => new ProviderError(
  'The model used up the response-token limit before writing any text (reasoning models spend tokens on thinking).',
  { provider, code: 'max_tokens', hint: 'Raise "Max response tokens" in Chat settings (try 2048+).' });

// ---------------------------------------------------------------- adapters
const adapters = {
  gemini: {
    async list({ apiKey, base }) {
      const out = []; let pageToken = '';
      for (let i = 0; i < 5; i++) {
        const data = await http('gemini', `${base}/models?pageSize=200${pageToken ? `&pageToken=${pageToken}` : ''}`, { headers: { 'x-goog-api-key': apiKey } });
        for (const m of data.models || []) {
          const id = m.name.replace(/^models\//, '');
          if (m.supportedGenerationMethods?.includes('generateContent') && !/(image|tts|live|embedding|imagen|veo|robotics|audio|aqa)/i.test(id)) out.push({ id, label: m.displayName || id });
        }
        if (!data.nextPageToken) break; pageToken = data.nextPageToken;
      }
      return out;
    },
    async chat({ apiKey, base, model, system, messages, maxTokens, temperature }) {
      const data = await http('gemini', `${base}/models/${encodeURIComponent(model.replace(/^models\//, ''))}:generateContent`, {
        method: 'POST', headers: { 'x-goog-api-key': apiKey },
        body: {
          systemInstruction: { parts: [{ text: system }] },
          contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
          generationConfig: { maxOutputTokens: maxTokens, temperature },
        },
      });
      const cand = data.candidates?.[0];
      if (!cand) {
        const why = data.promptFeedback?.blockReason;
        throw new ProviderError(why ? `Gemini blocked the prompt (${why}).` : 'Gemini returned no answer.', { provider: 'gemini', code: why || 'empty' });
      }
      const text = (cand.content?.parts || []).filter((p) => p.text && !p.thought).map((p) => p.text).join('');
      if (!text.trim()) {
        if (cand.finishReason === 'MAX_TOKENS') throw tokenLimitError('gemini');
        throw new ProviderError(`Gemini returned an empty reply (finishReason: ${cand.finishReason || 'unknown'}). A safety filter may have intervened.`, { provider: 'gemini', code: cand.finishReason });
      }
      return { text, usage: { input: data.usageMetadata?.promptTokenCount, output: data.usageMetadata?.candidatesTokenCount } };
    },
  },

  openai: {
    async list({ apiKey, base, id }) {
      const data = await http(id, `${base}/models`, { headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {} });
      let ids = (data.data || []).map((m) => ({ id: m.id, label: m.name || m.id }));
      if (id === 'openai') ids = ids.filter((m) => /^(gpt-|o\d|chatgpt-)/.test(m.id) && !/(audio|realtime|transcribe|tts|image|embedding|moderation|search|whisper)/.test(m.id));
      if (id === 'groq') ids = ids.filter((m) => !/(whisper|guard|tts|playai)/i.test(m.id));
      return ids;
    },
    async chat({ apiKey, base, model, system, messages, maxTokens, temperature, def, id }) {
      const body = { model, messages: [{ role: 'system', content: system }, ...messages] };
      body[def.maxTokensField || 'max_tokens'] = maxTokens;
      if (!def.noTemperature) body.temperature = temperature;
      const headers = {};
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      if (id === 'openrouter') headers['X-Title'] = 'The Will of D';
      const data = await http(id, `${base}/chat/completions`, { method: 'POST', headers, body });
      const choice = data.choices?.[0];
      const content = choice?.message?.content;
      const text = Array.isArray(content) ? content.map((c) => c.text || '').join('') : (content || '');
      if (!text.trim()) {
        if (choice?.finish_reason === 'length') throw tokenLimitError(id);
        throw new ProviderError(`${PROVIDERS[id]?.name || 'Provider'} returned an empty reply${choice?.finish_reason ? ` (${choice.finish_reason})` : ''}.`, { provider: id, code: 'empty' });
      }
      return { text, usage: { input: data.usage?.prompt_tokens, output: data.usage?.completion_tokens } };
    },
  },

  anthropic: {
    async list({ apiKey, base }) {
      const data = await http('anthropic', `${base}/models?limit=1000`, { headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' } });
      return (data.data || []).map((m) => ({ id: m.id, label: m.display_name || m.id }));
    },
    async chat({ apiKey, base, model, system, messages, maxTokens, temperature }) {
      const data = await http('anthropic', `${base}/messages`, {
        method: 'POST', headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: { model, system, messages, max_tokens: maxTokens, temperature: Math.min(1, temperature) },
      });
      const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
      if (!text.trim()) {
        if (data.stop_reason === 'max_tokens') throw tokenLimitError('anthropic');
        throw new ProviderError('Claude returned an empty reply.', { provider: 'anthropic', code: 'empty' });
      }
      return { text, usage: { input: data.usage?.input_tokens, output: data.usage?.output_tokens } };
    },
  },

  ollama: {
    async list({ base }) {
      const data = await http('ollama', `${base}/api/tags`, { timeout: 10000 });
      return (data.models || []).map((m) => ({ id: m.name, label: m.name }));
    },
    async chat({ base, model, system, messages, maxTokens, temperature, numCtx }) {
      const data = await http('ollama', `${base}/api/chat`, {
        method: 'POST', timeout: 300000,
        body: { model, stream: false, messages: [{ role: 'system', content: system }, ...messages],
          options: { num_ctx: numCtx, num_predict: maxTokens, temperature } },
      });
      const text = data.message?.content || '';
      if (!text.trim()) throw new ProviderError('Ollama returned an empty reply.', { provider: 'ollama', code: 'empty' });
      return { text, usage: { input: data.prompt_eval_count, output: data.eval_count } };
    },
  },
};

// ---------------------------------------------------------------- public api
function resolve(conn) {
  const def = PROVIDERS[conn.provider];
  if (!def) throw new ProviderError(`Unknown provider "${conn.provider}".`, { code: 'bad_provider' });
  const base = (conn.baseUrl || def.baseUrl || '').replace(/\/+$/, '');
  if (!base) throw new ProviderError('This provider needs a Base URL.', { provider: conn.provider, code: 'no_base' });
  if (def.needsKey && !conn.apiKey) throw new ProviderError(`No API key saved for "${conn.label || def.name}".`, { provider: conn.provider, code: 'no_key', hint: 'Open Connections and paste your key.' });
  return { def, base, adapter: adapters[def.kind], ctx: { apiKey: conn.apiKey, base, id: conn.provider, def } };
}

async function listModels(conn) {
  const { adapter, ctx } = resolve(conn);
  const models = await adapter.list(ctx);
  return models.sort((a, b) => a.id.localeCompare(b.id));
}

async function chat(conn, { system, messages, maxTokens = 1024, temperature = 0.9, numCtx = 8192 }) {
  if (!conn.model) throw new ProviderError('No model selected for this connection.', { provider: conn.provider, code: 'no_model' });
  const { adapter, ctx } = resolve(conn);
  return adapter.chat({ ...ctx, model: conn.model, system, messages, maxTokens, temperature, numCtx });
}

module.exports = { PROVIDERS, ProviderError, publicProviders, listModels, chat };
