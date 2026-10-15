import { Avatar } from './common'
import { Crown } from '../theme/Ornaments'

export default function Sidebar({ characters, activeId, onSelect, onNew, connection, onConnections, onImport, open, onClose }) {
  return (
    <>
      <div className={`scrim ${open ? 'open' : ''}`} onClick={onClose} />
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          <Crown size={30} />
          <h1>THE WILL OF D</h1>
          <small>AI character chat</small>
        </div>
        <div className="side-actions"><button className="btn primary block" onClick={onNew}>＋ New character</button></div>
        <div className="char-list">
          {characters.length === 0 && <p className="hint" style={{ padding: 8 }}>No characters yet. Create your first one!</p>}
          {characters.map((c) => (
            <button key={c.id} className={`char ${String(c.id) === String(activeId) ? 'active' : ''}`} onClick={() => onSelect(c.id)}>
              <Avatar src={c.avatar} name={c.name} />
              <div className="meta"><b>{c.name}</b><span>{c.greeting}</span></div>
            </button>
          ))}
        </div>
        <div className="side-foot">
          <button className={`conn-chip ${connection ? '' : 'empty'}`} onClick={onConnections}>
            <small>AI connection</small>
            <b>{connection ? connection.label : 'Not connected — set up'}</b>
          </button>
          <div className="row">
            <a className="btn sm grow" style={{ textAlign: 'center', textDecoration: 'none' }} href="/api/export" download title="Download all characters, chats and lorebook as one file (API keys are not included)">⬇ Backup</a>
            <label className="btn sm grow" style={{ textAlign: 'center' }} title="Restore from a backup file (adds; never overwrites)">⬆ Restore
              <input type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onImport(f) }} /></label>
          </div>
        </div>
      </aside>
    </>
  )
}
