import { Logo } from './components/Logo.jsx'
import Composer from './components/Composer.jsx'
import Queue from './components/Queue.jsx'
import Calendar from './components/Calendar.jsx'
import { usePosts } from './core/usePosts.js'
import { STATUS } from './core/types.js'
import Insights from './components/Insights.jsx'
import Accounts from './components/Accounts.jsx'
import { ListChecks, CalendarDays, BarChart3, Plug, Upload, Images, LogOut } from 'lucide-react'
import Import from './components/Import.jsx'
import { useCategories } from './core/useCategories.js'
import { useState, useEffect } from 'react'
import { PLATFORMS } from './core/types.js'
import MediaLibrary from './components/MediaLibrary.jsx'
import Login from './components/Login.jsx'
import { installAuthFetch, authStatus, getToken, logout } from './core/auth.js'
import Team from './components/Team.jsx'
import { Users } from 'lucide-react'
import Review from './components/Review.jsx'
import { ClipboardCheck } from 'lucide-react'
import Failures from './components/Failures.jsx'
import { AlertTriangle } from 'lucide-react'
import Notifications from './components/Notifications.jsx'
import Inbox from './components/Inbox.jsx'
import { Inbox as InboxIcon } from 'lucide-react'
import { API, waitForServer } from './core/api.js'

const NAV = [
  { id: 'queue', label: 'Queue', icon: ListChecks },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'import', label: 'Import', icon: Upload },
  { id: 'library', label: 'Library', icon: Images },
  { id: 'insights', label: 'Insights', icon: BarChart3 },
  { id: 'accounts', label: 'Accounts', icon: Plug },
  { id: 'inbox', label: 'Inbox', icon: InboxIcon },

]

export default function App() {
  const { posts, addPost, updatePost, deletePost, refreshMetrics } = usePosts()
  const [view, setView] = useState('queue')
  const scheduledCount = posts.filter((p) => p.status === STATUS.SCHEDULED).length
  const activeLabel = NAV.find((n) => n.id === view)?.label ?? ''
  const [editingId, setEditingId] = useState(null)
  const editing = posts.find((p) => p.id === editingId) || null

  const [auth, setAuth] = useState({ state: 'loading', needsSetup: false, user: null })

  useEffect(() => {
    installAuthFetch()
      ; (async () => {
        await waitForServer()
        const status = await authStatus()
        if (!status.enabled) { setAuth({ state: 'ready', user: null }); return }
        if (!status.has_users) { setAuth({ state: 'login', needsSetup: true }); return }
        if (!getToken()) { setAuth({ state: 'login', needsSetup: false }); return }
        const res = await fetch(`${API}/auth/me`)
        setAuth(res.ok ? { state: 'ready', user: await res.json() } : { state: 'login', needsSetup: false })
      })()
  }, [])

  const { categories } = useCategories()
  const [importAccounts, setImportAccounts] = useState([])
  useEffect(() => {
    (async () => {
      try {
        const data = await (await fetch(`${API}/accounts`)).json()
        const flat = []
        for (const p of data)
          for (const c of (p.connections || []))
            flat.push({ id: c.id, handle: c.handle, platform: p.id, maxLen: PLATFORMS[p.id]?.maxLen ?? 500 })
        setImportAccounts(flat)
      } catch (err) { console.error(err) }
    })()
  }, [])

  const handleUpdate = async (id, changes) => {
    await updatePost(id, changes)
    setEditingId(null)
  }

  const pendingCount = posts.filter((p) => p.status === STATUS.PENDING).length
  const currentUser = auth.user                         // null when auth disabled
  const isAdmin = !currentUser || currentUser.role === 'admin'
  const nav = NAV.filter((n) => n.id !== 'accounts' || isAdmin)
  const failedCount = posts.filter((p) => p.status === STATUS.FAILED).length
  nav.push({ id: 'failures', label: 'Failures', icon: AlertTriangle, badge: failedCount || null, danger: true })
  if (isAdmin) {
    nav.push({ id: 'review', label: 'Review', icon: ClipboardCheck, badge: pendingCount || null })
    if (currentUser) nav.push({ id: 'team', label: 'Team', icon: Users })   // no team without auth
  }

  if (auth.state === 'loading')
    return (
      <div className="grid min-h-screen place-items-center bg-ink">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-pulse"><Logo /></div>
          <p className="font-mono text-xs text-muted">Starting Cadence…</p>
        </div>
      </div>
    )
  if (auth.state === 'login')
    return <Login needsSetup={auth.needsSetup} onAuthed={(user) => setAuth({ state: 'ready', user })} />
  return (
    <div className="flex h-screen overflow-hidden bg-ink font-display text-fg">
      <aside className="flex w-60 shrink-0 flex-col overflow-y-auto border-r border-line bg-surface">
        <div className="px-5 py-5"><Logo /></div>
        <nav className="flex flex-col gap-1 px-3">
          {nav.map(({ id, label, icon: Icon, soon, badge, danger }) => (
            <button key={id} onClick={() => !soon && setView(id)} disabled={soon}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition
                ${view === id ? 'bg-coral/12 text-fg'
                  : soon ? 'cursor-not-allowed text-muted/40'
                    : 'text-muted hover:bg-elevated hover:text-fg'}`}>
              <Icon size={18} strokeWidth={1.75} className={view === id ? 'text-coral' : ''} />
              {label}
              {badge != null && (
                <span className={`ml-auto rounded-full px-1.5 font-mono text-[10px] text-white ${danger ? 'bg-red-500' : 'bg-coral'}`}>{badge}</span>
              )}
              {soon && <span className="ml-auto font-mono text-[10px] tracking-wider text-muted/40">SOON</span>}
            </button>
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-2 p-4">
          {isAdmin && (

            <button onClick={() => setView('accounts')}
              className="w-full rounded-lg border border-line px-3 py-2 text-sm text-muted transition hover:border-coral/40 hover:text-fg">
              Connect account
            </button>
          )}
          {getToken() && (
            <button onClick={async () => { await logout(); setAuth({ state: 'login', needsSetup: false }) }}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm text-muted transition hover:text-red-400">
              <LogOut size={14} strokeWidth={1.75} /> Sign out
            </button>
          )}
        </div>
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-line px-8 py-4">
          <div>
            <h1 className="text-lg font-medium tracking-tight">{activeLabel}</h1>
            <p className="mt-0.5 font-mono text-xs text-muted">THIS WEEK · {scheduledCount} SCHEDULED</p>
          </div>
          <Notifications />
        </header>

        <main className="flex-1 overflow-y-auto p-8">
          {view === 'import' && <Import accounts={importAccounts} categories={categories} onImported={() => setView('queue')} />}
          {view === 'queue' && (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_1fr]">
              <Composer
                editing={editing}
                onSchedule={addPost}
                onSaveDraft={addPost}
                onUpdate={handleUpdate}
                onCancelEdit={() => setEditingId(null)}
              />
              <Queue posts={posts} onEdit={setEditingId} onDelete={deletePost} />
            </div>
          )}
          {view === 'library' && <MediaLibrary />}
          {view === 'calendar' && <Calendar posts={posts} onReschedule={updatePost} />}
          {view === 'insights' && <Insights posts={posts} onRefresh={refreshMetrics} />}
          {view === 'accounts' && <Accounts />}
          {view === 'team' && <Team currentUserId={currentUser?.id} />}
          {view === 'review' && <Review onChange={() => { }} />}
          {view === 'failures' && <Failures posts={posts} onDelete={deletePost} />}
          {view === 'inbox' && <Inbox />}
        </main>
      </div>
    </div>
  )
}