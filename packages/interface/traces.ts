// interface/traces — which of your traces a column draws, and how they group. A
// trace stays where your card was when someone else moved it while you were
// away; the host leaves it (`planProvenance`) and deletes it once you have seen
// it (`traces-seen`).

import type {
  EntryId,
  TracedPlace,
  TraceRecord,
  WriterId,
} from "@pinetrie/core"
import { MAX_TRACES_SEEN } from "@pinetrie/protocol/codec"
import { changeVerb, type Verb } from "@pinetrie/rules"

/** Traces at one spot by one person, doing one thing: one line. */
export interface TraceGroup {
  readonly by: WriterId
  readonly verb: Verb
  readonly traces: readonly TraceRecord[]
}

/**
 * Your traces whose place resolves to this thread's end, oldest first.
 * `endOf` resolves a place as a card there would (`placeEnd`), so a trace
 * follows its thread as the thread grows.
 */
export function endTraces(
  traces: Iterable<TraceRecord>,
  me: WriterId,
  end: EntryId,
  endOf: (from: TracedPlace) => EntryId | null,
): readonly TraceRecord[] {
  return [...traces]
    .filter(t => t.for === me && endOf(t.from) === end)
    .sort((a, b) => a.at - b.at)
}

/** One group per person and verb, in the order each first happened. */
export function traceGroups(
  traces: readonly TraceRecord[],
): readonly TraceGroup[] {
  const groups: { by: WriterId; verb: Verb; traces: TraceRecord[] }[] = []
  for (const t of traces) {
    const verb = changeVerb(t.from, t.to)
    const group = groups.find(g => g.by === t.by && g.verb === verb)
    if (group === undefined) groups.push({ by: t.by, verb, traces: [t] })
    else group.traces.push(t)
  }
  return groups
}

/**
 * What a column draws: the traces here now, and those it drew since it
 * mounted, which the host has deleted once seen. So a trace does not vanish
 * under its reader. Oldest first.
 */
export function keptTraces(
  drawn: ReadonlyMap<string, TraceRecord>,
  live: readonly TraceRecord[],
): readonly TraceRecord[] {
  const all = new Map(drawn)
  for (const t of live) all.set(t.id, t)
  return [...all.values()].sort((a, b) => a.at - b.at)
}

/** Trace ids in batches the host takes (`MAX_TRACES_SEEN` each). */
export function seenBatches(
  ids: readonly string[],
  size = MAX_TRACES_SEEN,
): readonly (readonly string[])[] {
  const out: string[][] = []
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size))
  return out
}
