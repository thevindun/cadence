import { useMemo } from 'react'
import { useParams, NavLink } from 'react-router-dom'
import { ArrowLeft, Heart, Repeat2, MessageCircle, Eye } from 'lucide-react'
import { STATUS, PLATFORMS } from '../core/types.js'
import TrendChart from './TrendChart.jsx'

const platformOf = (t) => (t.includes(':') ? t.split(':')[0] : t)

export default function PlatformDetail({ posts }) {
  const { platform } = useParams()

  const rows = useMemo(() => posts
    .filter((p) => p.status === STATUS.PUBLISHED)
    .flatMap((p) => Object.entries(p.metrics || {})
      .filter(([t]) => platformOf(t) === platform)
      .map(([t, m]) => ({ post: p, target: t, m })))
    .sort((a, b) => new Date(b.post.scheduledAt) - new Date(a.post.scheduledAt)),
  [posts, platform])

  const totals = useMemo(() => rows.reduce((acc, { m }) => ({
    likes: acc.likes + (m.likes || 0),
    reposts: acc.reposts + (m.reposts || 0),
    replies: acc.replies + (m.replies || 0),
    impressions: acc.impressions + (m.impressions || 0),
    posts: acc.posts + 1,
  }), { likes: 0, reposts: 0, replies: 0, impressions: 0, posts: 0 }), [rows])

  const eng = totals.likes + totals.reposts + totals.replies
  const rate = totals.impressions ? ((eng / totals.impressions) * 100).toFixed(2) + '%' : '—'
  const avg = totals.posts ? Math.round(eng / totals.posts) : 0

  const series = useMemo(() => [...rows].reverse().map(({ post, m }) => ({
    label: new Date(post.scheduledAt).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' }),
    value: (m.likes || 0) + (m.reposts || 0) + (m.replies || 0),
  })), [rows])

  const cards = [
    { label: 'posts', value: totals.posts },
    { label: 'engagement', value: eng, big: true },
    { label: 'avg / post', value: avg },
    { label: 'impressions', value: totals.impressions || '—' },
    { label: 'eng. rate', value: rate },
  ]

  return (
    <div className="flex flex-col gap-6">
      <NavLink to="/insights" className="inline-flex items-center gap-1.5 font-mono text-[11px] text-muted transition hover:text-coral">
        <ArrowLeft size={13} strokeWidth={1.75} /> BACK TO INSIGHTS
      </NavLink>
      <h2 className="text-lg font-medium tracking-tight">{PLATFORMS[platform]?.label ?? platform}</h2>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map((c) => (
          <div key={c.label} className={`rounded-xl border p-4 ${c.big ? 'border-coral/40 bg-coral/5' : 'border-line bg-surface'}`}>
            <div className={`font-mono text-2xl ${c.big ? 'text-coral' : 'text-fg'}`}>
              {typeof c.value === 'number' ? c.value.toLocaleString() : c.value}
            </div>
            <div className="mt-1 text-xs text-muted">{c.label}</div>
          </div>
        ))}
      </div>

      <section className="rounded-xl border border-line bg-surface p-5">
        <p className="mb-4 font-mono text-xs tracking-wider text-muted">ENGAGEMENT OVER TIME</p>
        <TrendChart series={series} />
      </section>

      <section className="rounded-xl border border-line bg-surface p-5">
        <p className="mb-4 font-mono text-xs tracking-wider text-muted">ALL POSTS</p>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">Nothing published on this platform yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map(({ post, target, m }) => (
              <li key={post.id + target} className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-elevated px-3 py-2">
                <span className="w-20 shrink-0 font-mono text-[11px] text-muted">
                  {new Date(post.scheduledAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </span>
                <NavLink to={`/posts/${post.id}`} className="min-w-0 flex-1 truncate text-sm text-fg transition hover:text-coral">
                  {post.text}
                </NavLink>
                <span className="flex shrink-0 items-center gap-3 font-mono text-[11px] text-muted">
                  <span className="inline-flex items-center gap-1"><Heart size={11} strokeWidth={1.75} />{m.likes || 0}</span>
                  <span className="inline-flex items-center gap-1"><Repeat2 size={11} strokeWidth={1.75} />{m.reposts || 0}</span>
                  <span className="inline-flex items-center gap-1"><MessageCircle size={11} strokeWidth={1.75} />{m.replies || 0}</span>
                  {m.impressions != null && <span className="inline-flex items-center gap-1"><Eye size={11} strokeWidth={1.75} />{m.impressions}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}