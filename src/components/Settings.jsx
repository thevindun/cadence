import { useState } from 'react'
import { Clock, Plus, X, Pause, Play } from 'lucide-react'
import { useSettings } from '../core/useSettings.js'
import { TIMEZONES } from '../core/tz.js'
import { useToast } from '../core/useToast.jsx'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function Settings() {
  const { settings, save } = useSettings()
  const toast = useToast()
  const [day, setDay] = useState(1)
  const [time, setTime] = useState('09:00')
  if (!settings) return <p className="text-sm text-muted">Loading…</p>

  const slots = settings.slots || []
  const addSlot = () => {
    if (slots.some((s) => s.day === day && s.time === time)) return toast('That slot already exists', 'err')
    save({ slots: [...slots, { day, time }].sort((a, b) => a.day - b.day || a.time.localeCompare(b.time)) })
    toast('Slot added')
  }
  const delSlot = (i) => save({ slots: slots.filter((_, x) => x !== i) })

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <section className="rounded-xl border border-line bg-surface p-5">
        <p className="mb-3 font-mono text-xs tracking-wider text-muted">TIMEZONE</p>
        <select value={settings.timezone} onChange={(e) => { save({ timezone: e.target.value }); toast('Timezone updated') }}
          className="w-full rounded-lg border border-line bg-elevated px-3 py-2 text-sm text-fg outline-none transition focus:border-coral">
          {TIMEZONES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <p className="mt-2 text-xs text-muted">All scheduling times are interpreted in this zone.</p>
      </section>
      <label className="mt-3 inline-flex cursor-pointer items-center gap-2 text-sm text-muted">
        <input type="checkbox" checked={!!settings.evergreen_fill} className="accent-coral"
          onChange={(e) => save({ evergreen_fill: e.target.checked })} />
        Auto-fill empty slots from evergreen posts
      </label>

      <section className="rounded-xl border border-line bg-surface p-5">
        <p className="mb-3 font-mono text-xs tracking-wider text-muted">POSTING SCHEDULE</p>
        <p className="mb-4 text-xs leading-relaxed text-muted">
          Define the times you usually post. The composer can drop a post into the next open slot with one click.
        </p>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <select value={day} onChange={(e) => setDay(Number(e.target.value))}
            className="rounded-lg border border-line bg-elevated px-2 py-1.5 font-mono text-xs text-fg outline-none focus:border-coral">
            {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
          </select>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)}
            className="rounded-lg border border-line bg-elevated px-2 py-1.5 font-mono text-xs text-fg outline-none focus:border-coral" />
          <button onClick={addSlot}
            className="inline-flex items-center gap-1.5 rounded-lg bg-coral px-3 py-1.5 font-mono text-xs text-white transition hover:-translate-y-0.5">
            <Plus size={13} strokeWidth={2} /> ADD SLOT
          </button>
        </div>

        {slots.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted">No slots yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {slots.map((s, i) => (
              <span key={i} className="inline-flex items-center gap-2 rounded-full border border-line bg-elevated px-3 py-1 font-mono text-xs text-fg">
                <Clock size={12} strokeWidth={1.75} className="text-coral" />
                {DAYS[s.day]} {s.time}
                <button onClick={() => delSlot(i)} className="text-muted transition hover:text-red-400">
                  <X size={12} strokeWidth={2} />
                </button>
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-line bg-surface p-5">
        <p className="mb-3 font-mono text-xs tracking-wider text-muted">PUBLISHING</p>
        <button onClick={() => { save({ paused: !settings.paused }); toast(settings.paused ? 'Publishing resumed' : 'Publishing paused') }}
          className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition
            ${settings.paused ? 'border-coral bg-coral/10 text-coral' : 'border-line text-muted hover:text-fg'}`}>
          {settings.paused ? <Play size={15} strokeWidth={1.75} /> : <Pause size={15} strokeWidth={1.75} />}
          {settings.paused ? 'Resume publishing' : 'Pause publishing'}
        </button>
        <p className="mt-2 text-xs text-muted">
          {settings.paused
            ? 'Scheduled posts are held. Nothing is lost — they publish when you resume.'
            : 'Posts publish at their scheduled time.'}
        </p>
      </section>
      <label className="mt-3 inline-flex cursor-pointer items-center gap-2 text-sm text-muted">
        <input type="checkbox" checked={!!settings.evergreen_fill} className="accent-coral"
          onChange={(e) => save({ evergreen_fill: e.target.checked })} />
        Auto-fill empty slots from evergreen posts
      </label>
    </div>
  )
}