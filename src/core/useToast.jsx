import { createContext, useContext, useState, useCallback } from 'react'
import { CheckCircle2, AlertCircle, X } from 'lucide-react'

const Ctx = createContext(() => {})
export const useToast = () => useContext(Ctx)

export function ToastProvider({ children }) {
  const [items, setItems] = useState([])
  const push = useCallback((message, kind = 'ok') => {
    const id = Math.random().toString(36).slice(2)
    setItems((s) => [...s, { id, message, kind }])
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), 4000)
  }, [])
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {items.map((t) => (
          <div key={t.id}
            className={`pointer-events-auto flex items-center gap-2 rounded-lg border px-3 py-2 text-sm shadow-lg backdrop-blur
              ${t.kind === 'err' ? 'border-red-500/40 bg-red-500/10 text-red-300' : 'border-coral/40 bg-surface text-fg'}`}>
            {t.kind === 'err' ? <AlertCircle size={15} strokeWidth={1.75} /> : <CheckCircle2 size={15} strokeWidth={1.75} className="text-coral" />}
            <span className="max-w-xs">{t.message}</span>
            <button onClick={() => setItems((s) => s.filter((x) => x.id !== t.id))} className="ml-1 text-muted hover:text-fg">
              <X size={13} strokeWidth={2} />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}