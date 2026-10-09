// host/provenance — each card's history and the traces left where someone
// else moved your card (ADR-0048 step 6), written after every change to the
// places, in the step that made it. `before` is read at the step's start;
// `after` reads the places as the write left them, plans with
// `planProvenance` (`@pinetrie/rules`) and writes the records in one call.
// The records are the session's, never the places': a field there would
// refuse each whole undo of a move (S82).

import type {
  CardId,
  CardRecord,
  EntryId,
  RootId,
  ThreadId,
  TreeIndex,
  WriterId,
} from "@pinetrie/core"
import {
  readCardHistories,
  readPlaces,
  readReading,
  readThreads,
  readTraces,
  readTreeIndex,
} from "@pinetrie/reads"
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
  takenIn,
} from "@pinetrie/rules"
import type { PresenceDocHandle } from "@pinetrie/schema"
import type { Basics } from "./basics.ts"
import type { Records } from "./records.ts"

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
  /**
   * Call `listener` after each change `after` records, with the places
   * before and after it and its cause: what tells a running thread its
   * task's canvas changed (`canvas-news.ts`, ADR-0116). Never awaited.
   */
  onChanged(listener: (change: PlacesChange) => void): void
  /**
   * Call `stop` after each change a person made that takes threads into an
   * inventory (`takenIn`), with those threads and who made it: their runs
   * stop with it, whatever wrote it (ADR-0124). Awaited in `after`, in the
   * step that made the change.
   */
  onTaken(
    stop: (threads: readonly ThreadId[], by: WriterId) => Promise<void>,
  ): void
}

/** One change to the places, as `after` read it. */
export interface PlacesChange {
  readonly before: readonly CardRecord[]
  readonly after: readonly CardRecord[]
  readonly cause: Cause
}

export interface ProvenanceDeps {
  readonly basics: Pick<Basics, "docs" | "places" | "session" | "now" | "newId">
  readonly presence: PresenceDocHandle
  readonly records: Pick<Records, "writeValues">
}

/**
 * Each card's thread end, from its thread's loaded root, for a card at
 * one: your message, a queued or a pinned card; a card in a root
 * not loaded, or at a thread with no record, is left out, and counts as
 * unwatched.
 */
export function endsOf(
  cards: readonly CardRecord[],
  view: (thread: ThreadId) => TreeIndex | null,
): ReadonlyMap<CardId, EntryId | null> {
  const ends = new Map<CardId, EntryId | null>()
  for (const c of cards) {
    const p = c.place
    if (p.kind !== "composing" && p.kind !== "queued" && p.kind !== "pinned")
      continue
    const index = view(p.thread)
    if (index !== null) ends.set(c.id, placeEnd(p, index))
  }
  return ends
}

export function createProvenance(deps: ProvenanceDeps): Provenance {
  const { docs, places, session } = deps.basics

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
    if (writes.length > 0) await deps.records.writeValues(writes)
  }

  const listeners: ((change: PlacesChange) => void)[] = []
  const stoppers: ((
    threads: readonly ThreadId[],
    by: WriterId,
  ) => Promise<void>)[] = []

  return {
    before() {
      const cards = readPlaces(places)
      // One index per root, however many cards it holds.
      const roots = new Map<RootId, TreeIndex | null>()
      const threads = readThreads(session)
      const view = (thread: ThreadId) => {
        const root = threads.get(thread)?.root
        if (root === undefined) return null
        if (!roots.has(root)) {
          const held = docs.view(root)
          roots.set(root, held === null ? null : readTreeIndex(held.doc))
        }
        return roots.get(root) ?? null
      }
      return { cards, ends: endsOf(cards, view) }
    },

    async after(cause, before) {
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
      for (const listener of listeners)
        listener({ before: facts.before, after: facts.after, cause })
      // plan, then execute: the records, then the runs of the threads the
      // change took stopped (the host's own writes take none)
      const taken =
        cause.kind === "host" ? [] : takenIn(facts.before, facts.after)
      await write(planProvenance(facts))
      if (cause.kind !== "host" && taken.length > 0)
        for (const stop of stoppers) await stop(taken, cause.by)
    },

    onChanged(listener) {
      listeners.push(listener)
    },

    onTaken(stop) {
      stoppers.push(stop)
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
