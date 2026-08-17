import { useState, useEffect, useRef } from 'react'
import { Send, FileText, X, ImagePlus, Film, Loader2, Plus, MessageCircle, Eye } from 'lucide-react'
import Preview from './Preview.jsx'
import { createPost, STATUS, REPEAT, PLATFORMS } from '../core/types.js'
import { API } from '../core/api.js'
import { useCategories } from '../core/useCategories.js'
import { MediaPicker } from './MediaLibrary.jsx'
import { Library } from 'lucide-react'
import { compressImage } from '../core/imageCompress.js'
import Collapsible from './Collapsible.jsx'
import { Tag, Link2, Repeat } from 'lucide-react'
import { useToast } from '../core/useToast.jsx'
import { useHotkeys } from '../core/useHotkeys.js'
import EmojiPicker from './EmojiPicker.jsx'
import { Smile } from 'lucide-react'
import { localInputToISO, isoToLocalInput } from '../core/tz.js'
import { useSettings } from '../core/useSettings.js'
import { nextOpenSlot } from '../core/slots.js'
import { Zap } from 'lucide-react'

function nowLocalInput() {
  const d = new Date(); d.setSeconds(0, 0)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}
function isoToLocalInput(iso) {
  const d = new Date(iso)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}
const platMax = (p) => PLATFORMS[p]?.maxLen ?? 500

export default function Composer({ editing, onSchedule, onSaveDraft, onUpdate, onCancelEdit }) {
  const [text, setText] = useState('')
  const [variants, setVariants] = useState({})       // platform -> override text
  const [activeTab, setActiveTab] = useState('all')
  const [thread, setThread] = useState([])
  const [firstComment, setFirstComment] = useState('')
  const [panel, setPanel] = useState(null)      // 'thread' | 'category' | 'links' | null
  const togglePanel = (id) => setPanel((p) => (p === id ? null : id))
  const [selected, setSelected] = useState({})
  const [when, setWhen] = useState(isoToLocalInput(new Date().toISOString(), tz))
  const [repeat, setRepeat] = useState(REPEAT.NONE)
  const [media, setMedia] = useState([])
  const [uploading, setUploading] = useState(false)
  const [accounts, setAccounts] = useState([])
  const imgRef = useRef(null)
  const vidRef = useRef(null)
  const isEditing = Boolean(editing)
  const [showPreview, setShowPreview] = useState(false)
  const { categories, createCategory } = useCategories()
  const [category, setCategory] = useState(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [linkMode, setLinkMode] = useState('off')
  const [utmCampaign, setUtmCampaign] = useState('')
  const toast = useToast()
  const { settings } = useSettings()
  const tz = settings?.timezone || 'UTC'

  const [emojiOpen, setEmojiOpen] = useState(false)
  const taRef = useRef(null)

  const insertEmoji = (emoji) => {
    const ta = taRef.current
    if (!ta) { setActiveText(activeText + emoji); return }
    const { selectionStart: s, selectionEnd: e } = ta
    setActiveText(activeText.slice(0, s) + emoji + activeText.slice(e))
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(s + emoji.length, s + emoji.length) })
  }

  useEffect(() => {
    (async () => {
      try {
        const data = await (await fetch(`${API}/accounts`)).json()
        const flat = []
        for (const p of data)
          for (const c of (p.connections || []))
            flat.push({
              id: c.id, handle: c.handle, platform: p.id,
              short: PLATFORMS[p.id]?.short ?? p.id, maxLen: PLATFORMS[p.id]?.maxLen ?? 500
            })
        setAccounts(flat)
      } catch (err) { console.error('Failed to load accounts:', err) }
    })()
  }, [])

  useEffect(() => {
    if (editing) {
      setLinkMode(editing.link_mode || 'off'); setUtmCampaign(editing.utm_campaign || '')
      setCategory(editing.category || null)
      setText(editing.text); setVariants(editing.variants || {}); setThread(editing.thread || [])
      setFirstComment(editing.first_comment || ''); setFcOpen(Boolean(editing.first_comment))
      setSelected(Object.fromEntries(editing.platforms.map((id) => [id, true])))
      setWhen(isoToLocalInput(editing.scheduledAt, tz)); setRepeat(editing.repeat || REPEAT.NONE)
      setActiveTab('all')
        ; (async () => {
          const items = await Promise.all((editing.media || []).map(async (id) => {
            try {
              const m = await (await fetch(`${API}/media/${id}/meta`)).json()
              return { id, url: `${API}/media/${id}`, content_type: m.content_type, alt: m.alt || '' }
            } catch { return { id, url: `${API}/media/${id}`, content_type: '', alt: '' } }
          }))
          setMedia(items)
        })()
    } else {
      setLinkMode('off'); setUtmCampaign('')
      setText(''); setVariants({}); setThread([]); setSelected({}); setWhen(nowLocalInput())
      setRepeat(REPEAT.NONE); setMedia([]); setActiveTab('all')
      setFirstComment(''); setFcOpen(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.id])

  const chosen = accounts.filter((a) => selected[a.id])
  const limit = chosen.length ? Math.min(...chosen.map((a) => a.maxLen)) : null
  const platformsInUse = [...new Set(chosen.map((a) => a.platform))]
  const effTab = activeTab !== 'all' && platformsInUse.includes(activeTab) ? activeTab : 'all'

  const activeText = effTab === 'all' ? text : (variants[effTab] ?? '')
  const activeLimit = effTab === 'all' ? limit : platMax(effTab)
  const setActiveText = (v) => (effTab === 'all' ? setText(v) : setVariants((s) => ({ ...s, [effTab]: v })))

  const variantOver = Object.entries(variants).some(([p, v]) => v.length > platMax(p))
  const threadOver = thread.some((s) => limit != null && s.length > limit)
  const over = (limit != null && text.length > limit) || variantOver || threadOver
  const hasContent = text.trim().length > 0
  const canSchedule = hasContent && chosen.length > 0 && !over && !uploading
  const canDraft = hasContent && !over && !uploading

  const hasVideo = media.some((m) => (m.content_type || '').startsWith('video/'))
  const imageCount = media.filter((m) => (m.content_type || '').startsWith('image/')).length
  const canAddImage = !hasVideo && imageCount < 4 && !uploading
  const canAddVideo = media.length === 0 && !uploading

  const toggle = (id) => setSelected((s) => ({ ...s, [id]: !s[id] }))
  const addSeg = () => setThread((t) => [...t, ''])
  const setSeg = (i, v) => setThread((t) => t.map((s, idx) => (idx === i ? v : s)))
  const delSeg = (i) => setThread((t) => t.filter((_, idx) => idx !== i))
  const reset = () => {
    setCategory(null)
    setText(''); setVariants({}); setThread([]); setSelected({}); setWhen(nowLocalInput())
    setRepeat(REPEAT.NONE); setMedia([]); setActiveTab('all')
    setFirstComment(''); setFcOpen(false)
    setLinkMode('off'); setUtmCampaign('')
  }

  const onFiles = async (e) => {
    const files = Array.from(e.target.files || []); e.target.value = ''
    if (!files.length) return
    setUploading(true)
    try {
      for (const file of files) {
        const prepared = await compressImage(file)
        const fd = new FormData(); fd.append('file', prepared)
        const res = await fetch(`${API}/media`, { method: 'POST', body: fd })
        if (!res.ok) throw new Error('upload failed')
        const m = await res.json()
        setMedia((prev) => [...prev, { id: m.id, url: `${API}${m.url}`, content_type: m.content_type || file.type, alt: '' }])
      }
    } catch (err) {
      console.error('Media upload failed:', err)
      toast('Upload failed — ' + err.message, 'err')
    } finally { setUploading(false) }
  }
  const removeMedia = (id) => setMedia((prev) => prev.filter((m) => m.id !== id))
  const setAlt = (id, alt) => setMedia((prev) => prev.map((m) => (m.id === id ? { ...m, alt } : m)))
  const saveAlt = (m) => fetch(`${API}/media/${m.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ alt: m.alt }),
  }).catch(() => { })

  const payload = () => ({
    text: text.trim(), platforms: chosen.map((a) => a.id),
    scheduledAt: localInputToISO(when, tz), repeat,
    media: media.map((m) => m.id), thread: thread.map((s) => s.trim()).filter(Boolean),
    variants: Object.fromEntries(Object.entries(variants).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v)),
    first_comment: firstComment.trim(),
    link_mode: linkMode, utm_campaign: utmCampaign
  })
  const schedule = () => {
    if (!canSchedule) return
    if (isEditing) onUpdate(editing.id, { ...payload(), status: STATUS.SCHEDULED })
    else {
      onSchedule(createPost({ ...payload(), status: STATUS.SCHEDULED }));
      toast('Post scheduled')
      reset()
    }
  }
  const saveDraft = () => {
    if (!canDraft) return
    if (isEditing) onUpdate(editing.id, { ...payload(), status: STATUS.DRAFT })
    else {
      onSaveDraft(createPost({ ...payload(), status: STATUS.DRAFT }));
      toast('Draft saved')
      reset()
    }
  }
  useHotkeys({ 'mod+enter': () => schedule() })

  const videoToBluesky = hasVideo && chosen.some((a) => a.platform === 'bluesky')
  const threadToFlat = thread.length > 0 && chosen.some((a) => a.platform === 'linkedin' || a.platform === 'threads')


  const previews = platformsInUse.map((p) => {
    const acct = chosen.find((a) => a.platform === p)
    const supports = p === 'bluesky' || p === 'mastodon'
    const t = (variants[p] || '').trim() || text
    return {
      platform: p, short: PLATFORMS[p]?.short ?? p, label: PLATFORMS[p]?.label ?? p,
      handle: acct?.handle ?? p, text: t, media,
      thread: supports ? thread.filter((s) => s.trim()) : [],
      firstComment: supports ? firstComment.trim() : '',
      charLimit: platMax(p), over: t.length > platMax(p),
    }
  })


  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <div className="mb-4 flex items-center justify-between">
        <p className="font-mono text-xs tracking-wider text-muted">{isEditing ? 'EDIT POST' : 'COMPOSER'}</p>
        <div className="flex items-center gap-3">
          {chosen.length > 0 && hasContent && (
            <button onClick={() => setShowPreview((v) => !v)}
              className={`inline-flex items-center gap-1 font-mono text-[11px] transition hover:text-coral ${showPreview ? 'text-coral' : 'text-muted'}`}>
              <Eye size={12} strokeWidth={2} /> PREVIEW
            </button>
          )}
          {isEditing && (
            <button onClick={onCancelEdit} className="inline-flex items-center gap-1 font-mono text-[11px] text-muted transition hover:text-fg">
              <X size={12} strokeWidth={2} /> CANCEL
            </button>
          )}
        </div>
      </div>

      {chosen.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1">
          <button onClick={() => setActiveTab('all')}
            className={`rounded-md px-2.5 py-1 font-mono text-[11px] transition ${effTab === 'all' ? 'bg-coral/12 text-coral' : 'text-muted hover:text-fg'}`}>
            ALL
          </button>
          {platformsInUse.map((p) => (
            <button key={p} onClick={() => setActiveTab(p)}
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-mono text-[11px] transition ${effTab === p ? 'bg-coral/12 text-coral' : 'text-muted hover:text-fg'}`}>
              {PLATFORMS[p]?.short ?? p}
              {(variants[p] || '').trim() && <span className="h-1.5 w-1.5 rounded-full bg-coral" />}
            </button>
          ))}
        </div>
      )}

      <div className="relative">
        <textarea ref={taRef} value={activeText} onChange={(e) => setActiveText(e.target.value)}
          placeholder={effTab === 'all' ? 'Type your caption…' : `Override for ${PLATFORMS[effTab]?.label ?? effTab} — blank uses the base caption`}
          rows={5}
          className="w-full resize-none rounded-lg border border-line bg-elevated px-3 py-2 pb-8 text-sm text-fg placeholder:text-muted outline-none transition focus:border-coral" />
        <button onClick={() => setEmojiOpen((v) => !v)}
          className={`absolute bottom-2 right-2 grid h-6 w-6 place-items-center rounded transition ${emojiOpen ? 'text-coral' : 'text-muted hover:text-fg'}`}>
          <Smile size={15} strokeWidth={1.75} />
        </button>
        {emojiOpen && <EmojiPicker onPick={insertEmoji} onClose={() => setEmojiOpen(false)} />}
      </div>
 
      {media.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          {media.map((m) => (
            <div key={m.id} className="flex items-start gap-3 rounded-lg border border-line bg-elevated p-2">
              <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md border border-line">
                {(m.content_type || '').startsWith('video/')
                  ? <video src={m.url} className="h-full w-full object-cover" muted />
                  : <img src={m.url} alt="" className="h-full w-full object-cover" />}
              </div>
              <input value={m.alt} onChange={(e) => setAlt(m.id, e.target.value)} onBlur={() => saveAlt(m)}
                placeholder="Alt text (accessibility)…"
                className="mt-1 flex-1 rounded-md border border-line bg-ink px-2 py-1.5 text-xs text-fg placeholder:text-muted outline-none transition focus:border-coral" />
              <button onClick={() => removeMedia(m.id)} className="mt-1 grid h-6 w-6 place-items-center rounded text-muted transition hover:text-red-400">
                <X size={13} strokeWidth={2} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* --- account picker: primary, stays visible --- */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {accounts.length === 0 && <span className="font-mono text-[11px] text-muted">No accounts connected — see Accounts.</span>}
        {accounts.map((a) => (
          <button key={a.id} onClick={() => toggle(a.id)}
            className={`rounded-lg border px-2.5 py-1 font-mono text-xs transition ${selected[a.id] ? 'border-coral bg-coral/12 text-coral' : 'border-line text-muted hover:border-coral/40 hover:text-fg'}`}>
            {a.short}·{a.handle.replace(/^@/, '').split('.')[0].slice(0, 10)}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => imgRef.current?.click()} disabled={!canAddImage}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 font-mono text-xs text-muted transition enabled:hover:border-coral/40 enabled:hover:text-fg disabled:opacity-40">
            {uploading ? <Loader2 size={14} strokeWidth={1.75} className="animate-spin" /> : <ImagePlus size={14} strokeWidth={1.75} />} IMAGE
          </button>
          <button onClick={() => vidRef.current?.click()} disabled={!canAddVideo}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 font-mono text-xs text-muted transition enabled:hover:border-coral/40 enabled:hover:text-fg disabled:opacity-40">
            <Film size={14} strokeWidth={1.75} /> VIDEO
          </button>
          <button onClick={() => setPickerOpen(true)} disabled={hasVideo || uploading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 font-mono text-xs text-muted transition enabled:hover:border-coral/40 enabled:hover:text-fg disabled:opacity-40">
            <Library size={14} strokeWidth={1.75} /> LIBRARY
          </button>
        </div>
        <input ref={imgRef} type="file" accept="image/*" multiple onChange={onFiles} className="hidden" />
        <input ref={vidRef} type="file" accept="video/*" onChange={onFiles} className="hidden" />
      </div>

      {/* --- collapsible configuration --- */}
      <div className="mt-4 flex flex-col gap-2">
        <Collapsible icon={MessageCircle} label="THREAD & FIRST COMMENT"
          active={thread.length > 0 || Boolean(firstComment)}
          open={panel === 'thread'} onToggle={() => togglePanel('thread')}>
          {thread.map((seg, i) => (
            <div key={i} className="relative mb-2">
              <textarea value={seg} onChange={(e) => setSeg(i, e.target.value)}
                placeholder={`Thread part ${i + 2}…`} rows={2}
                className="w-full resize-none rounded-lg border border-line bg-elevated px-3 py-2 pr-8 text-sm text-fg placeholder:text-muted outline-none transition focus:border-coral" />
              <button onClick={() => delSeg(i)} className="absolute right-2 top-2 grid h-5 w-5 place-items-center rounded text-muted transition hover:text-red-400">
                <X size={12} strokeWidth={2} />
              </button>
            </div>
          ))}
          <button onClick={addSeg} className="inline-flex items-center gap-1.5 font-mono text-[11px] text-muted transition hover:text-coral">
            <Plus size={12} strokeWidth={2} /> ADD PART
          </button>
          <textarea value={firstComment} onChange={(e) => setFirstComment(e.target.value)}
            placeholder="First comment (hashtags, links)… — Bluesky &amp; Mastodon" rows={2}
            className="mt-3 w-full resize-none rounded-lg border border-line bg-elevated px-3 py-2 text-sm text-fg placeholder:text-muted outline-none transition focus:border-coral" />
        </Collapsible>

        <Collapsible icon={Tag} label="CATEGORY" active={Boolean(category)}
          open={panel === 'category'} onToggle={() => togglePanel('category')}>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => setCategory(null)}
              className={`rounded-full border px-2 py-0.5 font-mono text-[11px] transition ${!category ? 'border-line bg-elevated text-fg' : 'border-line text-muted hover:text-fg'}`}>
              None
            </button>
            {categories.map((c) => (
              <button key={c.id} onClick={() => setCategory(c.id)}
                className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[11px] transition"
                style={{ borderColor: category === c.id ? c.color : 'var(--color-line)', color: category === c.id ? c.color : 'var(--color-muted)' }}>
                <span className="h-2 w-2 rounded-full" style={{ background: c.color }} /> {c.name}
              </button>
            ))}
            <button onClick={async () => { const n = prompt('New category name'); if (n?.trim()) { const c = await createCategory(n.trim()); if (c) setCategory(c.id) } }}
              className="rounded-full border border-line px-2 py-0.5 font-mono text-[11px] text-muted transition hover:border-coral/40 hover:text-fg">
              + New
            </button>
          </div>
        </Collapsible>

        <Collapsible icon={Link2} label="LINK TRACKING" active={linkMode !== 'off'}
          open={panel === 'links'} onToggle={() => togglePanel('links')}>
          <div className="flex flex-wrap items-center gap-2">
            {[['off', 'Off'], ['utm', 'UTM tags'], ['tracked', 'Track clicks']].map(([id, label]) => (
              <button key={id} onClick={() => setLinkMode(id)}
                className={`rounded-full border px-2 py-0.5 font-mono text-[11px] transition ${linkMode === id ? 'border-coral bg-coral/12 text-coral' : 'border-line text-muted hover:text-fg'}`}>
                {label}
              </button>
            ))}
            {linkMode !== 'off' && (
              <input value={utmCampaign} onChange={(e) => setUtmCampaign(e.target.value)} placeholder="campaign (optional)"
                className="rounded-lg border border-line bg-elevated px-2 py-1 font-mono text-[11px] text-fg placeholder:text-muted outline-none transition focus:border-coral" />
            )}
          </div>
        </Collapsible>
      </div>

      {/* --- warnings --- */}
      {effTab !== 'all' && (
        <p className="mt-3 font-mono text-[11px] text-muted">Editing {PLATFORMS[effTab]?.label} only. Thread &amp; media are shared.</p>
      )}
      {videoToBluesky && (
        <p className="mt-2 font-mono text-[11px] text-muted">Bluesky video needs a verified-email account and has daily limits.</p>
      )}
      {threadToFlat && (
        <p className="mt-2 font-mono text-[11px] text-muted">Threads/LinkedIn post only the first part; Bluesky &amp; Mastodon post the full chain.</p>
      )}


      <div className="mt-4 flex items-center gap-3">
        <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)}
        
          className="rounded-lg border border-line bg-elevated px-3 py-2 font-mono text-xs text-fg outline-none transition focus:border-coral [color-scheme:dark]" />
        <select value={repeat} onChange={(e) => setRepeat(e.target.value)}
          className="rounded-lg border border-line bg-elevated px-2 py-2 font-mono text-xs text-fg outline-none transition focus:border-coral [color-scheme:dark]">
            <span className="font-mono text-[10px] text-muted">{tz}</span>
        {(settings?.slots?.length > 0) && (
          <button onClick={() => {
            const iso = nextOpenSlot(settings.slots, tz, [])
            if (iso) { setWhen(isoToLocalInput(iso, tz)); toast('Dropped into next open slot') }
            else toast('No open slot found', 'err')
          }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-2 font-mono text-xs text-muted transition hover:border-coral/40 hover:text-coral">
            <Zap size={13} strokeWidth={1.75} /> NEXT SLOT
          </button>
        )}
          <option value="none">Once</option><option value="daily">Daily</option>
          <option value="weekly">Weekly</option><option value="monthly">Monthly</option>
        </select>
        <span className={`ml-auto font-mono text-xs ${(activeLimit != null && activeText.length > activeLimit) ? 'text-red-400' : 'text-muted'}`}>
          {activeText.length}{activeLimit != null ? ` / ${activeLimit}` : ''}
        </span>
      </div>

      <div className="mt-4 flex gap-2">
        <button onClick={saveDraft} disabled={!canDraft}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-line px-4 py-2 text-sm text-muted transition enabled:hover:border-coral/40 enabled:hover:text-fg disabled:cursor-not-allowed disabled:opacity-40">
          <FileText size={16} strokeWidth={1.75} /> Save draft
        </button>
        <button onClick={schedule} disabled={!canSchedule}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-coral px-4 py-2 text-sm font-medium text-white transition duration-100 enabled:hover:-translate-y-1 disabled:cursor-not-allowed disabled:opacity-40">
          <Send size={16} strokeWidth={2} /> {isEditing ? 'Update' : 'Schedule post'}
        </button>
      </div>
      {showPreview && chosen.length > 0 && <Preview renders={previews} />}
      {pickerOpen && (
        <MediaPicker
          onClose={() => setPickerOpen(false)}
          disabledIds={media.map((m) => m.id)}
          onPick={(picked) => {
            setMedia((prev) => {
              const existing = new Set(prev.map((m) => m.id))
              let next = [...prev]
              for (const m of picked) {
                if (existing.has(m.id)) continue
                const isVid = (m.content_type || '').startsWith('video/')
                const hasVid = next.some((x) => (x.content_type || '').startsWith('video/'))
                if (isVid && next.length > 0) continue          // video must be solo
                if (!isVid && (hasVid || next.filter((x) => !(x.content_type || '').startsWith('video/')).length >= 4)) continue
                next.push({ id: m.id, url: `${API}/media/${m.id}`, content_type: m.content_type, alt: m.alt || '' })
                if (isVid) break
              }
              return next
            })
          }}
        />
      )}
    </section>
  )
}