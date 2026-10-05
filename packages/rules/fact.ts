// fact — what a command on a thread's offer did, as a fact in the thread
// (ADR-0080): an offer integration, a description asked for again, a
// squash, a refresh.
//
// A fact message is a pi `CustomMessage` in `update.ts`'s pattern: `content`
// is what the model reads, `details` the fact, which the column words as one
// line (`factLine`). It reaches the thread through a queued card carrying the
// fact (`planFactCard`, `card.ts`), popped in order with the other cards: at
// once on an idle thread, when the run ends on a running one.

import {
  type CatchUpFrom,
  isLaneName,
  type LaneName,
  type OfferFact,
  type OfferIntegrationDecision,
  type ThreadName,
  type WriterId,
} from "@pineta/core"
import { type Static, Type } from "typebox"
import { decodeWith } from "./decode.ts"
import { catchUpName } from "./line.ts"

export const FACT_TYPE = "pineta.fact"

const CatchUpFromSchema = Type.Union([
  Type.Object({ kind: Type.Literal("line") }),
  Type.Object({ kind: Type.Literal("wip"), bookmark: Type.String() }),
  Type.Object({
    kind: Type.Literal("parent"),
    lane: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1 }),
  }),
])

const OfferFactSchema = Type.Union([
  Type.Object({
    kind: Type.Literal("integrated"),
    lane: Type.String({ minLength: 1 }),
    by: Type.String(),
    as: Type.String({ minLength: 1 }),
    bookmark: Type.String({ minLength: 1 }),
    to: CatchUpFromSchema,
  }),
  Type.Object({
    kind: Type.Union([
      Type.Literal("described"),
      Type.Literal("squashed"),
      Type.Literal("refreshed"),
    ]),
    lane: Type.String({ minLength: 1 }),
    by: Type.String(),
  }),
])

const FactSchema = Type.Object({
  role: Type.Literal("custom"),
  customType: Type.Literal(FACT_TYPE),
  details: OfferFactSchema,
})

/** The pi `CustomMessage` a fact is stored as. */
export interface FactMessage {
  readonly role: "custom"
  readonly customType: typeof FACT_TYPE
  readonly content: string
  readonly display: true
  readonly details: OfferFact
  readonly timestamp: number
}

const storedTo = (
  to: Static<typeof CatchUpFromSchema>,
): CatchUpFrom | undefined =>
  to.kind !== "parent"
    ? to
    : isLaneName(to.lane)
      ? { kind: "parent", lane: to.lane, name: to.name as ThreadName }
      : undefined

/** A fact as stored -> the fact; undefined for one malformed. Total. */
const fromStored = (
  d: Static<typeof OfferFactSchema>,
): OfferFact | undefined => {
  if (!isLaneName(d.lane)) return undefined
  if (d.kind !== "integrated")
    return { kind: d.kind, lane: d.lane, by: d.by as WriterId }
  const to = storedTo(d.to)
  return to === undefined
    ? undefined
    : {
        kind: "integrated",
        lane: d.lane,
        by: d.by as WriterId,
        as: d.as,
        bookmark: d.bookmark,
        to,
      }
}

/** A fact as a card carries it, in the places document's flat strings. */
export const encodeOfferFact = (fact: OfferFact): string => JSON.stringify(fact)

/** A card's stored fact -> the fact; undefined for one malformed. Total. */
export function decodeOfferFact(stored: string): OfferFact | undefined {
  try {
    return decodeWith(OfferFactSchema, JSON.parse(stored), fromStored)
  } catch {
    return undefined
  }
}

/** A stored message -> its fact, or undefined if it is not one. */
export const decodeFact = (message: unknown): OfferFact | undefined =>
  decodeWith(FactSchema, message, ({ details }) => fromStored(details))

/** The one line a column shows for a fact. */
export function factLine(fact: OfferFact): string {
  switch (fact.kind) {
    case "integrated":
      return `✓ added to ${catchUpName(fact.to)} as ${fact.as.slice(0, 8)}`
    case "described":
      return "✎ a new description was asked for"
    case "squashed":
      return "⇣ the stack was squashed into one revision"
    case "refreshed":
      return "↻ the offer was rebuilt from this thread's work"
  }
}

/** What the model reads of a fact: who did what to this thread's work. */
export function factContent(fact: OfferFact, name: string): string {
  switch (fact.kind) {
    case "integrated":
      return `${name} added this thread's work to ${catchUpName(fact.to)}, as the change ${fact.as}: ${fact.bookmark} moved forward to it. That work is no longer offered; what you do next is offered on top of it.`
    case "described":
      return `${name} asked for a new description of this thread's offer.`
    case "squashed":
      return `${name} squashed this thread's offer back into one revision.`
    case "refreshed":
      return `${name} rebuilt this thread's offer from your work as it is now, discarding their edits to it.`
  }
}

/** The fact message, its content naming the person as `name`. */
export const encodeFact = (
  fact: OfferFact,
  name: string,
  timestamp: number,
): FactMessage => ({
  role: "custom",
  customType: FACT_TYPE,
  content: factContent(fact, name),
  display: true,
  details: fact,
  timestamp,
})

/**
 * An offer integration's fact (ADR-0080), from the decision it carried out: the change it
 * added, the bookmark it moved, and that bookmark as the thread knows it,
 * the line or a WIP. Pure.
 */
export const integratedFact = (input: {
  readonly lane: LaneName
  readonly by: WriterId
  readonly decision: Extract<
    OfferIntegrationDecision,
    { readonly kind: "integrate" }
  >
  /** The line's bookmark. */
  readonly onto: string
}): OfferFact => {
  const { destination, top } = input.decision
  return {
    kind: "integrated",
    lane: input.lane,
    by: input.by,
    as: top,
    bookmark: destination,
    to:
      destination === input.onto
        ? { kind: "line" }
        : { kind: "wip", bookmark: destination },
  }
}

/** The fact of an offer action that is not an integration: what it did, and who asked. Pure. */
export const actionFact = (
  action: "describe" | "squash" | "refresh",
  lane: LaneName,
  by: WriterId,
): OfferFact => ({
  kind:
    action === "describe"
      ? "described"
      : action === "squash"
        ? "squashed"
        : "refreshed",
  lane,
  by,
})
