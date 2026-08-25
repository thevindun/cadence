import { useState } from 'react'
import StatusPill from './StatusPill.jsx'
import { STATUS, PLATFORMS } from '../core/types.js'
import {
  Pencil, Trash2, Repeat, Image as ImageIcon, MessageSquare, ListChecks,
  Recycle, Search, CheckSquare, Square, Copy,
} from 'lucide-react'
import { useCategories } from '../core/useCategories.js'
import EmptyState from './EmptyState.jsx'
import { API } from '../core/api.js'

const EDITABLE = new Set([STATUS.DRAFT, STATUS.SCHEDULED, STATUS.FAILED])

function fmtTime(iso) {
  const d = new Date(iso)
  const day = d.toLocaleDateString(undefined, { weekday: 'short' })
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
  return `${day} ${time}`
}

const short = (t) => {
  const platform = t.includes(':') ? t.split(':')[0] : t
  return PLATFORMS[platform]?.short ?? platform
}

export default function Queue({ posts, onEdit, onDelete, onUpdate, loading }) {
  const { categories } = useCategories()
  const catOf = (id) => categories.find((c) => c.id === id)

  const [q, setQ] = useState('')
  const [status, setStatus] = useState('all')
  const [sel, setSel] = useState({})

  const sorted = [...posts].sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt))

  const filtered = sorted.filter((p) => {
    if (status !== 'all' && p.status !== status) return false
    if (!q.trim()) return true
    const hay = (p.text + ' ' + (p.thread || []).join(' ')).toLowerCase()
    return hay.includes(q.trim().toLowerCase())
  })

  const selIds = Object.keys(sel).filter((k) => sel[k])
  const allSelected = filtered.length > 0 && filtered.every((p) => sel[p.id])
  const toggleAll = () => setSel(allSelected ? {} : Object.fromEntries(filtered.map((p) => [p.id, true])))

  const bulkDelete = async () => {
    if (!confirm(`Delete ${selIds.length} post(s)?`)) return
    for (const id of selIds) await onDelete(id)
    setSel({})
  }
  const bulkDuplicate = async () => {
    for (const id of selIds) await fetch(`${API}/posts/${id}/duplicate`, { method: 'POST' })
    setSel({})
  }

  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <p className="mb-4 flex items-center gap-2 font-mono text-xs tracking-wider text-muted">
        <button onClick={toggleAll} className="transition hover:text-fg">
          {allSelected ? <CheckSquare size={13} strokeWidth={1.75} /> : <Square size={13} strokeWidth={1.75} />}
        </button>
        QUEUE · {filtered.length} {filtered.length === 1 ? 'POST' : 'POSTS'}
        {filtered.length !== posts.length && <span className="text-muted/50">of {posts.length}</span>}
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
          <Search size={13} strokeWidth={1.75} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search posts…"
            className="w-full rounded-lg border border-line bg-elevated py-1.5 pl-8 pr-3 text-sm text-fg placeholder:text-muted outline-none transition focus:border-coral" />
        </div>
        <div className="inline-flex rounded-lg border border-line p-0.5">
          {['all', 'draft', 'scheduled', 'published', 'failed'].map((s) => (
            <button key={s} onClick={() => setStatus(s)}
              className={`rounded-md px-2 py-1 font-mono text-[10px] uppercase transition ${status === s ? 'bg-coral text-white' : 'text-muted hover:text-fg'}`}>
              {s}
            </button>
          ))}
        </div>
      </div>

      {selIds.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-coral/40 bg-coral/5 px-3 py-2">
          <span className="font-mono text-[11px] text-coral">{selIds.length} selected</span>
          <button onClick={bulkDuplicate} className="ml-auto inline-flex items-center gap-1.5 font-mono text-[11px] text-muted transition hover:text-fg">
            <Copy size={12} strokeWidth={1.75} /> DUPLICATE
          </button>
          <button onClick={bulkDelete} className="inline-flex items-center gap-1.5 font-mono text-[11px] text-muted transition hover:text-red-400">
            <Trash2 size={12} strokeWidth={1.75} /> DELETE
          </button>
          <button onClick={() => setSel({})} className="font-mono text-[11px] text-muted transition hover:text-fg">CLEAR</button>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-11 w-full animate-pulse rounded-lg border border-line bg-elevated" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title={posts.length === 0 ? 'Nothing queued yet' : 'No posts match'}
          body={posts.length === 0
            ? "Write a post on the left, pick an account, choose a time, and it'll publish."
            : 'Try a different search term or status filter.'}
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {filtered.map((post) => (
            <li key={post.id}
              className="group flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line bg-elevated px-3 py-2.5">
              <button onClick={() => setSel((s) => ({ ...s, [post.id]: !s[post.id] }))}
                className={`shrink-0 transition ${sel[post.id] ? 'text-coral' : 'text-muted/30 hover:text-muted'}`}>
                {sel[post.id] ? <CheckSquare size={14} strokeWidth={1.75} /> : <Square size={14} strokeWidth={1.75} />}
              </button>
              {post.category && catOf(post.category) && (
                <span title={catOf(post.category).name} className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: catOf(post.category).color }} />
              )}
              <span className="order-1 w-24 shrink-0 font-mono text-xs text-muted">{fmtTime(post.scheduledAt)}</span>
              <span className="flex-1 truncate text-sm text-fg">{post.text}</span>
              <span className="flex shrink-0 gap-1">
                {post.platforms.map((id) => (
                  <span key={id} className="rounded bg-ink px-1.5 py-0.5 font-mono text-[10px] text-muted">
                    {short(id)}
                  </span>
                ))}
              </span>
              {post.media?.length > 0 && (
                <span title={`${post.media.length} image(s)`} className="hidden shrink-0 items-center gap-0.5 font-mono text-[10px] text-muted sm:flex">
                  <ImageIcon size={12} strokeWidth={1.75} /> {post.media.length}
                </span>
              )}
              {post.thread?.length > 0 && (
                <span title={`Thread of ${post.thread.length + 1}`} className="hidden shrink-0 items-center gap-0.5 font-mono text-[10px] text-muted sm:flex">
                  <MessageSquare size={12} strokeWidth={1.75} /> {post.thread.length + 1}
                </span>
              )}
              {post.repeat && post.repeat !== 'none' && (
                <span title={`Repeats ${post.repeat}`} className="shrink-0 text-muted">
                  <Repeat size={13} strokeWidth={1.75} />
                </span>
              )}
              {post.status === 'published' && onUpdate && (
                <button onClick={() => onUpdate(post.id, { evergreen: !post.evergreen })}
                  title={post.evergreen ? 'Evergreen — will recycle' : 'Mark as evergreen'}
                  className={`shrink-0 transition ${post.evergreen ? 'text-coral' : 'text-muted/40 hover:text-muted'}`}>
                  <Recycle size={13} strokeWidth={1.75} />
                </button>
              )}
              <StatusPill status={post.status} />
              <span className="ml-auto flex items-center gap-1 opacity-100 transition md:opacity-0 md:group-hover:opacity-100">
                {EDITABLE.has(post.status) && (
                  <button onClick={() => onEdit(post.id)} title="Edit"
                    className="grid h-7 w-7 place-items-center rounded-md text-muted transition hover:bg-ink hover:text-fg">
                    <Pencil size={14} strokeWidth={1.75} />
                  </button>
                )}
                <button onClick={() => onDelete(post.id)} title="Delete"
                  className="grid h-7 w-7 place-items-center rounded-md text-muted transition hover:bg-ink hover:text-red-400">
                  <Trash2 size={14} strokeWidth={1.75} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}