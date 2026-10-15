import { useEffect, useState } from 'react'

/** useState that persists to localStorage (safe if storage is blocked or the value is corrupt). */
export function useLocal(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key)
      if (raw === null) return initial
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) && initial && typeof initial === 'object' ? { ...initial, ...parsed } : parsed
    } catch { return initial }
  })
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* ignore */ } }, [key, value])
  return [value, setValue]
}
