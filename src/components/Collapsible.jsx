import { ChevronDown } from 'lucide-react'

export default function Collapsible({ icon: Icon, label, active, open, onToggle, children }) {
  return (
    <div className="rounded-lg border border-line">
      <button onClick={onToggle}
        className={`flex w-full items-center gap-2 px-3 py-2 font-mono text-[11px] transition
          ${active ? 'text-coral' : 'text-muted hover:text-fg'}`}>
        <Icon size={13} strokeWidth={1.75} />
        {label}
        {active && <span className="h-1.5 w-1.5 rounded-full bg-coral" />}
        <ChevronDown size={13} strokeWidth={1.75}
          className={`ml-auto transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="border-t border-line px-3 py-3">{children}</div>}
    </div>
  )
}