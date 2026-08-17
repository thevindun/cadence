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
import { Inbox as InboxIcon, Menu, X as CloseIcon } from 'lucide-react'
import { API, waitForServer } from './core/api.js'
import { Routes, Route, NavLink, Navigate, useLocation, useNavigate } from 'react-router-dom'
import Onboarding from './components/Onboarding.jsx'
import { Sun, Moon } from 'lucide-react'
import { useTheme } from './core/useTheme.js'
import { useHotkeys } from './core/useHotkeys.js'
import Settings from './components/Settings.jsx'
import { Settings as SettingsIcon } from 'lucide-react'

const NAV = [
  { id: 'queue', path: '/queue', label: 'Queue', icon: ListChecks },
  { id: 'calendar', path: '/calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'import', path: '/import', label: 'Import', icon: Upload },
  { id: 'library', path: '/library', label: 'Library', icon: Images },
  { id: 'insights', path: '/insights', label: 'Insights', icon: BarChart3 },
  { id: 'accounts', path: '/accounts', label: 'Accounts', icon: Plug },
  { id: 'inbox', path: '/inbox', label: 'Inbox', icon: InboxIcon },
  { id: 'settings', path: '/settings', label: 'Settings', icon: SettingsIcon },
]

export default function App() {
  const { posts, addPost, updatePost, deletePost, refreshMetrics } = usePosts()
  const scheduledCount = posts.filter((p) => p.status === STATUS.SCHEDULED).length
  const [editingId, setEditingId] = useState(null)
  const editing = posts.find((p) => p.id === editingId) || null
  const location = useLocation()
  const navigate = useNavigate()
  const [theme, toggleTheme] = useTheme()
  const activeLabel = [...NAV,
  { path: '/failures', label: 'Failures' },
  { path: '/review', label: 'Review' },
  { path: '/team', label: 'Team' },
  ].find((n) => location.pathname.startsWith(n.path))?.label ?? ''
  
  const [helpOpen, setHelpOpen] = useState(false)
  useHotkeys({
    'g': () => navigate('/queue'),
    'c': () => navigate('/calendar'),
    'i': () => navigate('/insights'),
    'l': () => navigate('/library'),
    'a': () => navigate('/accounts'),
    '?': () => setHelpOpen((v) => !v),
    'escape': () => { setHelpOpen(false); setNavOpen(false) },
  })

  const [auth, setAuth] = useState({ state: 'loading', needsSetup: false, user: null })

  const [navOpen, setNavOpen] = useState(false)
  useEffect(() => { setNavOpen(false) }, [location.pathname])   // close on navigate
  useEffect(() => {
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
  nav.push({ id: 'failures', path: '/failures', label: 'Failures', icon: AlertTriangle, badge: failedCount || null, danger: true })
  if (isAdmin) {
    nav.push({ id: 'review', path: '/review', label: 'Review', icon: ClipboardCheck, badge: pendingCount || null })
    if (currentUser) nav.push({ id: 'team', path: '/team', label: 'Team', icon: Users })
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
      {navOpen && (
        <div onClick={() => setNavOpen(false)}
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm md:hidden" />
      )}
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-60 shrink-0 flex-col overflow-y-auto border-r border-line bg-surface
        transition-transform duration-200 md:static md:translate-x-0
        ${navOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="px-5 py-5"><Logo /></div>
        <button onClick={() => setNavOpen(false)}
          className="absolute right-3 top-5 grid h-8 w-8 place-items-center rounded-lg text-muted md:hidden">
          <CloseIcon size={18} strokeWidth={1.75} />
        </button>
        <nav className="flex flex-col gap-1 px-3">
          {nav.map(({ id, path, label, icon: Icon, badge, danger }) => (
            <NavLink key={id} to={path}
              className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition
                ${isActive ? 'bg-coral/12 text-fg' : 'text-muted hover:bg-elevated hover:text-fg'}`}>
              {({ isActive }) => (
                <>
                  <Icon size={18} strokeWidth={1.75} className={isActive ? 'text-coral' : ''} />
                  {label}
                  {badge != null && (
                    <span className={`ml-auto rounded-full px-1.5 font-mono text-[10px] text-white ${danger ? 'bg-red-500' : 'bg-coral'}`}>{badge}</span>
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-2 p-4">
          {isAdmin && (

            <NavLink to="/accounts"
              className="block w-full rounded-lg border border-line px-3 py-2 text-center text-sm text-muted transition hover:border-coral/40 hover:text-fg">
              Connect account
            </NavLink>
          )}
          <button onClick={toggleTheme}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm text-muted transition hover:text-fg">
            {theme === 'dark' ? <Sun size={14} strokeWidth={1.75} /> : <Moon size={14} strokeWidth={1.75} />}
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>

          {getToken() && (
            
            <button onClick={async () => { await logout(); setAuth({ state: 'login', needsSetup: false }) }}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm text-muted transition hover:text-red-400">
              <LogOut size={14} strokeWidth={1.75} /> Sign out
            </button>
          )}
        </div>
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-4 md:px-8">
          <button onClick={() => setNavOpen(true)}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line text-muted md:hidden">
            <Menu size={18} strokeWidth={1.75} />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-medium tracking-tight">{activeLabel}</h1>
            <p className="mt-0.5 font-mono text-xs text-muted">THIS WEEK · {scheduledCount} SCHEDULED</p>
          </div>
          <Notifications />
        </header>

        <main className="flex-1 overflow-y-auto p-4 md:p-8">
          <Onboarding />

          <Routes>
            <Route path="/" element={<Navigate to="/queue" replace />} />
            <Route path="/queue" element={
              <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_1fr]">
                <Composer editing={editing} onSchedule={addPost} onSaveDraft={addPost}
                  onUpdate={handleUpdate} onCancelEdit={() => setEditingId(null)} />
                <Queue posts={posts} onEdit={setEditingId} onDelete={deletePost} />
              </div>
            } />
            <Route path="/calendar" element={<Calendar posts={posts} onReschedule={updatePost} />} />
            <Route path="/import" element={<Import accounts={importAccounts} categories={categories} onImported={() => { }} />} />
            <Route path="/library" element={<MediaLibrary />} />
            <Route path="/insights" element={<Insights posts={posts} onRefresh={refreshMetrics} />} />
            <Route path="/accounts" element={<Accounts />} />
            <Route path="/inbox" element={<Inbox />} />
            <Route path="/failures" element={<Failures posts={posts} onDelete={deletePost} />} />
            <Route path="/review" element={<Review onChange={() => { }} />} />
            <Route path="/team" element={<Team currentUserId={currentUser?.id} />} />
            <Route path="*" element={<Navigate to="/queue" replace />} />
            <Route path="/accounts" element={<Accounts />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
          {helpOpen && (
        <div onClick={() => setHelpOpen(false)}
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm">
          <div onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-xl border border-line bg-surface p-5">
            <p className="mb-3 font-mono text-xs tracking-wider text-muted">KEYBOARD SHORTCUTS</p>
            <ul className="flex flex-col gap-2 text-sm">
              {[['G', 'Queue'], ['C', 'Calendar'], ['I', 'Insights'], ['L', 'Library'],
                ['A', 'Accounts'], ['⌘/Ctrl + Enter', 'Schedule post'], ['?', 'This help']].map(([k, v]) => (
                <li key={k} className="flex items-center justify-between">
                  <span className="text-muted">{v}</span>
                  <kbd className="rounded border border-line bg-elevated px-1.5 py-0.5 font-mono text-[11px] text-fg">{k}</kbd>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>

  )
}