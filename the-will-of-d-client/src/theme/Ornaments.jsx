import { useEffect, useState } from 'react'
import { THEMES } from './themes'

/** Small gold crown glyph — the "royal touch" used in headers, dividers and modals. */
export function Crown({ size = 22, className = '' }) {
  return (
    <svg className={className} width={size} height={size * 0.66} viewBox="0 0 64 42" fill="currentColor" aria-hidden="true">
      <path d="M4 36 L8 12 L21 24 L32 6 L43 24 L56 12 L60 36 Z" />
      <rect x="4" y="36" width="56" height="5" rx="1.5" />
      <circle cx="8" cy="10" r="3.2" /><circle cx="32" cy="4" r="3.2" /><circle cx="56" cy="10" r="3.2" />
    </svg>
  )
}

/** Gold filigree corners for a framed panel. Parent must be position: relative. */
export function Corners() {
  const piece = (cls) => (
    <svg className={`corner ${cls}`} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M3 44 V10 Q3 3 10 3 H44" />
      <path d="M11 38 V17 Q11 11 17 11 H38" strokeWidth="1.2" opacity=".7" />
      <path d="M16 3 C20 10 26 10 30 3" strokeWidth="1.2" opacity=".6" />
      <circle cx="6" cy="6" r="2.6" fill="currentColor" stroke="none" />
    </svg>
  )
  return <>{piece('tl')}{piece('tr')}{piece('bl')}{piece('br')}</>
}

/* ---------------------------------------------------------------- emblems (original artwork) */
function StrawHatEmblem() {
  return (
    <svg viewBox="0 0 260 300" aria-hidden="true">
      <g transform="translate(130 150)">
        {Array.from({ length: 20 }, (_, i) => (
          <polygon key={i} points="-7,-92 7,-92 0,-140" fill="#f6c844" opacity={i % 2 ? 0.55 : 0.9} transform={`rotate(${i * 18})`} />
        ))}
        <circle r="88" fill="#ffe08a" stroke="#d9a21b" strokeWidth="4" />
        <circle r="74" fill="none" stroke="#d9a21b" strokeWidth="1.5" strokeDasharray="3 5" />
      </g>
      {/* hat */}
      <ellipse cx="130" cy="158" rx="104" ry="24" fill="#e9c46a" stroke="#9a6b1f" strokeWidth="3" />
      <path d="M62 154 C62 92 98 70 130 70 C162 70 198 92 198 154 C168 166 92 166 62 154 Z" fill="#f4d57f" stroke="#9a6b1f" strokeWidth="3" />
      <path d="M64 140 C96 154 164 154 196 140 L198 156 C166 170 94 170 62 156 Z" fill="#cf2d2d" stroke="#8d1717" strokeWidth="2" />
      {[100, 112, 124].map((y) => <path key={y} d={`M${72 + (y - 100) * 0.4} ${y - 8} C100 ${y} 160 ${y} ${188 - (y - 100) * 0.4} ${y - 8}`} stroke="#c9a14a" strokeWidth="1.6" fill="none" opacity=".75" />)}
      {/* crown floating above */}
      <g transform="translate(86 16) scale(1.32)" fill="#d9a21b" stroke="#8a5f0c" strokeWidth="1.4">
        <path d="M4 36 L8 12 L21 24 L32 6 L43 24 L56 12 L60 36 Z" />
        <rect x="4" y="36" width="56" height="5" rx="1.5" />
        <circle cx="8" cy="10" r="3.2" fill="#cf2d2d" /><circle cx="32" cy="4" r="3.2" fill="#2f7fd6" /><circle cx="56" cy="10" r="3.2" fill="#cf2d2d" />
      </g>
      {/* ribbon */}
      <path d="M40 252 H220 L206 268 L220 284 H40 L54 268 Z" fill="#cf2d2d" stroke="#8d1717" strokeWidth="2" />
      <path d="M90 266 H170" stroke="#ffe08a" strokeWidth="2" strokeDasharray="2 5" />
    </svg>
  )
}

function JollyRogerEmblem() {
  const bone = '#e8dfcf', ink = '#0b0910', gold = '#c9a14a'
  const sabre = (rot) => (
    <g transform={`translate(130 150) rotate(${rot})`}>
      <path d="M-6 -118 C8 -100 8 -40 3 40 L-3 40 C-8 -40 -8 -100 -6 -118 Z" fill="#cfd3dc" stroke="#6b7080" strokeWidth="2" />
      <rect x="-26" y="40" width="52" height="8" rx="3" fill={gold} stroke="#7a5d1f" strokeWidth="1.5" />
      <rect x="-5" y="48" width="10" height="46" rx="4" fill="#3a2a4f" stroke="#7a5d1f" strokeWidth="1.5" />
      <circle cx="0" cy="100" r="8" fill={gold} stroke="#7a5d1f" strokeWidth="1.5" />
    </g>
  )
  return (
    <svg viewBox="0 0 260 300" aria-hidden="true">
      <circle cx="130" cy="150" r="118" fill="#1a1028" stroke={gold} strokeWidth="3" />
      <circle cx="130" cy="150" r="106" fill="none" stroke={gold} strokeWidth="1" strokeDasharray="2 6" opacity=".8" />
      {sabre(48)}{sabre(-48)}
      {/* beard */}
      {[[98, 0], [112, 8], [130, 12], [148, 8], [162, 0]].map(([x, d], i) => (
        <g key={i}>
          <path d={`M${x} 168 C${x - 12 + d} 206 ${x + 12 - d} 236 ${x - 4 + d / 2} 276`} stroke={ink} strokeWidth={i === 2 ? 16 : 12} strokeLinecap="round" fill="none" />
          <circle cx={x - 4 + d / 2} cy="278" r="4.5" fill="#ff8a1f"><animate attributeName="opacity" values="1;.35;1" dur={`${1.2 + i * 0.25}s`} repeatCount="indefinite" /></circle>
        </g>
      ))}
      {/* skull */}
      <path d="M130 66 C86 66 72 104 78 134 C80 148 90 150 92 160 L92 176 H168 L168 160 C170 150 180 148 182 134 C188 104 174 66 130 66 Z" fill={bone} stroke="#8a8068" strokeWidth="2" />
      <ellipse cx="108" cy="126" rx="15" ry="18" fill={ink} /><ellipse cx="152" cy="126" rx="15" ry="18" fill={ink} />
      <circle cx="108" cy="126" r="3.2" fill="#ff4d4d" /><circle cx="152" cy="126" r="3.2" fill="#ff4d4d" />
      <path d="M130 140 L121 158 H139 Z" fill={ink} />
      {[104, 117, 130, 143, 156].map((x) => <rect key={x} x={x - 4} y="166" width="8" height="12" fill={bone} stroke="#8a8068" strokeWidth="1.5" rx="1.5" />)}
      {/* tricorne hat */}
      <path d="M58 92 C84 36 176 36 202 92 L188 98 C168 74 92 74 72 98 Z" fill="#17101f" stroke={gold} strokeWidth="2.5" />
      <path d="M58 92 L40 100 L72 98 Z M202 92 L220 100 L188 98 Z" fill="#17101f" stroke={gold} strokeWidth="2" />
      <path d="M96 76 C118 66 142 66 164 76" stroke={gold} strokeWidth="3" fill="none" />
      <g transform="translate(110 20) scale(.62)" fill={gold} stroke="#7a5d1f" strokeWidth="1.6">
        <path d="M4 36 L8 12 L21 24 L32 6 L43 24 L56 12 L60 36 Z" /><rect x="4" y="36" width="56" height="5" rx="1.5" />
        <circle cx="32" cy="4" r="3.6" fill="#8b5cf6" />
      </g>
    </svg>
  )
}

function CompassEmblem() {
  return (
    <svg viewBox="0 0 260 300" aria-hidden="true">
      <g transform="translate(130 150)" fill="none" stroke="#d9a441" strokeWidth="3">
        <circle r="104" /><circle r="92" strokeWidth="1" strokeDasharray="2 6" />
        <polygon points="0,-96 14,-14 96,0 14,14 0,96 -14,14 -96,0 -14,-14" fill="#d9a44133" />
        <polygon points="0,-120 8,-8 120,0 8,8 0,120 -8,8 -120,0 -8,-8" strokeWidth="1.2" opacity=".5" transform="rotate(45) scale(.72)" />
        <circle r="8" fill="#d9a441" />
      </g>
    </svg>
  )
}

export const Emblem = ({ theme }) => (theme === 'luffy' ? <StrawHatEmblem /> : theme === 'blackbeard' ? <JollyRogerEmblem /> : <CompassEmblem />)

/** Large decorative cut-out. Uses /themes/<theme>.png if you add one, otherwise the built-in emblem. */
export function Cutout({ theme }) {
  const [custom, setCustom] = useState(true)
  useEffect(() => setCustom(true), [theme])
  return (
    <div className={`cutout cutout-${theme}`} aria-hidden="true">
      {custom && theme !== 'grandline'
        ? <img src={`/themes/${theme}.png`} alt="" onError={() => setCustom(false)} />
        : <Emblem theme={theme} />}
    </div>
  )
}

/** Full-screen flourish when the mood flips the theme. */
export function Splash({ theme, onDone }) {
  useEffect(() => { const t = setTimeout(onDone, 1700); return () => clearTimeout(t) }, [onDone])
  return (
    <div className={`splash splash-${theme}`} aria-hidden="true">
      <div className="splash-card"><div className="splash-emblem"><Emblem theme={theme} /></div><div className="splash-text">{THEMES[theme].splash}</div></div>
    </div>
  )
}
