// interface/counts — how a count, a list of names and an age read.

/** "1 message", "6 messages": a noun whose plural adds an s. */
export const plural = (n: number, noun: string): string =>
  `${n} ${noun}${n === 1 ? "" : "s"}`

/** "1 commit", "3 commits": a count with its noun in either form. */
export const count = (n: number, one: string, many: string): string =>
  `${n} ${n === 1 ? one : many}`

/** A size in bytes as people read it: "12 bytes", "340 KB", "1.2 MB", "3.4 GB". */
export function byteWords(bytes: number): string {
  if (bytes < 1000) return plural(bytes, "byte")
  const units = ["KB", "MB", "GB", "TB"] as const
  let n = bytes / 1000
  let unit = 0
  while (n >= 1000 && unit < units.length - 1) {
    n /= 1000
    unit++
  }
  return `${n >= 100 ? Math.round(n) : Number(n.toFixed(1))} ${units[unit]}`
}

const names = new Intl.ListFormat("en", { style: "long", type: "conjunction" })

/** "Ada", "Ada and Bea", "Ada, Bea, and Cat". */
export const listPhrase = (items: readonly string[]): string =>
  names.format(items)

/** How long ago `ms` was, roughly: "just now", "5 min ago", "3 h ago", "2 d ago". */
export const ago = (ms: number, now: number): string => agoWords(now - ms)

/** Something `ageMs` old, roughly: "just now", "5 min ago", "3 h ago", "2 d ago". */
export const agoWords = (ageMs: number): string => {
  const span = roughSpan(ageMs)
  return span === null ? "just now" : `${span} ago`
}

/** How long until something `ms` away, roughly: "soon", "in 5 min", "in 3 h", "in 2 d". */
export const until = (ms: number): string => {
  const span = roughSpan(ms)
  return span === null ? "soon" : `in ${span}`
}

/** A span to the nearest unit, "5 min", "3 h", "2 d"; null under a minute. */
const roughSpan = (ms: number): string | null => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return null
  if (s < 3600) return `${Math.round(s / 60)} min`
  if (s < 86_400) return `${Math.round(s / 3600)} h`
  return `${Math.round(s / 86_400)} d`
}

const MINUTE = { ms: 60_000, one: "a minute", many: "minutes" } as const
const SPAN_UNITS = [
  { ms: 7 * 86_400_000, one: "a week", many: "weeks" },
  { ms: 86_400_000, one: "a day", many: "days" },
  { ms: 3_600_000, one: "an hour", many: "hours" },
  MINUTE,
] as const

/**
 * A length of time, exactly, in the largest unit it is a whole number of:
 * "a week", "10 days", "36 hours"; past a minute's precision, rounded to
 * minutes.
 */
export const spanWords = (ms: number): string => {
  const unit = SPAN_UNITS.find(u => ms >= u.ms && ms % u.ms === 0) ?? MINUTE
  const n = Math.max(1, Math.round(ms / unit.ms))
  return n === 1 ? unit.one : `${n} ${unit.many}`
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const

/** A moment in this device's time, to the minute: "3 May, 14:02". */
export function whenWords(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => `${n < 10 ? "0" : ""}${n}`
  return `${d.getDate()} ${MONTHS[d.getMonth()] ?? ""}, ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** How long something has run, to the second: "0s", "59s", "1m 05s", "1h 02m". */
export function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const two = (n: number) => String(n).padStart(2, "0")
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${two(s % 60)}s`
  return `${Math.floor(s / 3600)}h ${two(Math.floor(s / 60) % 60)}m`
}
