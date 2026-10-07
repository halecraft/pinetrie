// stored-from — what a thread caught up with or was told of, as a thread's
// history stores it (ADR-0080): in a fact's `to` and a behind message's
// `from`. History is never rewritten, so accepted work keeps the kind it was
// stored with, `line` (ADR-0100), mapped here to and from `CatchUpFrom`.

import { type CatchUpFrom, isLaneName, type ThreadName } from "@pinetrie/core"
import { type Static, Type } from "typebox"

export const StoredFromSchema = Type.Union([
  Type.Object({ kind: Type.Literal("line") }),
  Type.Object({ kind: Type.Literal("wip"), bookmark: Type.String() }),
  Type.Object({
    kind: Type.Literal("parent"),
    lane: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1 }),
  }),
])

export type StoredFrom = Static<typeof StoredFromSchema>

/** As stored -> as the code knows it; undefined for a parent with a bad lane. */
export const fromStoredFrom = (from: StoredFrom): CatchUpFrom | undefined =>
  from.kind === "line"
    ? { kind: "accepted" }
    : from.kind === "wip"
      ? from
      : isLaneName(from.lane)
        ? { kind: "parent", lane: from.lane, name: from.name as ThreadName }
        : undefined

/** As the code knows it -> as stored. */
export const toStoredFrom = (from: CatchUpFrom): StoredFrom =>
  from.kind === "accepted" ? { kind: "line" } : from
