// behind — a thread's base has new work (ADR-0080): what the thread is told,
// and when it is caught up instead.
//
// A behind message is a pi `CustomMessage` in `update.ts`'s pattern:
// `content` is what the model reads, `details` the `BehindView` the column
// words as one line. It is written before a run's prompt, in the commit that
// admits the run, as a cards entry is (S92), or steered into a running thread
// (S103 item 4). `planBaseNews` is the one decision: a lane with work of its
// own is told, one with none is caught up before its run, never both.

import {
  type BaseRecord,
  type BehindView,
  CATCH_UP_TOOL,
  type CommitId,
  commitId,
  isLaneName,
  type LineRecord,
  type OfferRecord,
  type ThreadName,
} from "@pinetrie/core"
import { type Static, Type } from "typebox"
import { CommitSchema, decodeWith } from "./decode.ts"
import { catchUpOf, movedOnLine } from "./line.ts"

export const BEHIND_TYPE = "pinetrie.behind"

/** How many files the model is told of by name, before "and N more". */
const NAMED_FILES = 20

const BehindDetailsSchema = Type.Object({
  from: Type.Union([
    Type.Object({ kind: Type.Literal("line") }),
    Type.Object({ kind: Type.Literal("wip"), bookmark: Type.String() }),
    Type.Object({
      kind: Type.Literal("parent"),
      lane: Type.String({ minLength: 1 }),
      name: Type.String({ minLength: 1 }),
    }),
  ]),
  to: CommitSchema,
  files: Type.Array(Type.String()),
  overlap: Type.Array(Type.String()),
  conflicts: Type.Array(Type.String()),
})

const BehindSchema = Type.Object({
  role: Type.Literal("custom"),
  customType: Type.Literal(BEHIND_TYPE),
  details: BehindDetailsSchema,
})

/** The pi `CustomMessage` a base's news is stored as. */
export interface BehindMessage {
  readonly role: "custom"
  readonly customType: typeof BEHIND_TYPE
  readonly content: string
  readonly display: true
  readonly details: BehindView
  readonly timestamp: number
}

const fromStored = (
  d: Static<typeof BehindDetailsSchema>,
): BehindView | undefined => {
  const { from } = d
  const rest = {
    to: commitId(d.to),
    files: d.files,
    overlap: d.overlap,
    conflicts: d.conflicts,
  }
  if (from.kind !== "parent") return { from, ...rest }
  return isLaneName(from.lane)
    ? {
        from: {
          kind: "parent",
          lane: from.lane,
          name: from.name as ThreadName,
        },
        ...rest,
      }
    : undefined
}

/** A stored message -> what it told, or undefined if it is not one. */
export const decodeBehind = (message: unknown): BehindView | undefined =>
  decodeWith(BehindSchema, message, ({ details }) => fromStored(details))

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`

/** The one line a column shows for a base's news. */
export const behindLine = (v: BehindView): string =>
  `↓ ${movedOnLine(v.from)}: ${plural(v.files.length, "file", "files")}${v.overlap.length === 0 ? "" : `, ${v.overlap.length} this thread changed too`}`

/** Some names, then how many more. */
const named = (files: readonly string[]): string => {
  const shown = files.slice(0, NAMED_FILES).map(f => `- ${f}\n`)
  const more = files.length - shown.length
  return `${shown.join("")}${more > 0 ? `- and ${more} more\n` : ""}`
}

/** What the model reads: what changed, what it touches of this thread's work, and what to do. */
export function behindContent(v: BehindView): string {
  const overlap =
    v.overlap.length === 0
      ? "None of them are files this thread changed.\n"
      : `This thread changed these too:\n${named(v.overlap)}`
  const conflicts =
    v.conflicts.length === 0
      ? ""
      : `\nThis thread's offer conflicts with it in:\n${named(v.conflicts)}`
  return (
    `${movedOnLine(v.from)} since this thread's copy was made or last caught up. Catching up would change ${plural(v.files.length, "file", "files")}:\n${named(v.files)}\n` +
    `${overlap}${conflicts}\n` +
    `To merge it into this copy, call \`${CATCH_UP_TOOL}\`, alone in its turn. Nothing is merged until you do.`
  )
}

/** The behind message. */
export const encodeBehind = (
  view: BehindView,
  timestamp: number,
): BehindMessage => ({
  role: "custom",
  customType: BEHIND_TYPE,
  content: behindContent(view),
  display: true,
  details: view,
  timestamp,
})

/** What a base with new work comes to for a thread (ADR-0080). */
export type BaseNews =
  | { readonly kind: "nothing" }
  /** The lane's work changes no file: catch it up before its run, quietly. */
  | { readonly kind: "catch-up" }
  /** The lane has work of its own: tell it, and leave catching up to it. */
  | { readonly kind: "tell"; readonly view: BehindView }

/**
 * Whether a thread's base has news for it, and what to do with it: from the
 * lane's base record and the line's (`catchUpOf`), its offer, the base
 * commits it last heard of or merged (`baseKnown`), and the one the host
 * told it while it runs (`told`). Only a lane of its own has a base. `unknown`
 * work never acts (ADR-0067), nor a gone base. Pure.
 */
export function planBaseNews(input: {
  readonly own: boolean
  readonly base: BaseRecord | undefined
  readonly line: LineRecord | null
  readonly offer: OfferRecord | undefined
  readonly known: readonly CommitId[] | null
  readonly told: CommitId | null
}): BaseNews {
  const { base } = input
  if (!input.own || base === undefined || base.state === "gone")
    return { kind: "nothing" }
  const now = catchUpOf(base, input.line)
  if (now.kind !== "brings") return { kind: "nothing" }
  if (base.work === "none") return { kind: "catch-up" }
  const { to } = now.move
  if (
    base.work !== "some" ||
    input.known?.includes(to) === true ||
    input.told === to
  )
    return { kind: "nothing" }
  const files = base.catchUp?.files ?? []
  const mine = new Set(input.offer?.files ?? [])
  return {
    kind: "tell",
    view: {
      from: now.move.base,
      to,
      files,
      overlap: files.filter(f => mine.has(f)),
      conflicts: input.offer?.conflicts ?? [],
    },
  }
}
