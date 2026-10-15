import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'
import { useLocal } from './hooks'
import { DEFAULT_SETTINGS } from './theme/themes'
import { Splash } from './theme/Ornaments'
import Sidebar from './components/Sidebar'
import ChatView from './components/ChatView'
import CharacterForm from './components/CharacterForm'
import ConnectionsModal from './components/ConnectionsModal'
import SettingsModal from './components/SettingsModal'
import { Crown } from './theme/Ornaments'

export default function App() {
  const [characters, setCharacters] = useState([])
  const [activeId, setActiveId] = useLocal('wod.char', null)
  const [providers, setProviders] = useState([])
  const [connections, setConnections] = useState([])
  const [connId, setConnId] = useLocal('wod.conn', '')
  const [fallbackId, setFallbackId] = useLocal('wod.fallback', '')
  const [settings, setSettings] = useLocal('wod.settings', DEFAULT_SETTINGS)
  const [themeMode, setThemeMode] = useLocal('wod.themeMode', 'auto')
  const [vn, setVn] = useLocal('wod.vn', false)

  const [session, setSession] = useState(null)
  const [usage, setUsage] = useState(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const [note, setNote] = useState(null)
  const [view, setView] = useState('chat')            // chat | forge
  const [editing, setEditing] = useState(null)
  const [modal, setModal] = useState(null)            // connections | settings
  const [drawer, setDrawer] = useState(false)
  const [splash, setSplash] = useState(null)
  const [fatal, setFatal] = useState('')

  const activeRef = useRef(activeId)
  useEffect(() => { activeRef.current = activeId }, [activeId])
  const char = characters.find((c) => String(c.id) === String(activeId))

  // ---------- theme: mood decides unless the user pinned one ----------
  const theme = themeMode === 'auto' ? (session?.mood?.theme || 'grandline') : themeMode
  const prevTheme = useRef({ theme, id: activeId })
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    const p = prevTheme.current
    if (p.theme !== theme && p.id === activeId) setSplash({ theme, key: Date.now() })
    prevTheme.current = { theme, id: activeId }
  }, [theme, activeId])

  // ---------- loading ----------
  const loadConnections = useCallback(async (preferId) => {
    const list = await api('/api/connections')
    setConnections(list)
    setConnId((cur) => (preferId || (list.some((c) => c.id === cur) ? cur : list[0]?.id || '')))
    setFallbackId((cur) => (list.some((c) => c.id === cur) ? cur : ''))
  }, [setConnId, setFallbackId])

  const loadCharacters = useCallback(async () => {
    const list = await api('/api/characters')
    setCharacters(list)
    setActiveId((cur) => (list.some((c) => String(c.id) === String(cur)) ? cur : list[0]?.id ?? null))
    return list
  }, [setActiveId])

  useEffect(() => {
    Promise.all([api('/api/providers').then(setProviders), loadConnections(), loadCharacters()]).catch((e) => setFatal(e.message))
  }, [loadConnections, loadCharacters])

  useEffect(() => {
    if (!activeId) { setSession(null); return }
    setSession(null); setError(null); setNote(null); setUsage(null)
    let live = true
    api(`/api/chat/${activeId}`).then((s) => live && setSession(s)).catch((e) => live && setError({ message: e.message }))
    return () => { live = false }
  }, [activeId])

  // ---------- chat actions ----------
  const send = async (text, regenerate = false) => {
    if (!connId) return setModal('connections')
    const id = activeId
    setSending(true); setError(null); setNote(null)
    if (!regenerate) setSession((s) => ({ ...s, history: [...s.history, { id: 'pending', sender: 'user', text, ts: Date.now() }] }))
    try {
      const r = await api(`/api/chat/${id}`, { method: 'POST', body: { message: text, regenerate, connectionId: connId, fallbackId: fallbackId || undefined, settings } })
      if (activeRef.current !== id) return
      setSession({ history: r.history, summary: r.summary, mood: r.mood }); setUsage(r.usage); setNote(r.fallback)
      if (settings.aiMood) {
        api(`/api/chat/${id}/mood`, { method: 'POST', body: { connectionId: connId } })
          .then((m) => activeRef.current === id && setSession((s) => ({ ...s, mood: m.mood }))).catch(() => {})
      }
    } catch (e) {
      if (activeRef.current !== id) return
      if (e.history) setSession((s) => ({ ...s, history: e.history }))
      setError({ message: e.message, hint: e.hint })
    } finally { setSending(false) }
  }

  const act = async (fn) => { try { await fn() } catch (e) { setError({ message: e.message }) } }
  const deleteMessages = (ids) => act(async () => setSession(await api(`/api/chat/${activeId}/messages`, { method: 'DELETE', body: { ids } })))
  const clearChat = () => confirm(`Clear the whole chat and memory with ${char.name}?`) && act(async () => { await api(`/api/chat/${activeId}`, { method: 'DELETE' }); setSession(await api(`/api/chat/${activeId}`)); setUsage(null) })
  const deleteChar = () => confirm(`Delete ${char.name} and their chat forever?`) && act(async () => { await api(`/api/characters/${activeId}`, { method: 'DELETE' }); await loadCharacters() })
  const clone = () => act(async () => { const r = await api(`/api/characters/${activeId}/clone`, { method: 'POST' }); await loadCharacters(); setActiveId(r.character.id) })
  const saveSummary = (summary) => act(async () => { const s = await api(`/api/chat/${activeId}/summary`, { method: 'PUT', body: { summary } }); setSession(s); setModal(null) })
  const exportChat = () => {
    const t = (session?.history || []).map((m) => `${m.sender === 'user' ? settings.userName : char.name}: ${m.text}`).join('\n\n')
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([t], { type: 'text/plain' })), download: `${char.name}-chat.txt` })
    a.click(); URL.revokeObjectURL(a.href)
  }

  const importBackup = async (file) => {
    try {
      const r = await api('/api/import', { method: 'POST', body: JSON.parse(await file.text()) })
      await loadCharacters()
      alert(`Restored ${r.imported.characters} characters, ${r.imported.messages} messages and ${r.imported.lore} lore entries (${r.imported.skipped} already existed).`)
    } catch (e) { alert(`Could not restore: ${e instanceof SyntaxError ? 'that file is not valid JSON.' : e.message}`) }
  }

  const select = (id) => { setActiveId(id); setView('chat'); setDrawer(false) }
  const connection = connections.find((c) => c.id === connId)

  return (
    <div className="app">
      <Sidebar characters={characters} activeId={activeId} onSelect={select} onNew={() => { setEditing({}); setView('forge'); setDrawer(false) }}
        connection={connection} onImport={importBackup} onConnections={() => { setModal('connections'); setDrawer(false) }} open={drawer} onClose={() => setDrawer(false)} />
      <main className="main">
        {fatal && <div className="banner error" style={{ margin: 16 }}><b>Backend unreachable.</b> {fatal}</div>}
        {view === 'forge' ? (
          <CharacterForm key={editing?.id || 'new'} initial={editing} onCancel={() => setView('chat')}
            onSaved={async (c) => { await loadCharacters(); setActiveId(c.id); setView('chat') }} />
        ) : char ? (
          <ChatView char={char} session={session} sending={sending} error={error} note={note} usage={usage}
            connections={connections} connId={connId} theme={theme} themeMode={themeMode} vn={vn}
            onSend={(t) => send(t)} onRegenerate={() => send('', true)} onPickConn={setConnId} onConnections={() => setModal('connections')}
            onThemeMode={setThemeMode} onToggleVn={() => setVn(!vn)} onSettings={() => setModal('settings')}
            onEdit={() => { setEditing(char); setView('forge') }} onClone={clone} onExport={exportChat} onClear={clearChat} onDelete={deleteChar}
            onDeleteMessages={deleteMessages} onOpenSidebar={() => setDrawer(true)} />
        ) : (
          <div className="empty-state"><div className="crown"><Crown size={64} /></div><h2>Set sail</h2>
            <p>Create your first character, then connect an AI provider to start talking.</p>
            <button className="btn primary" onClick={() => { setEditing({}); setView('forge') }}>＋ New character</button></div>
        )}
      </main>

      {modal === 'connections' && (
        <ConnectionsModal providers={providers} connections={connections} connId={connId} fallbackId={fallbackId}
          onUse={setConnId} onFallback={setFallbackId} onClose={() => setModal(null)}
          onChanged={async (id, isNew) => { await loadConnections(isNew && !connId ? id : undefined) }} />
      )}
      {modal === 'settings' && char && (
        <SettingsModal settings={settings} setSettings={setSettings} usage={usage} summary={session?.summary} charName={char.name} onSaveSummary={saveSummary} onClose={() => setModal(null)} />
      )}
      {splash && <Splash key={splash.key} theme={splash.theme} onDone={() => setSplash(null)} />}
    </div>
  )
}
