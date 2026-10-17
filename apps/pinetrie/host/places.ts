// host/places — the one writer of the places document.
//
// Every write to a card's place is made inside a change (`Places.change`),
// opened with its cause. The change takes each card it touches as it first
// found it, and its close carries out what follows the write, in the order
// `planClose` decides: the texts of the text cards it removed, the cards'
// history and traces (`provenance.ts`), the listeners, and the runs a take
// stops. The history is the session's records, never fields here: a field
// every event changes would refuse each whole undo of a move.
//
// `rev` is raised after each write, in a batch of its own. A client draws a
// move it sent until its copy of the document reaches the `rev` the host
// answered with, so a write that skipped `rev` would leave a client drawing a
// move over a record that has already changed. `rev` stays out of the
// records' batch because that batch may be an undo step: a `rev` raised
// inside it changes with every later write, so every whole undo of the step
// would be refused.

import { isDeepStrictEqual } from "node:util"
import { batch } from "@kyneta/schema"
import {
  type CardHistoryRecord,
  type CardId,
  type CardRecord,
  type EntryId,
  errorText,
  isTextCardId,
  type RootId,
  type TextCardId,
  type ThreadId,
  type TraceRecord,
  type TreeIndex,
  type WriterId,
} from "@pinetrie/core"
import { readPlaces, readThreads, readTreeIndex } from "@pinetrie/reads"
import {
  type Cause,
  encodeCard,
  type PlaceStep,
  type ProvenanceSteps,
  placeEnd,
  planProvenance,
  takenIn,
} from "@pinetrie/rules"
import type { PlacesDocHandle } from "@pinetrie/schema"
import type { Basics } from "./basics.ts"
import type { CardPort } from "./cards.ts"
import type { HostDocuments } from "./docs.ts"
import type { PlacesChange, ProvenanceHooks } from "./provenance.ts"

/** Run a write as one step of an undo stack (`MoveHistories.gesture`). */
export type Gesture = <T>(write: () => T) => T

/** The writer of the places: every write is a change. */
export interface Places {
  /**
   * One change, under `cause`. `body` is called synchronously, so a pop can
   * check and remove with nothing in between. After `body` settles, or
   * throws, the change closes as `planClose` decides. One opened while
   * another is open is a change of its own, which records its own cards.
   */
  change<T>(cause: Cause, body: (open: OpenChange) => T): Promise<Awaited<T>>
}

/** A change while its body runs. */
export interface OpenChange {
  /**
   * Write `steps`, inside `gesture` when given, and return the `rev` after:
   * raised once, or unchanged for no steps. Synchronous.
   */
  apply(steps: readonly PlaceStep[], gesture?: Gesture): number
  /**
   * Kyneta's own revert of `cards` (an undo or a redo): what `write`
   * returned, and the `rev`, raised only if one of `cards` changed. A card
   * a revert removes keeps its text, which a redo brings back.
   */
  revert<R>(
    cards: readonly CardId[],
    write: () => Promise<R>,
  ): Promise<{ readonly result: R; readonly rev: number }>
}

/** What a change's close does, in order (`executeClose`). */
interface ClosePlan {
  /** The texts of the text cards the change's last step on each removed. */
  readonly texts: readonly TextCardId[]
  readonly provenance: ProvenanceSteps
  /** The threads a person's change took into an inventory or a trash, and who: null for none. */
  readonly taken: {
    readonly threads: readonly ThreadId[]
    readonly by: WriterId
  } | null
  /** What the listeners hear. */
  readonly change: PlacesChange
}

/**
 * What a change's close does. History and takes are read from the touched
 * cards alone, as the change first found them and as they are now, so what
 * another change wrote meanwhile is not this one's. A host's change takes no
 * run.
 */
export function planClose(input: {
  /** Each touched card as the change first found it: absent for one it made. */
  readonly touched: ReadonlyMap<CardId, CardRecord | undefined>
  /** Each touched shared card's thread end when the change first touched it. */
  readonly ends: ReadonlyMap<CardId, EntryId | null>
  /** Every step `apply` wrote, in order; a revert's are not among them. */
  readonly applied: readonly PlaceStep[]
  /** The places now. */
  readonly cards: readonly CardRecord[]
  readonly cause: Cause
  readonly histories: ReadonlyMap<CardId, CardHistoryRecord>
  readonly traces: readonly TraceRecord[]
  readonly reading: readonly (readonly [WriterId, EntryId])[]
  readonly now: number
  readonly newId: () => string
}): ClosePlan {
  const { touched, cause } = input
  const before = [...touched.values()].filter(
    (c): c is CardRecord => c !== undefined,
  )
  const after = input.cards.filter(c => touched.has(c.id))
  const last = new Map<CardId, PlaceStep["kind"]>()
  for (const step of input.applied)
    last.set(step.kind === "write" ? step.record.id : step.id, step.kind)
  const texts = [...last].flatMap(([id, kind]) =>
    kind === "remove" && isTextCardId(id) ? [id] : [],
  )
  return {
    texts,
    provenance: planProvenance({
      before,
      after,
      cause,
      histories: input.histories,
      traces: input.traces,
      reading: input.reading,
      ends: input.ends,
      now: input.now,
      newId: input.newId,
    }),
    taken: takenBy(cause, takenIn(before, after)),
    change: { before, after, places: input.cards, cause },
  }
}

/** The threads a person's change took, and who took them; a host's change takes none. */
const takenBy = (
  cause: Cause,
  threads: readonly ThreadId[],
): ClosePlan["taken"] =>
  cause.kind === "host" || threads.length === 0
    ? null
    : { threads, by: cause.by }

interface PlacesDeps {
  readonly basics: Pick<
    Basics,
    "places" | "session" | "now" | "newId" | "log"
  > & {
    /** A shared card's thread end is read from its root only when loaded. */
    readonly docs: Pick<HostDocuments, "view">
  }
  readonly provenance: ProvenanceHooks
  readonly texts: Pick<CardPort, "destroy">
}

export function createPlaces(deps: PlacesDeps): Places {
  const { docs, places, session } = deps.basics

  /** A shared card's thread end, from its thread's loaded root; absent otherwise. */
  function endOf(
    card: CardRecord,
    trees: Map<RootId, TreeIndex | null>,
  ): EntryId | null | undefined {
    const p = card.place
    if (p.kind !== "composing" && p.kind !== "queued" && p.kind !== "pinned")
      return undefined
    const root = readThreads(session).get(p.thread)?.root
    if (root === undefined) return undefined
    if (!trees.has(root)) {
      const held = docs.view(root)
      trees.set(root, held === null ? null : readTreeIndex(held.doc))
    }
    const index = trees.get(root) ?? null
    return index === null ? undefined : placeEnd(p, index)
  }

  function open(cause: Cause): {
    readonly change: OpenChange
    readonly close: () => Promise<void>
  } {
    const touched = new Map<CardId, CardRecord | undefined>()
    const ends = new Map<CardId, EntryId | null>()
    const applied: PlaceStep[] = []
    // One index per root, however many cards the change touches.
    const trees = new Map<RootId, TreeIndex | null>()

    /** Take each card not yet touched as it is now, with its thread end. */
    const touch = (ids: readonly CardId[]) => {
      const fresh = ids.filter(id => !touched.has(id))
      if (fresh.length === 0) return
      const now = byId(readPlaces(places))
      for (const id of fresh) {
        const card = now.get(id)
        touched.set(id, card)
        const end = card === undefined ? undefined : endOf(card, trees)
        if (end !== undefined) ends.set(id, end)
      }
    }

    const change: OpenChange = {
      apply(steps, gesture) {
        touch(steps.map(s => (s.kind === "write" ? s.record.id : s.id)))
        applied.push(...steps)
        return writeSteps(places, steps, gesture)
      },
      async revert(cards, write) {
        touch(cards)
        const was = byId(readPlaces(places))
        const result = await write()
        const now = byId(readPlaces(places))
        const changed = cards.some(
          id => !isDeepStrictEqual(was.get(id), now.get(id)),
        )
        return { result, rev: changed ? raiseRev(places) : places.rev() }
      },
    }

    async function close(): Promise<void> {
      // gather, as the change left the places
      const facts = deps.provenance.gather()
      // plan
      const plan = planClose({
        touched,
        ends,
        applied,
        cards: readPlaces(places),
        cause,
        ...facts,
        now: deps.basics.now(),
        newId: deps.basics.newId,
      })
      // execute: each text after its record, which the body wrote
      await executeClose(plan, {
        destroy: deps.texts.destroy,
        provenance: deps.provenance,
      })
    }

    return { change, close }
  }

  async function change<T>(
    cause: Cause,
    body: (open: OpenChange) => T,
  ): Promise<Awaited<T>> {
    const opened = open(cause)
    let result: Awaited<T>
    try {
      result = await body(opened.change)
    } catch (error) {
      // The body's error is what its caller hears; the close's is logged.
      await opened
        .close()
        .catch((closing: unknown) =>
          deps.basics.log(
            `[host] a change to the places did not close: ${errorText(closing)}`,
          ),
        )
      throw error
    }
    await opened.close()
    return result
  }

  return { change }
}

/**
 * Carry out a close: the texts, then the history and traces in one write,
 * then the listeners, then the stops of the runs a take ended.
 */
async function executeClose(
  plan: ClosePlan,
  ports: {
    readonly destroy: (id: TextCardId) => Promise<void>
    readonly provenance: Pick<ProvenanceHooks, "write" | "changed" | "taken">
  },
): Promise<void> {
  for (const id of plan.texts) await ports.destroy(id)
  await ports.provenance.write(plan.provenance)
  ports.provenance.changed(plan.change)
  if (plan.taken !== null)
    await ports.provenance.taken(plan.taken.threads, plan.taken.by)
}

const byId = (cards: readonly CardRecord[]): ReadonlyMap<CardId, CardRecord> =>
  new Map<CardId, CardRecord>(cards.map(c => [c.id, c]))

/** Write `steps`, inside `gesture` when given; then raise `rev`. */
function writeSteps(
  places: PlacesDocHandle,
  steps: readonly PlaceStep[],
  gesture?: Gesture,
): number {
  if (steps.length === 0) return places.rev()
  const write = () =>
    batch(places, d => {
      for (const step of steps)
        if (step.kind === "write")
          d.cards.set(step.record.id, encodeCard(step.record))
        else d.cards.delete(step.id)
    })
  if (gesture === undefined) write()
  else gesture(write)
  return raiseRev(places)
}

/** Raise `rev` in a batch of its own, and return it. */
function raiseRev(places: PlacesDocHandle): number {
  const rev = places.rev() + 1
  batch(places, d => d.rev.set(rev))
  return rev
}
