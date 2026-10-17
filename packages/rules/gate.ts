// gate — what a person's command, or a send made for one, may do now: refused
// in an archived canvas, in a thread someone holds or trashed, or where a run
// would start on a lane of another kind. A pass is a value only `planGate`
// makes, so a send nobody checked does not compile.

import {
  type ArchivedCanvas,
  atEntry,
  type CanvasId,
  type CardRecord,
  type EntryId,
  ERR,
  entryThread,
  type ForeignLane,
  type Gated,
  type LaneRecord,
  nearestRevision,
  type ProjectKind,
  type Refusal,
  type RevisionRecord,
  type RootId,
  refused,
  type ThreadId,
  type TreeIndex,
  type WriterId,
} from "@pinetrie/core"
import { archivedIn, writesIn } from "./archive.ts"
import type { CanvasIndex } from "./canvas-index.ts"
import {
  foreignIn,
  foreignRefusal,
  heldIn,
  holdingWords,
  runsIn,
  runThreads,
  type ThreadHolding,
} from "./held.ts"

declare const clearedBrand: unique symbol
/**
 * A command the gate let through: `planGate` is its one maker. It proves the
 * check ran, not that its facts still hold, and a spread of it keeps the
 * brand, so a cleared value is passed on, never rebuilt.
 */
export type Cleared<C extends Gated> = C & { readonly [clearedBrand]: true }

/** What the gate reads of a root a branch forks in. */
export interface GateRoot {
  readonly index: TreeIndex
  readonly revisions: ReadonlyMap<EntryId, RevisionRecord>
}

export interface GateFacts {
  readonly canvases: CanvasIndex
  readonly cards: readonly CardRecord[]
  readonly archived: ReadonlyMap<CanvasId, ArchivedCanvas>
  readonly lanes: ReadonlyMap<ThreadId, LaneRecord>
  /** The project's kind; null for a host with no tools, which refuses no lane. */
  readonly kind: ProjectKind | null
  /** The roots the gate asked to read (`read`); empty at first. */
  readonly roots: ReadonlyMap<RootId, GateRoot>
}

/** The gate's refusals, before they are worded (`gateRefusal`). */
type GateRefusal =
  | { readonly kind: "archived"; readonly canvas: ArchivedCanvas }
  | {
      readonly kind: "held"
      readonly thread: ThreadId
      readonly holding: Exclude<ThreadHolding, { readonly kind: "free" }>
    }
  | { readonly kind: "foreign"; readonly lane: ForeignLane }

type GatePlan<C extends Gated> =
  | { readonly kind: "cleared"; readonly command: Cleared<C> }
  | GateRefusal
  /** Read these roots, and plan again: a branch's thread is its root's tree's. */
  | { readonly kind: "read"; readonly roots: readonly RootId[] }

/**
 * Whether `command` may go on. The archive first, which needs no root, so a
 * command it refuses opens none; then the roots a branch forks in, asked for
 * as `read` until `facts.roots` holds them, so no branch passes unread; then
 * a thread held or trashed (a person's own hold is the nearer reason); then
 * a lane of another kind.
 */
export function planGate<C extends Gated>(
  command: C,
  facts: GateFacts,
): GatePlan<C> {
  const canvas = archivedIn(
    writesIn(command, facts.canvases, facts.cards),
    facts.archived,
  )
  if (canvas !== null) return { kind: "archived", canvas }
  const at = runsIn(command)
  const unread = [
    ...new Set(
      at.flatMap(a =>
        a.kind === "entry" && !facts.roots.has(a.root) ? [a.root] : [],
      ),
    ),
  ]
  if (unread.length > 0) return { kind: "read", roots: unread }
  const held = heldIn(
    runThreads(
      at,
      (root, entry) => {
        const read = facts.roots.get(root)
        return read === undefined ? null : entryThread(read.index, entry)
      },
      facts.canvases.forkOf,
    ),
    facts.cards,
  )
  if (held !== null) return { kind: "held", ...held }
  const foreign = foreignIn(at, {
    lanes: facts.lanes,
    kind: facts.kind,
    aboveAt: (root, entry) => {
      const read = facts.roots.get(root)
      return read === undefined
        ? null
        : nearestRevision(read.index, read.revisions, atEntry(entry))
    },
  })
  if (foreign !== null) return { kind: "foreign", lane: foreign }
  return { kind: "cleared", command: command as Cleared<C> }
}

/** A gate's refusal, as the host answers it; `nameOf` names the archiver. */
export function gateRefusal(
  refusal: GateRefusal,
  nameOf: (writer: WriterId) => string,
): Refusal {
  switch (refusal.kind) {
    case "archived":
      return refused(
        ERR.CANVAS_ARCHIVED,
        `archived by ${nameOf(refusal.canvas.by)}: restore the canvas first`,
      )
    case "held":
      return refused(ERR.REFUSED, holdingWords(refusal.holding))
    case "foreign":
      return foreignRefusal(refusal.lane)
  }
}
