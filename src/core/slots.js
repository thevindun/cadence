import { localInputToISO, isoToLocalInput } from './tz.js'

/** Earliest slot strictly after `after`, skipping times already taken. */
export function nextOpenSlot(slots, tz, taken = [], after = new Date()) {
  if (!slots?.length) return null
  const takenSet = new Set(taken)
  for (let d = 0; d < 28; d++) {                      // look ahead 4 weeks
    const probe = new Date(after.getTime() + d * 86400000)
    const wall = isoToLocalInput(probe.toISOString(), tz)
    const dow = new Date(`${wall}:00`).getDay()
    for (const s of slots.filter((x) => x.day === dow).sort((a, b) => a.time.localeCompare(b.time))) {
      const iso = localInputToISO(`${wall.slice(0, 10)}T${s.time}`, tz)
      if (new Date(iso) > after && !takenSet.has(iso)) return iso
    }
  }
  return null
}