import { useState } from 'react'
import { api, asset, uploadImage } from '../api'
import { Corners, Crown } from '../theme/Ornaments'

const EMPTY = { name: '', avatar: '', background: '', greeting: '', personality: '', description: '', scenario: '', mes_example: '', post_history_instructions: '' }

export default function CharacterForm({ initial, onSaved, onCancel }) {
  const [f, setF] = useState({ ...EMPTY, ...initial })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))
  const editing = !!initial?.id

  const pick = (k) => async (e) => {
    const file = e.target.files?.[0]; if (!file) return
    try { const url = await uploadImage(file); setF((s) => ({ ...s, [k]: url })) } catch (x) { setErr(x.message) }
  }
  const save = async (e) => {
    e.preventDefault(); setErr('')
    if (!f.name.trim() || !f.personality.trim()) return setErr('Name and personality are required.')
    setBusy(true)
    try {
      const r = await api(editing ? `/api/characters/${initial.id}` : '/api/characters', { method: editing ? 'PUT' : 'POST', body: f })
      onSaved(r.character)
    } catch (x) { setErr(x.message) } finally { setBusy(false) }
  }
  const Img = ({ k, label }) => (
    <div className="field"><label>{label}</label>
      <div className="row">{f[k] ? <img className="preview" src={asset(f[k])} alt="" /> : <div className="preview" />}
        <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={pick(k)} />
        {f[k] && <button type="button" className="btn sm" onClick={() => setF((s) => ({ ...s, [k]: '' }))}>Remove</button>}</div></div>
  )
  const T = ({ k, label, rows = 3, ph }) => <div className="field"><label>{label}</label><textarea rows={rows} value={f[k]} onChange={set(k)} placeholder={ph} /></div>

  return (
    <div className="forge"><form className="sheet" onSubmit={save}>
      <Corners />
      <div className="modal-head"><Crown size={28} /><h2>{editing ? `Edit ${initial.name}` : 'Create a character'}</h2></div>
      <p className="hint" style={{ marginTop: -6 }}>Tip: use <code>{'{{char}}'}</code> and <code>{'{{user}}'}</code> anywhere — they are replaced with the character's and your name.</p>
      <div className="grid2"><Img k="avatar" label="Avatar" /><Img k="background" label="Chat background" /></div>
      <div className="field"><label>Name *</label><input value={f.name} onChange={set('name')} placeholder="Monkey D. Luffy" /></div>
      <T k="greeting" label="First message" ph="What the character says to open the chat" />
      <T k="personality" label="Personality *" rows={5} ph="How they think, speak and behave" />
      <T k="description" label="Appearance / description" />
      <T k="scenario" label="Scenario" ph="Where and why the two of you are meeting" />
      <T k="mes_example" label="Example dialogue" rows={4} ph={'{{user}}: Hi!\n{{char}}: *grins* Yo!'} />
      <T k="post_history_instructions" label="Style rules (reminded before every reply)" rows={2} ph="e.g. Keep replies under 3 paragraphs." />
      {err && <div className="banner error">{err}</div>}
      <div className="row"><button className="btn primary" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Create character'}</button><button type="button" className="btn" onClick={onCancel}>Cancel</button></div>
    </form></div>
  )
}
