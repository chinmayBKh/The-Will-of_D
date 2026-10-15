export const THEMES = {
  grandline: { id: 'grandline', label: 'Grand Line', icon: '🧭', splash: 'Calm seas ahead' },
  luffy: { id: 'luffy', label: 'Luffy', icon: '☀️', splash: 'Good winds — set sail!' },
  blackbeard: { id: 'blackbeard', label: 'Blackbeard', icon: '☠️', splash: 'The waters turn dark…' },
}
export const MODES = [
  { id: 'auto', label: 'Auto', icon: '✦', hint: 'Follows the mood of the conversation' },
  { id: 'grandline', label: THEMES.grandline.label, icon: THEMES.grandline.icon, hint: 'Always Grand Line' },
  { id: 'luffy', label: THEMES.luffy.label, icon: THEMES.luffy.icon, hint: 'Always Luffy' },
  { id: 'blackbeard', label: THEMES.blackbeard.label, icon: THEMES.blackbeard.icon, hint: 'Always Blackbeard' },
]
export const DEFAULT_SETTINGS = {
  maxContextBudget: 8192, maxOutputTokens: 1024, temperature: 0.9,
  userName: 'Navigator', sceneDirector: true, aiMood: false,
}
