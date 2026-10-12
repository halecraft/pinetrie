// core/edits — a changing snapshot, as edits to a text.
//
// Kyneta text records edits, not values, so a text that grows costs what was
// added, not a new copy each time: a live tool stream measured as whole values
// appended 4.35 MB; as edits, 96 KB. Every stream pinetrie writes, a reply's
// deltas and a tool's output, goes through here.

/** One edit: at `at`, remove `remove` characters, then insert `insert`. */
export interface TextEdit {
  readonly at: number
  readonly remove: number
  readonly insert: string
}

/**
 * The edits that turn `prev` into `next`, inserting as little as possible.
 *
 * A tool's output view keeps only its tail: as lines are added at the end,
 * lines drop off the front. A single common-prefix/common-suffix splice then
 * shares neither end and replaces everything. So the candidates are a pure
 * append; "cut the front, append the end", keeping the longest suffix of `prev`
 * that `next` begins with; and one splice. The one inserting least wins.
 */
export function tailEdit(prev: string, next: string): readonly TextEdit[] {
  if (prev === next) return []
  if (next.startsWith(prev))
    return [{ at: prev.length, remove: 0, insert: next.slice(prev.length) }]
  const single = splice(prev, next)
  const kept = overlap(prev, next)
  if (kept === 0 || next.length - kept >= single.insert.length) return [single]
  const front: TextEdit = { at: 0, remove: prev.length - kept, insert: "" }
  return next.length === kept
    ? [front]
    : [front, { at: kept, remove: 0, insert: next.slice(kept) }]
}

/**
 * The length of the longest suffix of `prev` that is a prefix of `next`: KMP's
 * failure function over `next`, run across `prev`. Linear in both.
 */
function overlap(prev: string, next: string): number {
  if (next.length === 0) return 0
  const fail = new Int32Array(next.length)
  for (let i = 1, k = 0; i < next.length; i += 1) {
    while (k > 0 && next[i] !== next[k]) k = fail[k - 1] ?? 0
    if (next[i] === next[k]) k += 1
    fail[i] = k
  }
  let k = 0
  for (let i = 0; i < prev.length; i += 1) {
    while (k > 0 && (k === next.length || prev[i] !== next[k]))
      k = fail[k - 1] ?? 0
    if (prev[i] === next[k]) k += 1
  }
  return k
}

/** One edit keeping the longest common prefix and suffix. */
function splice(prev: string, next: string): TextEdit {
  const max = Math.min(prev.length, next.length)
  let p = 0
  while (p < max && prev[p] === next[p]) p += 1
  let s = 0
  while (s < max - p && prev[prev.length - 1 - s] === next[next.length - 1 - s])
    s += 1
  return {
    at: p,
    remove: prev.length - p - s,
    insert: next.slice(p, next.length - s),
  }
}

/** `text` with `edits` applied in order: what a Kyneta text holds afterwards. */
export const applyEdits = (text: string, edits: readonly TextEdit[]): string =>
  edits.reduce(
    (t, e) => t.slice(0, e.at) + e.insert + t.slice(e.at + e.remove),
    text,
  )
