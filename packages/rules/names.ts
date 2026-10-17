// names — a thread's name as people say it. Stored, since a name computed at
// every read could collide unseen, and a changed list would rename every
// thread.

import {
  fnv1a,
  NAME_PAIRS,
  type NameRecord,
  namePair,
  type ThreadId,
  type ThreadName,
} from "@pinetrie/core"
import { Type } from "typebox"
import { decodeRecord, threadKey } from "./decode.ts"
import type { RecordSpec } from "./records.ts"

/**
 * A lane's name: the pair its id hashes to, or the next free one after it,
 * wrapping. Throws only when all 65,536 are in use.
 */
export function threadNameFor(
  lane: ThreadId,
  inUse: ReadonlySet<string>,
): ThreadName {
  const first = fnv1a(lane) % NAME_PAIRS
  for (let step = 0; step < NAME_PAIRS; step += 1) {
    const name = namePair((first + step) % NAME_PAIRS)
    if (!inUse.has(name)) return name as ThreadName
  }
  throw new Error("every thread name is in use")
}

/**
 * A lane as people read it: its name, or, before the host has named it, the
 * last eight characters of its id. The one rule for a thread named in a
 * sentence or a mark, on the host and the page.
 */
export const readableThreadName = (
  names: ReadonlyMap<ThreadId, ThreadName>,
  lane: ThreadId,
): string => names.get(lane) ?? lane.slice(-8)

/**
 * A name for each lane that has none, oldest lane first, each avoiding the
 * names stored and those planned before it. What the host writes at start,
 * when it creates a lane, and when a column reserves one (`planReserve`).
 */
export function planNames(
  lanes: readonly { readonly lane: ThreadId; readonly createdAt: number }[],
  names: ReadonlyMap<ThreadId, ThreadName>,
  now: number,
): readonly NameRecord[] {
  const inUse = new Set<string>(names.values())
  const named = new Set<ThreadId>(names.keys())
  const planned: NameRecord[] = []
  for (const { lane } of [...lanes].sort((a, b) => a.createdAt - b.createdAt)) {
    if (named.has(lane)) continue
    const name = threadNameFor(lane, inUse)
    inUse.add(name)
    named.add(lane)
    planned.push({ lane, name, at: now })
  }
  return planned
}

/** What a `reserve` command does. */
export type ReservePlan =
  /** The id already has a name: nothing to write. */
  | { readonly kind: "known" }
  /** pi holds a lane by this id: it is no thread to come. */
  | { readonly kind: "held" }
  | { readonly kind: "name"; readonly record: NameRecord }

/**
 * Name a thread whose lane does not exist yet, as `planNames` names a lane:
 * the pair its id hashes to, or the next free one. `held` is every lane pi
 * holds.
 */
export function planReserve(
  lane: ThreadId,
  held: ReadonlySet<string>,
  names: ReadonlyMap<ThreadId, ThreadName>,
  now: number,
): ReservePlan {
  if (names.has(lane)) return { kind: "known" }
  if (held.has(lane)) return { kind: "held" }
  const name = threadNameFor(lane, new Set(names.values()))
  return { kind: "name", record: { lane, name, at: now } }
}

const NameRecordSchema = Type.Object({
  name: Type.String({ pattern: "^[a-z]+-[a-z]+$" }),
  at: Type.Number(),
})

/** Each thread's name, `word-word`, at its lane. */
export const NAME: RecordSpec<NameRecord, ThreadId, "session"> = {
  namespace: "pinetrie.name",
  home: "session",
  keyOf: r => r.lane,
  encode: ({ lane, ...contents }) => contents,
  decode: (contents, key) =>
    decodeRecord(NameRecordSchema, contents, threadKey(key), (r, lane) => ({
      lane,
      name: r.name as ThreadName,
      at: r.at,
    })),
}
