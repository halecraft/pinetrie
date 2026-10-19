// behind — a thread's base has new work: what the thread is told, and when it
// is caught up instead.

import type { PointId, ProposedChangesRecord } from "@pinetrie/core"
import { type BehindView, GET_LATEST_TOOL } from "@pinetrie/threads"
import { Type } from "typebox"
import type { AcceptedRecord } from "./accepted.ts"
import { type BaseRecord, latestNow } from "./base.ts"
import { count } from "./counts.ts"
import { List, PointSchema } from "./decode.ts"
import { type HistoryMessage, historyMessage } from "./history.ts"
import { baseMovedOn, LatestFromSchema } from "./latest-from.ts"

export const BEHIND_TYPE = "pinetrie.behind"

/** How many files the model is told of by name, before "and N more". */
const NAMED_FILES = 20

const BehindDetailsSchema = Type.Object({
  from: LatestFromSchema,
  to: PointSchema,
  files: List(Type.String()),
  overlap: List(Type.String()),
  conflicts: List(Type.String()),
})

export const BEHIND = historyMessage(BEHIND_TYPE, BehindDetailsSchema)

/** The pi `CustomMessage` a base's news is stored as. */
export type BehindMessage = HistoryMessage<typeof BEHIND_TYPE, BehindView>

/** A stored message -> what it told, or undefined if it is not one. */
export const decodeBehind = (message: unknown): BehindView | undefined =>
  BEHIND.decode(message)

/** The one line a column shows for a base's news. */
export const behindLine = (v: BehindView): string =>
  `↓ ${baseMovedOn(v.from)}: ${count(v.files.length, "file", "files")}${v.overlap.length === 0 ? "" : `, ${v.overlap.length} this thread changed too`}`

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
      : `\nThis thread's proposed changes conflict with it in:\n${named(v.conflicts)}`
  return (
    `${baseMovedOn(v.from)} since this thread's copy was made or last got the latest. Getting it would change ${count(v.files.length, "file", "files")}:\n${named(v.files)}\n` +
    `${overlap}${conflicts}\n` +
    `To merge it into this copy, call \`${GET_LATEST_TOOL}\`, alone in its turn. Nothing is merged until you do.`
  )
}

/** The behind message. */
export const encodeBehind = (
  view: BehindView,
  timestamp: number,
): BehindMessage => BEHIND.encode(view, behindContent(view), timestamp)

/** What a base with new work comes to for a thread. */
export type BaseNews =
  | { readonly kind: "nothing" }
  /** The lane's work changes no file: catch it up before its run, quietly. */
  | { readonly kind: "get-latest" }
  /** The lane has work of its own: tell it, and leave catching up to it. */
  | { readonly kind: "tell"; readonly view: BehindView }

/**
 * Whether a thread's base has news for it, and what to do with it: from the
 * lane's base record and accepted work's (`latestNow`), its proposed changes,
 * the base states it last heard of or merged (`baseKnown`), and the one the
 * host told it while it runs (`told`). Only a lane of its own has a base.
 * `unknown` work never acts, nor a gone base.
 */
export function planBaseNews(input: {
  readonly own: boolean
  readonly base: BaseRecord | undefined
  readonly accepted: AcceptedRecord | null
  readonly proposed: ProposedChangesRecord | undefined
  readonly known: readonly PointId[] | null
  readonly told: PointId | null
}): BaseNews {
  const { base } = input
  if (
    !input.own ||
    base === undefined ||
    (base.kind === "jj" && base.state === "gone")
  )
    return { kind: "nothing" }
  const now = latestNow(base, input.accepted)
  if (now.kind !== "brings") return { kind: "nothing" }
  if (base.work === "none") return { kind: "get-latest" }
  const { to } = now.move
  if (
    base.work !== "some" ||
    input.known?.includes(to) === true ||
    input.told === to
  )
    return { kind: "nothing" }
  const files = base.getLatest?.files ?? []
  const mine = new Set(input.proposed?.files ?? [])
  return {
    kind: "tell",
    view: {
      from: now.move.base,
      to,
      files,
      overlap: files.filter(f => mine.has(f)),
      conflicts: input.proposed?.conflicts ?? [],
    },
  }
}
