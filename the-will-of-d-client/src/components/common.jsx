import { useEffect, useState } from 'react'
import { asset } from '../api'
import { Corners, Crown } from '../theme/Ornaments'

export function Avatar({ src, name, size = 38 }) {
  const [bad, setBad] = useState(false)
  useEffect(() => setBad(false), [src])
  const style = { width: size, height: size, fontSize: size * 0.4 }
  if (src && !bad) return <img className="avatar" style={style} src={asset(src)} alt={name || ''} onError={() => setBad(true)} />
  return <div className="avatar" style={style}>{(name || '?').charAt(0).toUpperCase()}</div>
}

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={wide ? { width: 'min(860px,100%)' } : undefined} role="dialog" aria-label={title}>
        <Corners />
        <div className="modal-head"><Crown size={26} /><h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label="Close">✕</button></div>
        {children}
      </div>
    </div>
  )
}

/** Renders *actions* and "dialogue" with different styling. */
export function Styled({ text }) {
  const parts = String(text || '').split(/(\*[^*\n]+\*|"[^"\n]+")/g)
  return parts.map((p, i) => {
    if (p.length > 2 && p.startsWith('*') && p.endsWith('*')) return <span key={i} className="act">{p}</span>
    if (p.length > 2 && p.startsWith('"') && p.endsWith('"')) return <span key={i} className="say">{p}</span>
    return <span key={i}>{p}</span>
  })
}
