import { API } from './api.js'

let token = localStorage.getItem('cadence-token') || null

export const getToken = () => token
export function setToken(t) {
  token = t
  if (t) localStorage.setItem('cadence-token', t)
  else localStorage.removeItem('cadence-token')
}

function isApiUrl(url) {
  try {
    if (API) return url.startsWith(API)
    const u = new URL(url, window.location.origin)
        return u.origin === window.location.origin &&
      /^\/(posts|media|accounts|categories|metrics|links|auth|users|notifications|inbox|settings|ai|hashtags|templates)/.test(u.pathname)
  } catch { return false }
}

export function installAuthFetch() {
  const orig = window.fetch.bind(window)
  window.fetch = (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url
    if (token && isApiUrl(url)) {
      init = { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } }
    }
    return orig(input, init)
  }
}

export async function authStatus() {
  try { return await (await fetch(`${API}/auth/status`)).json() }
  catch { return { enabled: false, has_users: false } }
}

export async function login(email, password) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || 'Login failed')
  const data = await res.json(); setToken(data.token); return data.user
}

export async function register(email, password) {
  const res = await fetch(`${API}/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || 'Registration failed')
  return login(email, password)
}

export async function logout() {
  try { await fetch(`${API}/auth/logout`, { method: 'POST' }) } catch {}
  setToken(null)
}