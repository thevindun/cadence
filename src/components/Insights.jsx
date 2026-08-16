import { RefreshCw, Download, Heart, Repeat2, MessageCircle, BarChart3 } from 'lucide-react'
import { STATUS, PLATFORMS } from '../core/types.js'
import { useState, useMemo, useEffect } from 'react'
import { API } from '../core/api.js'
import TrendChart from './TrendChart.jsx'
import BestTime from './BestTime.jsx'
import FollowerGrowth from './FollowerGrowth.jsx'
import LinkStats from './LinkStats.jsx'

const RANGES = [
  { id: 7, label: '7D' }, { id: 30, label: '30D' }, { id: 90, label: '90D' }, { id: 0, label: 'ALL' },
]
const platformOf = (t) => (t.includes(':') ? t.split(':')[0] : t)
const engOf = (m) => (m.likes || 0) + (m.reposts || 0) + (m.replies || 0)
const postEng = (p) => Object.values(p.metrics || {}).reduce((s, m) => s + engOf(m), 0)

export default function Insights({ posts, onRefresh }) {
  const [days, setDays] = useState(30)
  const [refreshing, setRefreshing] = useState(false)
  const [tab, setTab] = useState('overview')

  const published = useMemo(() => {
    const cutoff = days ? Date.now() - days * 86400000 : 0
    return posts.filter((p) => p.status === STATUS.PUBLISHED && new Date(p.scheduledAt).getTime() >= cutoff)
  }, [posts, days])

  const totals = useMemo(() => {
    const t = { likes: 0, reposts: 0, replies: 0 }
    for (const p of published)
      for (const m of Object.values(p.metrics || {})) {
        t.likes += m.likes || 0; t.reposts += m.reposts || 0; t.replies += m.replies || 0
      }
    return { ...t, engagement: t.likes + t.reposts + t.replies, posts: published.length }
  }, [published])

  const byPlatform = useMemo(() => {
    const map = {}
    for (const p of published)
      for (const [target, m] of Object.entries(p.metrics || {})) {
        const pl = platformOf(target)
        const e = map[pl] || (map[pl] = { platform: pl, likes: 0, reposts: 0, replies: 0, posts: 0 })
        e.likes += m.likes || 0; e.reposts += m.reposts || 0; e.replies += m.replies || 0; e.posts += 1
      }
    return Object.values(map).map((e) => ({ ...e, engagement: e.likes + e.reposts + e.replies }))
      .sort((a, b) => b.engagement - a.engagement)
  }, [published])

  const buckets = useMemo(() => {
    const span = days || 30
    const weekly = span > 31
    const step = (weekly ? 7 : 1) * 86400000
    const n = Math.ceil(span / (weekly ? 7 : 1))
    const start = new Date(); start.setHours(0, 0, 0, 0); start.setTime(start.getTime() - (n - 1) * step)
    const arr = Array.from({ length: n }, (_, i) => {
      const d = new Date(start.getTime() + i * step)
      return {
        engagement: 0,
        label: d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' }),
      }
    })
    for (const p of published) {
      const idx = Math.floor((new Date(p.scheduledAt).getTime() - start.getTime()) / step)
      if (idx >= 0 && idx < n) arr[idx].engagement += postEng(p)
    }
    return arr
  }, [published, days])

  const topPosts = useMemo(() =>
    [...published].map((p) => ({ p, e: postEng(p) })).sort((a, b) => b.e - a.e).slice(0, 5)
    , [published])

  const [history, setHistory] = useState([])
  useEffect(() => {
    (async () => {
      try { setHistory(await (await fetch(`${API}/metrics/history?days=${days || 365}`)).json()) }
      catch (err) { console.error('Failed to load history:', err) }
    })()
  }, [days])

  const trend = useMemo(() => {
    if (!history.length) return []
    // For each day, take the LATEST snapshot per (post,target), sum engagement → account total that day.
    const byDay = {}
    for (const s of history) {
      const d = new Date(s.taken_at); d.setHours(0, 0, 0, 0)
      const key = d.getTime(), pt = `${s.post_id}|${s.target}`
      const day = byDay[key] || (byDay[key] = { date: d, latest: {} })
      day.latest[pt] = (s.likes || 0) + (s.reposts || 0) + (s.replies || 0)   // later rows overwrite = latest wins
    }
    return Object.values(byDay).sort((a, b) => a.date - b.date).map((day) => ({
      label: day.date.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' }),
      value: Object.values(day.latest).reduce((s, v) => s + v, 0),
    }))
  }, [history])

  const maxBucket = Math.max(1, ...buckets.map((b) => b.engagement))
  const maxPlat = Math.max(1, ...byPlatform.map((b) => b.engagement))

  const refresh = async () => { setRefreshing(true); try { await onRefresh() } finally { setRefreshing(false) } }

  const exportCSV = () => {
    const lines = [['date', 'text', 'platform', 'likes', 'reposts', 'replies']]
    for (const p of published)
      for (const [target, m] of Object.entries(p.metrics || {}))
        lines.push([new Date(p.scheduledAt).toISOString(), p.text, platformOf(target), m.likes || 0, m.reposts || 0, m.replies || 0])
    const csv = lines.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a'); a.href = url; a.download = `cadence-analytics-${days || 'all'}d.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  const cards = [
    { label: 'published', value: totals.posts },
    { label: 'likes', value: totals.likes },
    { label: 'reposts', value: totals.reposts },
    { label: 'replies', value: totals.replies },
    { label: 'engagement', value: totals.engagement, big: true },
  ]

  return (
    <div className="flex flex-col gap-6">
      <div className="inline-flex rounded-lg border border-line p-0.5">
        {[['overview', 'OVERVIEW'], ['besttime', 'BEST TIME'], ['followers', 'FOLLOWERS'], ['links', 'LINKS']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`rounded-md px-2.5 py-1 font-mono text-[11px] transition ${tab === id ? 'bg-coral text-white' : 'text-muted hover:text-fg'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'besttime' && <BestTime posts={posts} />}
      {tab === 'followers' && <FollowerGrowth days={days} />}
      {tab === 'overview' && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex rounded-lg border border-line p-0.5">
              {RANGES.map((r) => (
                <button key={r.id} onClick={() => setDays(r.id)}
                  className={`rounded-md px-2.5 py-1 font-mono text-[11px] transition ${days === r.id ? 'bg-coral text-white' : 'text-muted hover:text-fg'}`}>
                  {r.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] tracking-wider text-muted/60">AUTO · 5M</span>
              <button onClick={refresh} disabled={refreshing}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 font-mono text-[11px] text-muted transition hover:border-coral/40 hover:text-fg disabled:opacity-40">
                <RefreshCw size={13} strokeWidth={1.75} className={refreshing ? 'animate-spin' : ''} />
                {refreshing ? 'SYNCING' : 'REFRESH'}
              </button>
              <button onClick={exportCSV} disabled={!published.length}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 font-mono text-[11px] text-muted transition hover:border-coral/40 hover:text-fg disabled:opacity-40">
                <Download size={13} strokeWidth={1.75} /> CSV
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {cards.map((c) => (
              <div key={c.label} className={`rounded-xl border p-4 ${c.big ? 'border-coral/40 bg-coral/5' : 'border-line bg-surface'}`}>
                <div className={`font-mono text-2xl ${c.big ? 'text-coral' : 'text-fg'}`}>{c.value.toLocaleString()}</div>
                <div className="mt-1 text-xs text-muted">{c.label}</div>
              </div>
            ))}
          </div>

          <section className="rounded-xl border border-line bg-surface p-5">
            <p className="mb-4 font-mono text-xs tracking-wider text-muted">ENGAGEMENT TREND</p>
            <TrendChart series={trend} />
          </section>

          <section className="rounded-xl border border-line bg-surface p-5">
            <p className="mb-4 font-mono text-xs tracking-wider text-muted">ENGAGEMENT BY POST DATE</p>
            {published.length === 0 ? (
              <EmptyState icon={BarChart3} title="No data yet"
                body="Once posts publish, engagement appears here and refreshes every 5 minutes." />
            ) : (
              <div className="flex h-40 items-end gap-1 overflow-x-auto">
                {buckets.map((b, i) => (
                  <div key={i} className="group flex flex-1 flex-col items-center justify-end gap-1" title={`${b.label}: ${b.engagement}`}>
                    <div className="w-full rounded-t bg-coral/70 transition group-hover:bg-coral"
                      style={{ height: `${(b.engagement / maxBucket) * 100}%`, minHeight: b.engagement ? '2px' : '0' }} />
                    <span className="font-mono text-[9px] text-muted/60">{b.label}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="rounded-xl border border-line bg-surface p-5">
              <p className="mb-4 font-mono text-xs tracking-wider text-muted">BY PLATFORM</p>
              {byPlatform.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted">No data yet.</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {byPlatform.map((b) => (
                    <div key={b.platform}>
                      <div className="mb-1 flex items-center justify-between font-mono text-xs">
                        <span className="text-fg">{PLATFORMS[b.platform]?.label ?? b.platform}</span>
                        <span className="text-muted">{b.engagement.toLocaleString()}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-elevated">
                        <div className="h-full rounded-full bg-fg/30" style={{ width: `${(b.engagement / maxPlat) * 100}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-xl border border-line bg-surface p-5">
              <p className="mb-4 font-mono text-xs tracking-wider text-muted">TOP POSTS</p>
              {topPosts.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted">No data yet.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {topPosts.map(({ p, e }) => (
                    <li key={p.id} className="flex items-center gap-3 rounded-lg border border-line bg-elevated px-3 py-2">
                      <span className="flex-1 truncate text-sm text-fg">{p.text}</span>
                      <span className="font-mono text-xs text-muted">{e.toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <p className="font-mono text-[11px] text-muted/60">
            Mock-platform numbers are random and reshuffle each refresh; Bluesky, Mastodon &amp; other live platforms show real engagement.
          </p>
        </>
      )}
      {tab === 'links' && <LinkStats />}
    </div>
  )
}