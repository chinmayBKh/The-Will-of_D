import { useEffect, useRef, useState } from 'react'
import { Avatar, Styled } from './common'
import { Cutout, Corners } from '../theme/Ornaments'
import { MODES, THEMES } from '../theme/themes'

function Bubble({ m, char, selecting, selected, onToggle }) {
  const user = m.sender === 'user'
  return (
    <div className={`msg ${user ? 'user' : 'bot'}`}>
      {selecting && <input type="checkbox" checked={selected} onChange={onToggle} aria-label="Select message" />}
      {!user && <Avatar src={char.avatar} name={char.name} />}
      <div className={`bubble ${selected ? 'sel' : ''}`}>
        <Styled text={m.text} />
        {!user && m.meta?.model && (
          <span className={`tag ${m.meta.fallbackFrom ? 'warn' : ''}`}>
            {m.meta.fallbackFrom ? `↪ fallback: ${m.meta.connection} (“${m.meta.fallbackFrom}” failed)` : `${m.meta.connection} · ${m.meta.model}`}
          </span>
        )}
      </div>
    </div>
  )
}

export default function ChatView(p) {
  const { char, session, sending, error, usage, connections, connId, theme, themeMode, vn } = p
  const [menu, setMenu] = useState(false)
  const [text, setText] = useState('')
  const [selecting, setSelecting] = useState(false)
  const [picked, setPicked] = useState([])
  const end = useRef(null), box = useRef(null)
  const history = session?.history || []
  const lastBot = [...history].reverse().find((m) => m.sender === 'character')

  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }) }, [history.length, sending])
  useEffect(() => { setSelecting(false); setPicked([]); setText('') }, [char.id])
  useEffect(() => { if (box.current) { box.current.style.height = 'auto'; box.current.style.height = `${Math.min(160, box.current.scrollHeight)}px` } }, [text])

  const submit = () => { const t = text.trim(); if (!t || sending) return; setText(''); p.onSend(t) }
  const canRegen = !sending && history.length > 1 && history[history.length - 1].sender === 'character'
  const mood = session?.mood
  const pos = mood ? ((mood.score + 1) / 2) * 100 : 50
  const act = (fn) => () => { setMenu(false); fn() }
  const meter = usage ? Math.min(100, Math.round((usage.total / usage.budget) * 100)) : 0

  return (
    <>
      <header className="topbar">
        <button className="icon-btn only-mobile" onClick={p.onOpenSidebar} aria-label="Characters">☰</button>
        <div className="who">
          <Avatar src={char.avatar} name={char.name} size={42} />
          <div style={{ minWidth: 0 }}><b>{char.name}</b><small>{connections.find((c) => c.id === connId)?.model || 'No model selected'}</small></div>
        </div>
        <div className="tools">
          <select value={connId} onChange={(e) => (e.target.value === '__manage' ? p.onConnections() : p.onPickConn(e.target.value))} aria-label="AI connection">
            {!connId && <option value="">Choose connection…</option>}
            {connections.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            <option value="__manage">⚙ Manage connections…</option>
          </select>
          <div className="seg" role="group" aria-label="Theme">
            {MODES.map((m) => <button key={m.id} className={themeMode === m.id ? 'on' : ''} title={`${m.label} — ${m.hint}`} onClick={() => p.onThemeMode(m.id)}>{m.icon}</button>)}
          </div>
          <span className="mood" title={`Mood ${mood ? mood.score.toFixed(2) : '0'} (${mood?.source || 'lexicon'})`}>
            <span className="pill gold">{THEMES[theme].icon} {THEMES[theme].label}</span>
            <span className="bar"><i style={{ left: `calc(${pos}% - 2px)` }} /></span>
          </span>
          <button className="icon-btn" title={vn ? 'Chat feed' : 'Scene view'} onClick={p.onToggleVn}>{vn ? '💬' : '📖'}</button>
          <button className="icon-btn" title="Chat settings & memory" onClick={p.onSettings}>⚙</button>
          <div className="menu-wrap">
            <button className="icon-btn" aria-label="More" onClick={() => setMenu(!menu)}>⋯</button>
            {menu && (
              <div className="menu" onMouseLeave={() => setMenu(false)}>
                <button onClick={act(p.onEdit)}>✏️ Edit character</button>
                <button onClick={act(p.onClone)}>👥 Clone character</button>
                <button onClick={act(p.onExport)}>💾 Export chat (.txt)</button>
                <button onClick={act(() => { setSelecting(true); setPicked([]) })}>☑️ Select & delete messages</button>
                <button className="red" onClick={act(p.onClear)}>🧹 Clear chat</button>
                <button className="red" onClick={act(p.onDelete)}>🗑️ Delete character</button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="stage">
        {char.background && <div className="stage-bg" style={{ backgroundImage: `url(${char.background.replace(/^https?:\/\/(localhost|127\.0\.0\.1):\d+/, '')})` }} />}
        <Corners />
        <Cutout theme={theme} />

        {vn ? (
          <div className="scene"><div className="card"><span className="name">{char.name}</span><Styled text={lastBot?.text || char.greeting} />
            {canRegen && <div style={{ marginTop: 14 }}><button className="btn sm" onClick={p.onRegenerate}>🔄 Regenerate</button></div>}
            {sending && <div className="typing"><i /><i /><i /></div>}</div></div>
        ) : (
          <div className="feed">
            <div className="feed-inner">
              {history.map((m) => <Bubble key={m.id} m={m} char={char} selecting={selecting} selected={picked.includes(m.id)} onToggle={() => setPicked((s) => (s.includes(m.id) ? s.filter((x) => x !== m.id) : [...s, m.id]))} />)}
              {sending && <div className="msg bot"><Avatar src={char.avatar} name={char.name} /><div className="bubble"><div className="typing"><i /><i /><i /></div></div></div>}
              {canRegen && !selecting && <div><button className="btn sm ghost" onClick={p.onRegenerate}>🔄 Regenerate last reply</button></div>}
              <div ref={end} />
            </div>
          </div>
        )}
      </div>

      <div className="dock">
        <div className="dock-inner">
          {!connId && <div className="banner info"><b>No AI connected yet.</b> Pick a provider, model and API key to start chatting. <button className="btn sm primary" onClick={p.onConnections}>Set up connection</button></div>}
          {error && (
            <div className="banner error">
              <b>The AI could not answer.</b> {error.message}
              {error.hint && <div className="hint">{error.hint}</div>}
              <div className="row" style={{ marginTop: 8 }}>
                <button className="btn sm primary" onClick={p.onRegenerate}>↻ Retry</button>
                <button className="btn sm" onClick={p.onConnections}>Open connections</button>
              </div>
            </div>
          )}
          {p.note && <div className="banner info">Primary connection “{p.note.from}” failed ({p.note.error}), so your fallback answered.</div>}
          {selecting ? (
            <div className="row">
              <button className="btn danger" disabled={!picked.length} onClick={() => { p.onDeleteMessages(picked); setSelecting(false); setPicked([]) }}>🗑️ Delete {picked.length} selected</button>
              <button className="btn" onClick={() => { setSelecting(false); setPicked([]) }}>Cancel</button>
            </div>
          ) : (
            <form className="composer" onSubmit={(e) => { e.preventDefault(); submit() }}>
              <textarea ref={box} rows={1} value={text} disabled={sending} placeholder={`Message ${char.name}…  (Enter to send, Shift+Enter for a new line)`}
                onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }} />
              <button className="btn primary" type="submit" disabled={sending || !text.trim()}>Send ➤</button>
            </form>
          )}
          {usage && <button className="meter" onClick={p.onSettings} title="Open context settings"><span>Context {usage.total}/{usage.budget} tok</span><span className="track"><i className={meter > 85 ? 'hot' : ''} style={{ width: `${meter}%` }} /></span></button>}
        </div>
      </div>
    </>
  )
}
