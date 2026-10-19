// interface/count-words — how many a list column holds, in words: the one
// wording its header, its folded strip and its compact share.

/** The kinds of column that hold a list. */
export type ListKind = "note-column" | "media"

const NOUN: Readonly<Record<ListKind, readonly [string, string]>> = {
  "note-column": ["note", "notes"],
  media: ["image", "images"],
}

/** `n` of what a `kind` column holds: "no notes", "1 image", "3 images". */
export function countWords(kind: ListKind, n: number): string {
  const [one, many] = NOUN[kind]
  return n === 0 ? `no ${many}` : n === 1 ? `1 ${one}` : `${n} ${many}`
}
