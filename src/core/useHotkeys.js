import { useEffect } from 'react'

const isTyping = (el) =>
  el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)

export function useHotkeys(map) {
  useEffect(() => {
    const onKey = (e) => {
      const mod = e.metaKey || e.ctrlKey
      const key = `${mod ? 'mod+' : ''}${e.key.toLowerCase()}`
      const fn = map[key]
      if (!fn) return
      if (!mod && isTyping(e.target)) return      // don't hijack plain keys while typing
      e.preventDefault()
      fn(e)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [map])
}