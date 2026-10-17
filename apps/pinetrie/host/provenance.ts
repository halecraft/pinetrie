// host/provenance — each card's history and the traces left where someone else
// moved your card, written by the close of the change that moved it
// (`places.ts`), in the same step. The records are the session's, never the
// places': a field there would refuse each whole undo of a move.

import type {
  CardHistoryRecord,
  CardId,
  CardRecord,
  EntryId,
  ThreadId,
  TraceRecord,
  WriterId,
} from "@pinetrie/core"
import {
  readCardHistories,
  readPlaces,
  readReading,
  readTraces,
} from "@pinetrie/reads"
import {
  CARD_HISTORY,
  type Cause,
  deleteRecord,
  type ProvenanceSteps,
  planTraceSweep,
  setRecord,
  TRACE,
} from "@pinetrie/rules"
import type { PresenceDocHandle } from "@pinetrie/schema"
import type { Basics } from "./basics.ts"
import type { Records } from "./records.ts"

export interface Provenance {
  /** Delete the traces `writer` has seen; others' ids are ignored. */
  seen(writer: WriterId, ids: readonly string[]): Promise<void>
  /** Old traces, and histories whose card is gone (`planTraceSweep`). */
  sweep(): Promise<void>
  /**
   * Call `listener` after each change to the places, with the cards it
   * touched before and after it, the places after it, and its cause: what
   * tells a running thread its canvas changed (`canvas-news.ts`).
   * Never awaited.
   */
  onChanged(listener: (change: PlacesChange) => void): void
  /**
   * Call `stop` after each change a person made that takes threads into an
   * inventory (`takenIn`), with those threads and who made it: their runs stop
   * with it, whatever wrote it. Awaited in the change's close, in the step
   * that made the change.
   */
  onTaken(
    stop: (threads: readonly ThreadId[], by: WriterId) => Promise<void>,
  ): void
}

/** One change to the places, as its close read it. */
export interface PlacesChange {
  /** The cards it touched, as it first found them. */
  readonly before: readonly CardRecord[]
  /** The cards it touched, as it left them. */
  readonly after: readonly CardRecord[]
  /** Every card, as it left them. */
  readonly places: readonly CardRecord[]
  readonly cause: Cause
}

/**
 * What a change's close reads and calls (`places.ts`): only the writer of
 * the places takes it, so no other module records a change.
 */
export interface ProvenanceHooks {
  /** The records and presence `planProvenance` reads. */
  gather(): {
    readonly histories: ReadonlyMap<CardId, CardHistoryRecord>
    readonly traces: readonly TraceRecord[]
    readonly reading: readonly (readonly [WriterId, EntryId])[]
  }
  /** The history and traces, in one write. */
  write(steps: ProvenanceSteps): Promise<void>
  /** Tell each `onChanged` listener. */
  changed(change: PlacesChange): void
  /** Stop the runs of the threads a person's change took, as each `onTaken` says. */
  taken(threads: readonly ThreadId[], by: WriterId): Promise<void>
}

interface ProvenanceDeps {
  readonly basics: Pick<Basics, "places" | "session" | "now">
  readonly presence: PresenceDocHandle
  readonly records: Pick<Records, "writeValues">
}

export function createProvenance(deps: ProvenanceDeps): {
  readonly provenance: Provenance
  readonly hooks: ProvenanceHooks
} {
  const { places, session } = deps.basics

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

  const provenance: Provenance = {
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

  const hooks: ProvenanceHooks = {
    gather: () => ({
      histories: readCardHistories(session),
      traces: [...readTraces(session).values()],
      reading: readReading(deps.presence),
    }),
    write,
    changed(change) {
      for (const listener of listeners) listener(change)
    },
    async taken(threads, by) {
      for (const stop of stoppers) await stop(threads, by)
    },
  }

  return { provenance, hooks }
}
