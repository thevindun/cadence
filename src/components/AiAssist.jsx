import { useState, useEffect } from 'react'
import { Sparkles, Loader2, X } from 'lucide-react'
import { API } from '../core/api.js'

const TONES = ['', 'casual', 'professional', 'playful', 'punchy', 'thoughtful']

export default function AiAssist({ platform, maxLen, onPick, onClose }) {
  const [prompt, setPrompt] = useState('')
  const [tone, setTone] = useState('')
  const [matchVoice, setMatchVoice] = useState(true)
  const [options, setOptions] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const run = async () => {
    if (!prompt.trim()) return
    setBusy(true); setError(''); setOptions([])
    try {
      const res = await fetch(`${API}/ai/captions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, platform, max_len: maxLen, tone, match_voice: matchVoice, count: 3 }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'failed')
      setOptions(data.options || [])
    } catch (e) { setError(String(e.message || e)) } finally { setBusy(false) }
  }

  return (
    <div onClick={onClose} className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm">
      <div onClick={(e) => e.stopPropagation()} className="flex w-full max-w-lg flex-col gap-3 rounded-xl border border-line bg-surface p-5">
        <div className="flex items-center justify-between">
          <p className="inline-flex items-center gap-2 font-mono text-xs tracking-wider text-muted">
            <Sparkles size={13} strokeWidth={1.75} className="text-coral" /> CAPTION IDEAS
          </p>
          <button onClick={onClose} className="text-muted transition hover:text-fg"><X size={15} strokeWidth={2} /></button>
        </div>

        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2}
          placeholder="What's the post about? e.g. launching our new scheduling app"
          className="w-full resize-none rounded-lg border border-line bg-elevated px-3 py-2 text-sm text-fg placeholder:text-muted outline-none transition focus:border-coral" />

        <div className="flex flex-wrap items-center gap-2">
          {TONES.map((t) => (
            <button key={t || 'default'} onClick={() => setTone(t)}
              className={`rounded-full border px-2 py-0.5 font-mono text-[11px] transition ${tone === t ? 'border-coral bg-coral/12 text-coral' : 'border-line text-muted hover:text-fg'}`}>
              {t || 'default'}
            </button>
          ))}
          <label className="ml-auto inline-flex cursor-pointer items-center gap-1.5 font-mono text-[11px] text-muted">
            <input type="checkbox" checked={matchVoice} onChange={(e) => setMatchVoice(e.target.checked)} className="accent-coral" />
            match my voice
          </label>
        </div>

        <button onClick={run} disabled={busy || !prompt.trim()}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-coral px-4 py-2 text-sm font-medium text-white transition enabled:hover:-translate-y-0.5 disabled:opacity-40">
          {busy ? <Loader2 size={15} strokeWidth={2} className="animate-spin" /> : <Sparkles size={15} strokeWidth={2} />}
          {busy ? 'Writing…' : 'Generate'}
        </button>

        {error && <p className="font-mono text-[11px] text-red-400">{error}</p>}

        {options.length > 0 && (
          <div className="flex flex-col gap-2">
            {options.map((o, i) => (
              <button key={i} onClick={() => { onPick(o); onClose() }}
                className="rounded-lg border border-line bg-elevated p-3 text-left text-sm text-fg transition hover:border-coral/50">
                {o}
                <span className="mt-1 block font-mono text-[10px] text-muted">{o.length} chars</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}