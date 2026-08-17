import { useState, useEffect, useCallback } from 'react'
import { API } from './api.js'
import { browserTz } from './tz.js'

export function useSettings() {
  const [settings, setSettings] = useState(null)
  useEffect(() => {
    (async () => {
      try {
        const s = await (await fetch(`${API}/settings`)).json()
        if (!s.timezone || s.timezone === 'UTC') s.timezone = browserTz()
        setSettings(s)
      } catch { setSettings({ timezone: browserTz(), slots: [], paused: false }) }
    })()
  }, [])

  const save = useCallback(async (patch) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    try {
      await fetch(`${API}/settings`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
    } catch (e) { console.error('settings save failed', e) }
    return next
  }, [settings])

  return { settings, save }
}