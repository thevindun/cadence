import StatusPill from './StatusPill.jsx'
import { STATUS, PLATFORMS } from '../core/types.js'
import { Pencil, Trash2, Repeat, Image as ImageIcon, MessageSquare } from 'lucide-react'
import { useCategories } from '../core/useCategories.js'

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

export default function Queue({ posts, onEdit, onDelete }) {
  const { categories } = useCategories()
  const catOf = (id) => categories.find((c) => c.id === id)
  
  const sorted = [...posts].sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt))

  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <p className="mb-4 font-mono text-xs tracking-wider text-muted">
        QUEUE · {posts.length} {posts.length === 1 ? 'POST' : 'POSTS'}
      </p>

      {sorted.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">Nothing queued yet. Compose your first post.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {sorted.map((post) => (
            <li key={post.id}
              className="group flex items-center gap-3 rounded-lg border border-line bg-elevated px-3 py-2.5">
              {post.category && catOf(post.category) && (
                <span title={catOf(post.category).name} className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: catOf(post.category).color }} />
              )}
              <span className="w-24 shrink-0 font-mono text-xs text-muted">{fmtTime(post.scheduledAt)}</span>
              <span className="flex-1 truncate text-sm text-fg">{post.text}</span>
              <span className="flex shrink-0 gap-1">
                {post.platforms.map((id) => (
                  <span key={id} className="rounded bg-ink px-1.5 py-0.5 font-mono text-[10px] text-muted">
                    {short(id)}
                  </span>
                ))}
              </span>
              {post.media?.length > 0 && (
                <span title={`${post.media.length} image(s)`} className="flex shrink-0 items-center gap-0.5 font-mono text-[10px] text-muted">
                  <ImageIcon size={12} strokeWidth={1.75} /> {post.media.length}
                </span>
              )}
              {post.thread?.length > 0 && (
                <span title={`Thread of ${post.thread.length + 1}`} className="flex shrink-0 items-center gap-0.5 font-mono text-[10px] text-muted">
                  <MessageSquare size={12} strokeWidth={1.75} /> {post.thread.length + 1}
                </span>
              )}

              {post.repeat && post.repeat !== 'none' && (
                <span title={`Repeats ${post.repeat}`} className="shrink-0 text-muted">
                  <Repeat size={13} strokeWidth={1.75} />
                </span>
              )}
              <StatusPill status={post.status} />
              <span className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
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