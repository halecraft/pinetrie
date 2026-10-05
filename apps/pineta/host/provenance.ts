// host/provenance — each card's history and the traces left where someone
// else moved your card (ADR-0048 step 6), written after every change to the
// places, in the step that made it. `before` is read at the step's start;
// `after` reads the places as the write left them, plans with
// `planProvenance` (`@pineta/rules`) and writes the records in one call.
// The records are the session's, never the places': a field there would
// refuse each whole undo of a move (S82).

import type {
  CardId,
  CardRecord,
  EntryId,
  LaneView,
  RootId,
  TreeIndex,
  WriterId,
} from "@pineta/core"
import type { Agent } from "@pineta/pi"
import {
  readCardHistories,
  readLanes,
  readPlaces,
  readQueueHolds,
  readReading,
  readTraces,
  readTreeIndex,
} from "@pineta/reads"
import {
  CARD_HISTORY,
  type Cause,
  deleteRecord,
  type ProvenanceSteps,
  placeEnd,
  planProvenance,
  planTraceSweep,
  setRecord,
  TRACE,
} from "@pineta/rules"
import type { PresenceDocHandle } from "@pineta/schema"
import type { Basics } from "./basics.ts"

/** The places as a step found them, and each shared card's thread end then. */
export interface Before {
  readonly cards: readonly CardRecord[]
  /** Absent for a card whose root is not loaded. */
  readonly ends: ReadonlyMap<CardId, EntryId | null>
}

export interface Provenance {
  /** Read at the start of a step that writes the places. */
  before(): Before
  /** After the step's write: the history and traces it calls for. */
  after(cause: Cause, before: Before): Promise<void>
  /** Delete the traces `writer` has seen; others' ids are ignored. */
  seen(writer: WriterId, ids: readonly string[]): Promise<void>
  /** Old traces, and histories whose card is gone (`planTraceSweep`). */
  sweep(): Promise<void>
}

export interface ProvenanceDeps {
  readonly basics: Pick<
    Basics,
    "docs" | "live" | "places" | "session" | "now" | "newId"
  >
  readonly presence: PresenceDocHandle
  readonly agent: () => Pick<Agent, "writeValues">
}

/**
 * Each drafting, queued or pinned card's thread end, from its loaded root;
 * a card in a root not loaded is left out, and counts as unwatched.
 */
export function endsOf(
  cards: readonly CardRecord[],
  view: (
    root: RootId,
  ) => { index: TreeIndex; lanes: readonly LaneView[] } | null,
): ReadonlyMap<CardId, EntryId | null> {
  const ends = new Map<CardId, EntryId | null>()
  for (const c of cards) {
    const p = c.place
    if (p.kind !== "drafting" && p.kind !== "queued" && p.kind !== "pinned")
      continue
    const root = view(p.root)
    if (root !== null)
      ends.set(c.id, placeEnd(p, c.owner, root.lanes, root.index))
  }
  return ends
}

export function createProvenance(deps: ProvenanceDeps): Provenance {
  const { docs, live, places, session } = deps.basics

  const write = async (steps: ProvenanceSteps): Promise<void> => {
    const writes = [
      ...steps.histories.map(s =>
        s.kind === "set"
          ? setRecord(CARD_HISTORY, s.record)
          : deleteRecord(CARD_HISTORY, s.key),
      ),
      ...steps.traces.map(s =>
        s.kind === "set"
          ? setRecord(TRACE, s.record)
          : deleteRecord(TRACE, s.key),
      ),
    ]
    if (writes.length > 0) await deps.agent().writeValues(writes)
  }

  return {
    before() {
      const cards = readPlaces(places)
      // One index and one lane read per root, however many cards it holds.
      const roots = new Map<
        RootId,
        { index: TreeIndex; lanes: readonly LaneView[] } | null
      >()
      const view = (root: RootId) => {
        if (!roots.has(root)) {
          const held = docs.view(root)
          if (held === null) roots.set(root, null)
          else {
            const index = readTreeIndex(held.doc)
            const lanes = readLanes(
              { doc: held.doc, live },
              index,
              cards,
              readQueueHolds(session),
            )
            roots.set(root, { index, lanes })
          }
        }
        return roots.get(root) ?? null
      }
      return { cards, ends: endsOf(cards, view) }
    },

    after(cause, before) {
      // gather
      const facts = {
        before: before.cards,
        after: readPlaces(places),
        cause,
        histories: readCardHistories(session),
        traces: [...readTraces(session).values()],
        reading: readReading(deps.presence),
        ends: before.ends,
        now: deps.basics.now(),
        newId: deps.basics.newId,
      }
      // plan, then execute
      return write(planProvenance(facts))
    },

    seen(writer, ids) {
      const traces = readTraces(session)
      return write({
        histories: [],
        traces: ids.flatMap(id =>
          traces.get(id)?.for === writer ? [{ kind: "delete", key: id }] : [],
        ),
      })
    },

    sweep() {
      return write(
        planTraceSweep({
          traces: [...readTraces(session).values()],
          histories: readCardHistories(session),
          cards: readPlaces(places),
          now: deps.basics.now(),
        }),
      )
    },
  }
}
