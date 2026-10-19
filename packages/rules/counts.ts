// counts — how a count and a size read, for people and the agent alike.

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

/** The first `shown` names, then how many more, as a list: "a, b and c", "a, b, c and 2 more". */
export function namesAndMore(names: readonly string[], shown: number): string {
  const more = names.length - shown
  const listed = more > 0 ? [...names.slice(0, shown), `${more} more`] : names
  const last = listed.at(-1) ?? ""
  return listed.length < 2
    ? last
    : `${listed.slice(0, -1).join(", ")} and ${last}`
}

/** A count that says "no" for none: "no images", "1 image", "3 images". */
export const countOrNone = (n: number, one: string, many: string): string =>
  n === 0 ? `no ${many}` : count(n, one, many)

/** A note column's count: "no notes", "1 note", "3 notes". */
export const noteCountWords = (n: number): string =>
  countOrNone(n, "note", "notes")

/** A commit's or a change id's first eight characters, as a person reads one. */
export const shortId = (id: string): string => id.slice(0, 8)
