export default function EmptyState({ icon: Icon, title, body, action, onAction }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-line px-6 py-12 text-center">
      <div className="grid h-11 w-11 place-items-center rounded-full bg-coral/10">
        <Icon size={20} strokeWidth={1.75} className="text-coral" />
      </div>
      <p className="text-sm font-medium text-fg">{title}</p>
      <p className="max-w-xs text-xs leading-relaxed text-muted">{body}</p>
      {action && (
        <button onClick={onAction}
          className="mt-1 rounded-lg bg-coral px-3 py-1.5 text-xs font-medium text-white transition duration-100 hover:-translate-y-0.5">
          {action}
        </button>
      )}
    </div>
  )
}