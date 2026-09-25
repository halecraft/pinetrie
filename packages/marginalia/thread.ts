// thread — who is compelled by default, set at an entry and inherited below it.
//
// A thread is a branch point and everything under it. Setting a default at an
// entry makes every message beneath it inherit that default, until a deeper
// entry sets its own. Above every setting is the session's root, which is a
// working session: the first person into the app is most likely alone and
// trying to get work done. Stored as pi values in THREAD_NAMESPACE, keyed by the
// entry id they are set at, so two threads never share an address (ADR-0016).

import {
  type AgentId,
  type EntryId,
  type Position,
  type Responder,
  THE_AGENT,
} from "@pineta/core"
import { Type } from "typebox"
import { decodeWith } from "./decode.ts"

export const THREAD_NAMESPACE = "pineta.thread"

/** The default where no ancestor sets one: the agent answers every message. */
export const ROOT_DEFAULT: Responder = { kind: "agent", agent: THE_AGENT }

const DefaultSchema = Type.Union([
  Type.Object({ kind: Type.Literal("none") }),
  Type.Object({ kind: Type.Literal("agent"), agent: Type.String() }),
])

/** A stored default -> a `Responder`, or undefined if malformed. */
export const decodeThreadDefault = (value: unknown): Responder | undefined =>
  decodeWith(DefaultSchema, value, d =>
    d.kind === "agent"
      ? { kind: "agent", agent: d.agent as AgentId }
      : { kind: "none" },
  )

/** Stored `pineta.thread` values -> the defaults, by the entry they are set at. */
export function threadDefaults(
  values: Iterable<{ readonly key: string; readonly value: unknown }>,
): ReadonlyMap<EntryId, Responder> {
  const out = new Map<EntryId, Responder>()
  for (const { key, value } of values) {
    const d = decodeThreadDefault(value)
    if (d !== undefined) out.set(key as EntryId, d)
  }
  return out
}

/**
 * The default in force at `at`: the one set at `at` or its nearest ancestor,
 * found by walking `parentOf`. With none set, `ROOT_DEFAULT`. Pure; a cycle
 * stops the walk.
 */
export function effectiveDefault(
  at: Position,
  parentOf: (id: EntryId) => EntryId | null,
  defaults: ReadonlyMap<EntryId, Responder>,
): Responder {
  const seen = new Set<EntryId>()
  let id: EntryId | null = at.kind === "root" ? null : at.id
  while (id !== null && !seen.has(id)) {
    const set = defaults.get(id)
    if (set !== undefined) return set
    seen.add(id)
    id = parentOf(id)
  }
  return ROOT_DEFAULT
}
