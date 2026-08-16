import { useEffect, useRef } from 'react'

const GROUPS = {
  Faces: ['😀','😄','😅','🤣','🙂','😉','😍','🤩','😘','😎','🤔','🤗','😴','🥳','😭','😤','🙃','🫠','🤯','🥲'],
  Gestures: ['👍','👎','👏','🙌','🤝','💪','🙏','✌️','🤞','👋','🫶','👀','🧠','🔥','✨','💯','⚡','🎯','🚀','📈'],
  Objects: ['📣','📌','📎','🗓️','⏰','💡','🔗','📊','📷','🎥','🎧','💻','📱','🛠️','🧵','📝','📚','🏆','🎁','☕'],
  Symbols: ['❤️','🧡','💛','💚','💙','💜','🖤','⭐','✅','❌','⚠️','❓','❗','➡️','🔁','🔔','🌟','🌍','🎉','🕐'],
}

export default function EmojiPicker({ onPick, onClose }) {
  const ref = useRef(null)
  useEffect(() => {
    const away = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    const esc = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc) }
  }, [onClose])

  return (
    <div ref={ref}
      className="absolute bottom-full right-0 z-20 mb-2 max-h-64 w-64 overflow-y-auto rounded-xl border border-line bg-surface p-3 shadow-xl">
      {Object.entries(GROUPS).map(([label, list]) => (
        <div key={label} className="mb-3 last:mb-0">
          <p className="mb-1.5 font-mono text-[10px] tracking-wider text-muted">{label.toUpperCase()}</p>
          <div className="grid grid-cols-8 gap-0.5">
            {list.map((e) => (
              <button key={e} onClick={() => onPick(e)}
                className="grid h-7 place-items-center rounded text-base transition hover:bg-elevated">
                {e}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}