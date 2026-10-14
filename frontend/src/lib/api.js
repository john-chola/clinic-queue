// Small fetch wrapper: JSON in and out, the staff token when there is one,
// and errors carrying the server's message.
import { getToken, clearStaff } from './staffAuth'

const BASE = import.meta.env.VITE_API_URL || '/api'

export async function api(path, { method = 'GET', body, auth = false } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (auth && token) headers.Authorization = `Bearer ${token}`
  let res
  try {
    res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
  } catch {
    throw new Error('No connection to the server. Check your internet and try again.')
  }
  const data = await res.json().catch(() => ({}))
  if (res.status === 401 && auth) clearStaff()
  if (!res.ok) throw new Error(data.message || `Request failed (${res.status})`)
  return data
}
