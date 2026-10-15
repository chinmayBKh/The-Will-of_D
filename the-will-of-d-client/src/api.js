export class ApiError extends Error {
  constructor(message, extra = {}) { super(message); Object.assign(this, extra) }
}

/** fetch wrapper that keeps the server's REAL error message (the old client replaced everything with "Connection fault"). */
export async function api(path, { method = 'GET', body } = {}) {
  let res
  try {
    res = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError('Cannot reach the backend. Is it running? (npm start)')
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(data.error || res.statusText, { status: res.status, hint: data.hint, history: data.history })
  return data
}

/** Old characters stored absolute http://localhost:5000/uploads/… URLs; make them work from any origin. */
export const asset = (u) => (u ? u.replace(/^https?:\/\/(localhost|127\.0\.0\.1):\d+/, '') : '')

export async function uploadImage(file) {
  const fd = new FormData()
  fd.append('image', file)
  const res = await fetch('/api/upload', { method: 'POST', body: fd })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(data.error || 'Upload failed.')
  return data.url
}
