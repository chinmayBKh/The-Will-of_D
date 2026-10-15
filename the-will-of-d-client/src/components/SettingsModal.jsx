import { useEffect, useState } from 'react'
import { api } from '../api'
import { Modal } from './common'

function Lorebook() {
  const [items, setItems] = useState([]), [keys, setKeys] = useState(''), [content, setContent] = useState(''), [err, setErr] = useState('')
  const load = () => api('/api/lorebook').then(setItems).catch((e) => setErr(e.message))
  useEffect(() => { load() }, [])
  const add = async () => {
    setErr('')
    try { await api('/api/lorebook', { method: 'POST', body: { keys, content } }); setKeys(''); setContent(''); load() } catch (e) { setErr(e.message) }
  }
  return (
    <>
      <p className="hint" style={{ marginTop: 0 }}>World info is injected into the prompt only when one of its keywords appears in the recent conversation.</p>
      <div className="field"><label>Keywords (comma separated)</label><input value={keys} onChange={(e) => setKeys(e.target.value)} placeholder="Sasuke, Uchiha" /></div>
      <div className="field"><label>Content</label><textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="Facts the AI should know when these words come up" /></div>
      {err && <div className="banner error">{err}</div>}
      <button className="btn primary" onClick={add}>Add entry</button>
      <div className="divider">✦</div>
      {items.length === 0 && <p className="hint">No entries yet.</p>}
      {items.map((e) => (
        <div key={e.id} className="lore-item">
          <div className="grow"><div className="keys">{e.keys.map((k) => <span key={k} className="pill">{k}</span>)}</div><div>{e.content}</div></div>
          <button className="btn sm danger" onClick={async () => { await api(`/api/lorebook/${e.id}`, { method: 'DELETE' }); load() }}>Delete</button>
        </div>
      ))}
    </>
  )
}

export default function SettingsModal({ settings, setSettings, usage, summary, onSaveSummary, charName, onClose }) {
  const [tab, setTab] = useState('context')
  const [mem, setMem] = useState(summary || '')
  const set = (k, v) => setSettings((s) => ({ ...s, [k]: v }))
  const Slider = ({ k, label, min, max, step, fmt = (v) => v, note }) => (
    <div className="field"><label>{label}: {fmt(settings[k])}</label>
      <input type="range" min={min} max={max} step={step} value={settings[k]} onChange={(e) => set(k, Number(e.target.value))} />{note && <span className="hint">{note}</span>}</div>
  )
  return (
    <Modal title={`Chat settings · ${charName}`} onClose={onClose}>
      <div className="tabs">{[['context', 'Context'], ['behavior', 'Behavior'], ['memory', 'Memory'], ['lore', 'Lorebook']].map(([id, l]) => <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{l}</button>)}</div>

      {tab === 'context' && <>
        <Slider k="maxContextBudget" label="Context window" min={1024} max={65536} step={512} fmt={(v) => `${v} tokens`} note="Instructions + history + the reply must fit in this. Older messages are summarized into Memory when it fills up. Local models (Ollama) are also told to use this window." />
        <Slider k="maxOutputTokens" label="Max response tokens" min={128} max={8192} step={128} fmt={(v) => `${v} tokens`} note="Reserved for the reply. Reasoning models (e.g. Gemini 3.x) spend some of this on thinking, so keep it at 1024 or more." />
        <Slider k="temperature" label="Creativity (temperature)" min={0} max={1.5} step={0.05} fmt={(v) => Number(v).toFixed(2)} />
        {usage && <div className="banner">Last request: instructions {usage.system} + history {usage.history} ≈ <b>{usage.total}</b> of {usage.budget} tokens{usage.dropped ? ` · ${usage.dropped} older messages moved to memory` : ''}. Token counts are estimates (~4 characters each).</div>}
      </>}

      {tab === 'behavior' && <>
        <div className="field"><label>Your name in the story</label><input value={settings.userName} onChange={(e) => set('userName', e.target.value)} /><span className="hint">Replaces {'{{user}}'} in character cards.</span></div>
        <div className="field"><label><input type="checkbox" checked={settings.sceneDirector} onChange={(e) => set('sceneDirector', e.target.checked)} /> Scene director — let the AI also describe surroundings and extra characters</label></div>
        <div className="field"><label><input type="checkbox" checked={settings.aiMood} onChange={(e) => set('aiMood', e.target.checked)} /> AI mood sensing — ask the model to double-check the vibe after each reply (one extra small request)</label>
          <span className="hint">Without it, the theme still reacts to the mood using a fast built-in word analysis. The theme switches only after the vibe holds for a couple of messages, so it won't flicker.</span></div>
      </>}

      {tab === 'memory' && <>
        <p className="hint" style={{ marginTop: 0 }}>Long-term notes the AI always sees. They are written automatically when old messages fall out of the context window — edit them freely.</p>
        <div className="field"><textarea rows={10} value={mem} onChange={(e) => setMem(e.target.value)} placeholder="Nothing summarized yet." /></div>
        <div className="row"><button className="btn primary" onClick={() => onSaveSummary(mem)}>Save memory</button><button className="btn danger" onClick={() => { setMem(''); onSaveSummary('') }}>Wipe memory</button></div>
      </>}

      {tab === 'lore' && <Lorebook />}
    </Modal>
  )
}
