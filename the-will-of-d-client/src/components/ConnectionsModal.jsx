import { useState } from 'react'
import { api } from '../api'
import { Modal } from './common'

const CUSTOM = '__custom__'

export default function ConnectionsModal({ providers, connections, connId, fallbackId, onUse, onFallback, onChanged, onClose }) {
  const [form, setForm] = useState(null)        // null = list view
  const [models, setModels] = useState([])
  const [custom, setCustom] = useState(false)
  const [status, setStatus] = useState(null)    // {kind:'ok'|'error'|'info', text, hint}
  const [busy, setBusy] = useState('')
  const [showKey, setShowKey] = useState(false)
  const prov = (id) => providers.find((p) => p.id === id)
  const suggested = (id) => (prov(id)?.suggested || []).map((m) => ({ id: m, label: m }))

  const fetchModels = async (f = form) => {
    setBusy('models'); setStatus({ kind: 'info', text: 'Loading models…' })
    try {
      const r = await api('/api/models', { method: 'POST', body: { id: f.id, provider: f.provider, apiKey: f.apiKey, baseUrl: f.baseUrl } })
      setModels(r.models)
      setStatus({ kind: 'ok', text: `${r.models.length} models available from ${prov(f.provider).name}.` })
      if (r.models.length && !r.models.some((m) => m.id === f.model) && !custom) setForm((s) => ({ ...s, model: r.models[0].id }))
    } catch (e) { setStatus({ kind: 'error', text: e.message, hint: e.hint }) } finally { setBusy('') }
  }
  const open = (c) => {
    const f = c ? { id: c.id, provider: c.provider, model: c.model, apiKey: '', baseUrl: c.baseUrl || '', label: c.label, hasKey: c.hasKey, keyPreview: c.keyPreview }
      : { provider: providers[0].id, model: providers[0].suggested[0] || '', apiKey: '', baseUrl: '', label: '' }
    setForm(f); setModels(suggested(f.provider)); setCustom(false); setStatus(null); setShowKey(false)
    if (c && (c.hasKey || !prov(c.provider).needsKey)) fetchModels(f)
    else if (!c && !providers[0].needsKey) fetchModels(f)
  }
  const pickProvider = (id) => {
    const f = { ...form, provider: id, model: prov(id).suggested[0] || '', baseUrl: '', apiKey: '' }
    setForm(f); setModels(suggested(id)); setCustom(false); setStatus(null)
    if (!prov(id).needsKey && id !== 'custom') fetchModels(f)
  }
  const inList = models.some((m) => m.id === form?.model)
  const sel = custom || (!inList && form?.model) ? CUSTOM : form?.model || ''

  const test = async (body) => {
    setBusy('test'); setStatus({ kind: 'info', text: 'Testing…' })
    try { const r = await api('/api/connections/test', { method: 'POST', body }); setStatus({ kind: 'ok', text: `Connected ✓ (${r.ms} ms) — replied: ${r.reply}` }) }
    catch (e) { setStatus({ kind: 'error', text: e.message, hint: e.hint }) } finally { setBusy('') }
  }
  const save = async () => {
    setBusy('save')
    try {
      const r = await api(form.id ? `/api/connections/${form.id}` : '/api/connections', { method: form.id ? 'PUT' : 'POST', body: form })
      await onChanged(r.connection.id, !form.id); setForm(null); setStatus(null)
    } catch (e) { setStatus({ kind: 'error', text: e.message, hint: e.hint }) } finally { setBusy('') }
  }
  const remove = async (c) => { if (confirm(`Delete connection “${c.label}”? Its saved API key will be removed.`)) { await api(`/api/connections/${c.id}`, { method: 'DELETE' }); await onChanged() } }

  if (form) {
    const p = prov(form.provider)
    return (
      <Modal title={form.id ? 'Edit connection' : 'Add connection'} onClose={onClose}>
        <div className="steps">
          <div className="field"><label>AI provider</label>
            <select value={form.provider} onChange={(e) => pickProvider(e.target.value)}>{providers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>

          {p.editableBase && <div className="field"><label>Base URL</label>
            <input value={form.baseUrl} placeholder={p.baseUrl || 'https://your-server/v1'} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} onBlur={() => form.provider !== 'custom' || form.baseUrl ? fetchModels() : null} />
            {form.provider === 'custom' && <span className="hint">Any OpenAI-compatible endpoint (LM Studio, vLLM, Together, …).</span>}</div>}

          <div className="field"><label>Model</label>
            <div className="row">
              <select className="grow" value={sel} onChange={(e) => { if (e.target.value === CUSTOM) { setCustom(true) } else { setCustom(false); setForm({ ...form, model: e.target.value }) } }}>
                {models.map((m) => <option key={m.id} value={m.id}>{m.label !== m.id ? `${m.label} (${m.id})` : m.id}</option>)}
                <option value={CUSTOM}>Custom model ID…</option>
              </select>
              <button type="button" className="btn" disabled={!!busy || (p.needsKey && !form.apiKey && !form.hasKey)} onClick={() => fetchModels()} title="Load the live model list from the provider">↻ Fetch models</button>
            </div>
            {sel === CUSTOM && <input value={form.model} placeholder="type the exact model ID" onChange={(e) => setForm({ ...form, model: e.target.value })} />}
            <span className="hint">{models.length ? `${models.length} models listed.` : ''} {p.needsKey && !form.apiKey && !form.hasKey ? 'Enter your key below, then press “Fetch models” for the full live list.' : ''}</span></div>

          {p.needsKey ? (
            <div className="field"><label>API key</label>
              <div className="row"><input className="grow" type={showKey ? 'text' : 'password'} autoComplete="off" spellCheck="false" value={form.apiKey}
                placeholder={form.hasKey ? `${form.keyPreview} saved — leave blank to keep` : 'Paste your API key'}
                onChange={(e) => setForm({ ...form, apiKey: e.target.value })} onBlur={() => form.apiKey && fetchModels()} />
                <button type="button" className="icon-btn" onClick={() => setShowKey(!showKey)} aria-label="Show or hide key">{showKey ? '🙈' : '👁'}</button></div>
              <span className="hint">Stored only on this computer (data/connections.json). {p.keyUrl && <>Get a key: <a href={p.keyUrl} target="_blank" rel="noreferrer">{new URL(p.keyUrl).host} ↗</a></>}</span></div>
          ) : (
            <div className="field"><label>API key (optional)</label>
              <input type="password" autoComplete="off" value={form.apiKey} placeholder={form.hasKey ? `${form.keyPreview} saved — leave blank to keep` : 'Only if your server requires one'} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} /></div>
          )}

          <div className="field"><label>Name tag</label>
            <input value={form.label} placeholder={`e.g. My ${p.name}`} onChange={(e) => setForm({ ...form, label: e.target.value })} /></div>
        </div>

        {status && <div className={`banner ${status.kind}`}>{status.text}{status.hint && <div className="hint">{status.hint}</div>}</div>}
        <div className="row wrap">
          <button className="btn primary" disabled={!!busy || !form.model} onClick={save}>{busy === 'save' ? 'Saving…' : 'Save connection'}</button>
          <button className="btn" disabled={!!busy || !form.model} onClick={() => test(form)}>Test connection</button>
          <button className="btn ghost" onClick={() => { setForm(null); setStatus(null) }}>Back</button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title="AI connections" onClose={onClose}>
      <p className="hint" style={{ marginTop: 0 }}>Each connection is one provider + model + API key. Switch between them any time from the chat header.</p>
      {connections.length === 0 && <div className="banner info">No connections yet. Add your first one — Gemini, OpenAI, Claude, OpenRouter, Groq or a local Ollama model.</div>}
      {connections.map((c) => (
        <div key={c.id} className={`conn-card ${c.id === connId ? 'active' : ''}`}>
          <div className="info"><b>{c.label}</b><small>{prov(c.provider)?.name || c.provider} · {c.model} {c.hasKey && `· ${c.keyPreview}`}</small></div>
          {c.id === connId && <span className="pill gold">Active</span>}
          {c.id === fallbackId && <span className="pill">Fallback</span>}
          {c.id !== connId && <button className="btn sm" onClick={() => onUse(c.id)}>Use</button>}
          <button className="btn sm" onClick={() => onFallback(c.id === fallbackId ? '' : c.id)} title="Used only if the active connection fails">{c.id === fallbackId ? 'Remove fallback' : 'Set as fallback'}</button>
          <button className="btn sm" onClick={() => test({ id: c.id })}>Test</button>
          <button className="btn sm" onClick={() => open(c)}>Edit</button>
          <button className="btn sm danger" onClick={() => remove(c)}>Delete</button>
        </div>
      ))}
      {status && <div className={`banner ${status.kind}`}>{status.text}{status.hint && <div className="hint">{status.hint}</div>}</div>}
      <button className="btn primary" onClick={() => open(null)}>＋ Add connection</button>
    </Modal>
  )
}
