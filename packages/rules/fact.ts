// fact — what a command on a thread's offer did, as a fact in the thread
// (ADR-0080): an acceptance, a description asked for again, a
// squash, a refresh.
//
// A history message (`history.ts`): `content` is what the model reads,
// `details` the fact, which the column words as one line (`factLine`). It reaches the thread through a queued card carrying the
// fact (`planFactCard`, `card.ts`), popped in order with the other cards: at
// once on an idle thread, when the run ends on a running one.

import type {
  CatchUpFrom,
  OfferAcceptanceDecision,
  OfferFact,
  ThreadId,
  WriterId,
} from "@pinetrie/core"
import { Type } from "typebox"
import { Value } from "typebox/value"
import { CatchUpFromSchema, catchUpName } from "./catch-up-from.ts"
import { ThreadIdSchema, WriterIdSchema } from "./decode.ts"
import { type HistoryMessage, historyMessage } from "./history.ts"

const OfferFactSchema = Type.Union([
  Type.Object({
    kind: Type.Literal("accepted"),
    lane: ThreadIdSchema,
    by: WriterIdSchema,
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
    lane: ThreadIdSchema,
    by: WriterIdSchema,
  }),
])

export const FACT_TYPE = "pinetrie.fact"

export const FACT = historyMessage(FACT_TYPE, OfferFactSchema)

/** The pi `CustomMessage` a fact is stored as. */
export type FactMessage = HistoryMessage<typeof FACT_TYPE, OfferFact>

/** A fact as a card carries it, in the places document's flat strings. */
export const encodeOfferFact = (fact: OfferFact): string => JSON.stringify(fact)

/** A card's stored fact -> the fact; undefined for one malformed. Total. */
export function decodeOfferFact(stored: string): OfferFact | undefined {
  try {
    const fact: unknown = JSON.parse(stored)
    return Value.Check(OfferFactSchema, fact) ? fact : undefined
  } catch {
    return undefined
  }
}

/** A stored message -> its fact, or undefined if it is not one. */
export const decodeFact = (message: unknown): OfferFact | undefined =>
  FACT.decode(message)

/** Where an acceptance went, after "accepted": nothing for accepted work, else a WIP's name. */
const into = (to: CatchUpFrom) =>
  to.kind === "accepted" ? "" : ` into ${catchUpName(to)}`

/** The one line a column shows for a fact. */
export function factLine(fact: OfferFact): string {
  switch (fact.kind) {
    case "accepted":
      return `✓ accepted${into(fact.to)} as ${fact.as.slice(0, 8)}`
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
    case "accepted":
      return `${name} accepted this thread's work${into(fact.to)}, as the change ${fact.as}: ${fact.bookmark} moved forward to it. That work is no longer offered; what you do next is offered on top of it.`
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
): FactMessage => FACT.encode(fact, factContent(fact, name), timestamp)

/**
 * An acceptance's fact (ADR-0080), from the decision it carried out: the change it
 * added, the bookmark it moved, and that bookmark as the thread knows it,
 * accepted work or a WIP. Pure.
 */
export const acceptedFact = (input: {
  readonly lane: ThreadId
  readonly by: WriterId
  readonly decision: Extract<
    OfferAcceptanceDecision,
    { readonly kind: "accept" }
  >
  /** Accepted work's bookmark. */
  readonly acceptedBookmark: string
}): OfferFact => {
  const { destination, top } = input.decision
  return {
    kind: "accepted",
    lane: input.lane,
    by: input.by,
    as: top,
    bookmark: destination,
    to:
      destination === input.acceptedBookmark
        ? { kind: "accepted" }
        : { kind: "wip", bookmark: destination },
  }
}

/** The fact of an offer action that is not an acceptance: what it did, and who asked. Pure. */
export const actionFact = (
  action: "describe" | "squash" | "refresh",
  lane: ThreadId,
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
