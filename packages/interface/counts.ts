// interface/counts — how a count, a list of names and an age read. Pure.

/** "1 message", "6 messages": a noun whose plural adds an s. */
export const plural = (n: number, noun: string): string =>
  `${n} ${noun}${n === 1 ? "" : "s"}`

/** "1 commit", "3 commits": a count with its noun in either form. */
export const count = (n: number, one: string, many: string): string =>
  `${n} ${n === 1 ? one : many}`

const names = new Intl.ListFormat("en", { style: "long", type: "conjunction" })

/** "Ada", "Ada and Bea", "Ada, Bea, and Cat". */
export const listOf = (items: readonly string[]): string => names.format(items)

/** How long ago `ms` was, roughly: "just now", "5 min ago", "3 h ago", "2 d ago". */
export function ago(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 60) return "just now"
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86_400)} d ago`
}
