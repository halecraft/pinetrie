// catch-up-from — what a catch-up merges or a thread was told of, and every
// wording of it.

import type { BaseMerge, CatchUpFrom } from "@pinetrie/core"
import { Type } from "typebox"
import { ThreadIdSchema, ThreadNameSchema } from "./decode.ts"

/** `CatchUpFrom` as a thread's history stores it: as it is. */
export const CatchUpFromSchema = Type.Union([
  Type.Object({ kind: Type.Literal("accepted") }),
  Type.Object({ kind: Type.Literal("wip"), bookmark: Type.String() }),
  Type.Object({
    kind: Type.Literal("parent"),
    lane: ThreadIdSchema,
    name: ThreadNameSchema,
  }),
])

/** What a merge planned for an update merges, as `catchUpName` words it. */
export const mergedFrom = (merge: BaseMerge): CatchUpFrom =>
  merge.kind === "accepted"
    ? { kind: "accepted" }
    : merge.kind === "wip"
      ? { kind: "wip", bookmark: merge.bookmark }
      : { kind: "parent", lane: merge.lane, name: merge.name }

/**
 * What a catch-up merges, as people read it: accepted work is
 * "accepted work", whatever its bookmark is called; a WIP is its
 * bookmark; the thread a thread branched from is its name. The
 * one place it is worded: the bookmark of accepted work goes in titles only.
 */
export const catchUpName = (from: CatchUpFrom): string =>
  from.kind === "accepted"
    ? "accepted work"
    : from.kind === "wip"
      ? from.bookmark
      : from.name

/** That a thread's base has work the thread lacks, with the base named by `catchUpName`. */
export const baseMovedOn = (from: CatchUpFrom): string =>
  `${catchUpName(from)} has moved on`

/** Whose work a catch-up brings in, as the model reads it in an update and in a resolution's prompt. */
export function incomingWords(from: CatchUpFrom): string {
  switch (from.kind) {
    case "accepted":
      return "Accepted work"
    case "wip":
      return `The work on ${from.bookmark}`
    case "parent":
      return `The work of the thread this one branched from (${from.name})`
  }
}
