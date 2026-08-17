export const TIMEZONES = Intl.supportedValuesOf?.('timeZone') ?? [
  'UTC', 'America/Vancouver', 'America/Edmonton', 'America/Toronto',
  'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin',
  'Asia/Colombo', 'Asia/Tokyo', 'Australia/Sydney',
]

export const browserTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone

/** Offset (ms) of a zone at a given instant. */
function tzOffset(date, tz) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const p = Object.fromEntries(dtf.formatToParts(date).map((x) => [x.type, x.value]))
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour === '24' ? 0 : p.hour, p.minute, p.second)
  return asUTC - date.getTime()
}

/** "2026-08-15T09:00" wall-clock in `tz` -> UTC ISO string. */
export function localInputToISO(input, tz) {
  const [d, t] = input.split('T')
  const [y, mo, da] = d.split('-').map(Number)
  const [h, mi] = t.split(':').map(Number)
  const guess = Date.UTC(y, mo - 1, da, h, mi)
  const off = tzOffset(new Date(guess), tz)
  return new Date(guess - off).toISOString()
}

/** UTC ISO -> "YYYY-MM-DDTHH:mm" wall-clock in `tz`. */
export function isoToLocalInput(iso, tz) {
  const date = new Date(iso)
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
  const p = Object.fromEntries(dtf.formatToParts(date).map((x) => [x.type, x.value]))
  const hh = p.hour === '24' ? '00' : p.hour
  return `${p.year}-${p.month}-${p.day}T${hh}:${p.minute}`
}

export const fmtInTz = (iso, tz, opts) =>
  new Date(iso).toLocaleString(undefined, { timeZone: tz, ...opts })