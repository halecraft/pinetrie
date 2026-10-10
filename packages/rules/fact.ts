// fact — what the host records in a thread (ADR-0080, ADR-0126): what a
// command on its offer did (an acceptance, a description asked for again, a
// squash, a refresh), who stopped a run, a member dismissed or gone, and a
// budget spent (ADR-0128).
//
// A history message (`history.ts`): `content` is what the model reads,
// `details` the fact, which the column words as one line (`factLine`). It
// reaches the thread through a fact card (`planFactCard`, `queue.ts`),
// popped with the other cards: at once on an idle thread, when the run ends
// on a running one.

import type {
  CatchUpFrom,
  OfferAcceptanceDecision,
  OfferFact,
  QueuedFact,
  TextCardId,
  TextSource,
  ThreadId,
  WriterId,
} from "@pinetrie/core"
import { Type } from "typebox"
import { Value } from "typebox/value"
import { CatchUpFromSchema, catchUpName } from "./catch-up-from.ts"
import { EntryIdSchema, ThreadIdSchema, WriterIdSchema } from "./decode.ts"
import { type HistoryMessage, historyMessage } from "./history.ts"
import { askLine } from "./relay.ts"

const QueuedFactSchema = Type.Union([
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
  Type.Object({
    kind: Type.Literal("stopped"),
    lane: ThreadIdSchema,
    prompt: EntryIdSchema,
    by: WriterIdSchema,
    at: Type.Number(),
    budget: Type.Optional(EntryIdSchema),
  }),
  Type.Object({
    kind: Type.Union([Type.Literal("dismissed"), Type.Literal("left")]),
    lane: ThreadIdSchema,
    member: ThreadIdSchema,
    by: WriterIdSchema,
  }),
  Type.Object({
    kind: Type.Literal("round"),
    lane: ThreadIdSchema,
    line: Type.String(),
    by: WriterIdSchema,
  }),
  Type.Object({
    kind: Type.Literal("unanswered"),
    lane: ThreadIdSchema,
    member: ThreadIdSchema,
    why: Type.Union([Type.Literal("stopped"), Type.Literal("failed")]),
    by: WriterIdSchema,
  }),
  Type.Object({
    kind: Type.Literal("budget-spent"),
    lane: ThreadIdSchema,
    budget: EntryIdSchema,
    limit: Type.Number(),
    by: WriterIdSchema,
  }),
])

export const FACT_TYPE = "pinetrie.fact"

export const FACT = historyMessage(FACT_TYPE, QueuedFactSchema)

/** The pi `CustomMessage` a fact is stored as. */
export type FactMessage = HistoryMessage<typeof FACT_TYPE, QueuedFact>

/** A fact as a card carries it, in the places document's flat strings. */
export const encodeQueuedFact = (fact: QueuedFact): string =>
  JSON.stringify(fact)

/** A card's stored fact -> the fact; undefined for one malformed. Total. */
export function decodeQueuedFact(stored: string): QueuedFact | undefined {
  try {
    const fact: unknown = JSON.parse(stored)
    return Value.Check(QueuedFactSchema, fact) ? fact : undefined
  } catch {
    return undefined
  }
}

/** A stored message -> its fact, or undefined if it is not one. */
export const decodeFact = (message: unknown): QueuedFact | undefined =>
  FACT.decode(message)

/** Where an acceptance went, after "accepted": nothing for accepted work, else a WIP's name. */
const into = (to: CatchUpFrom) =>
  to.kind === "accepted" ? "" : ` into ${catchUpName(to)}`

/**
 * What a card says, from where its words are (`textSourceOf`): a text
 * card's document, read by `docText`; a fact's line; nothing for a card with
 * no words. Every reader of card words reads through it.
 */
export function wordsOf(
  source: TextSource,
  docText: (card: TextCardId) => string,
): string {
  switch (source.kind) {
    case "doc":
      return docText(source.card)
    case "fact":
      return factLine(source.fact)
    case "ask":
      return askLine(source.relay)
    // A reference is never queued or pinned (`KINDS`): no reader of these
    // meets a quote, which only the page reads.
    case "blob":
    case "none":
      return ""
  }
}

/** The one line a column shows for a fact. */
export function factLine(fact: QueuedFact): string {
  switch (fact.kind) {
    case "accepted":
      return `✓ accepted${into(fact.to)} as ${fact.as.slice(0, 8)}`
    case "described":
      return "✎ a new description was asked for"
    case "squashed":
      return "⇣ the stack was squashed into one revision"
    case "refreshed":
      return "↻ the offer was rebuilt from this thread's work"
    case "stopped":
      return fact.budget === undefined
        ? "■ the run was stopped"
        : "■ the run was stopped: its budget was spent"
    case "dismissed":
      return "− an agent was dismissed from this thread"
    case "left":
      return "− an agent left this thread"
    case "budget-spent":
      return `■ agents spent the budget of ${tokensWords(fact.limit)}`
    case "round":
      return `↳ ${fact.line}`
    case "unanswered":
      return fact.why === "stopped"
        ? "■ an asked agent was stopped before it answered"
        : "■ an asked agent's run failed before it answered"
  }
}

/** A number of tokens as people read it: "200k tokens", "1.5M tokens". */
export function tokensWords(tokens: number): string {
  if (tokens >= 1_000_000)
    return `${Number((tokens / 1_000_000).toFixed(1))}M tokens`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k tokens`
  return `${tokens} tokens`
}

/** What the model reads of a fact: who did what to this thread's work. */
export function factContent(fact: QueuedFact, name: string): string {
  switch (fact.kind) {
    case "accepted":
      return `${name} accepted this thread's work${into(fact.to)}, as the change ${fact.as}: ${fact.bookmark} moved forward to it. That work is no longer offered; what you do next is offered on top of it.`
    case "described":
      return `${name} asked for a new description of this thread's offer.`
    case "squashed":
      return `${name} squashed this thread's offer back into one revision.`
    case "refreshed":
      return `${name} rebuilt this thread's offer from your work as it is now, discarding their edits to it.`
    case "stopped":
      return fact.budget === undefined
        ? `${name} stopped this run.`
        : `This run was stopped: the budget of tokens ${name}'s message set for agents talking was spent.`
    case "dismissed":
      return `${name} dismissed another thread's agent from this thread's members; it is no longer asked here.`
    case "left":
      return "Another thread's agent left this thread's members; it is no longer asked here."
    case "round":
      return `After the agents answered: ${fact.line}`
    case "unanswered":
      return `The agent you asked in another thread did not answer: its run ${fact.why === "stopped" ? "was stopped" : "failed"}.`
    case "budget-spent":
      return `Agents talking from ${name}'s message spent its budget of ${tokensWords(fact.limit)}. Asking another thread's agent is refused until ${name} adds more.`
  }
}

/** The fact message, its content naming the person as `name`. */
export const encodeFact = (
  fact: QueuedFact,
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
