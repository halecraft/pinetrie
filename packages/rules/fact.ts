// fact — what the host records in a thread: what a command on its proposed
// changes did, who stopped a run, a member dismissed or gone, a budget spent,
// an ask unanswered or an answer undelivered, a round's line, and a proposal's
// branches opened.

import type {
  AcceptanceDecision,
  Away,
  CatchUpFrom,
  ProposedChangesFact,
  QueuedFact,
  ThreadId,
  WriterId,
} from "@pinetrie/core"
import { Type } from "typebox"
import { Value } from "typebox/value"
import { CatchUpFromSchema, catchUpName } from "./catch-up-from.ts"
import {
  CanvasIdSchema,
  EntryIdSchema,
  List,
  ThreadIdSchema,
  WriterIdSchema,
} from "./decode.ts"
import { type HistoryMessage, historyMessage } from "./history.ts"

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
    kind: Type.Literal("accepted-into-folder"),
    lane: ThreadIdSchema,
    by: WriterIdSchema,
    files: Type.Integer({ minimum: 0 }),
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
    kind: Type.Literal("undelivered"),
    lane: ThreadIdSchema,
    to: ThreadIdSchema,
    toName: Type.String(),
    why: Type.Union([
      Type.Object({
        kind: Type.Literal("archived"),
        canvas: CanvasIdSchema,
        record: Type.Object({
          canvas: CanvasIdSchema,
          by: WriterIdSchema,
          at: Type.Number(),
        }),
      }),
      Type.Object({ kind: Type.Literal("held"), by: WriterIdSchema }),
      Type.Object({ kind: Type.Literal("trashed"), canvas: CanvasIdSchema }),
      Type.Object({ kind: Type.Literal("gone") }),
    ]),
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
    kind: Type.Literal("branched"),
    lane: ThreadIdSchema,
    by: WriterIdSchema,
    proposal: EntryIdSchema,
    how: Type.Union([Type.Literal("started"), Type.Literal("opened")]),
    titles: List(Type.String()),
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
 * Why a thread is out of reach, naming no person: a fact's words are fixed
 * when it is written, and only its own `by` is named then.
 */
const awayLine = (name: string, why: Away): string =>
  why.kind === "archived"
    ? `${name}'s canvas is archived`
    : why.kind === "held"
      ? `${name} is in someone's inventory`
      : `${name} is no longer on any canvas`

/** The one line a column shows for a fact. */
export function factLine(fact: QueuedFact): string {
  switch (fact.kind) {
    case "accepted":
      return `✓ accepted${into(fact.to)} as ${fact.as.slice(0, 8)}`
    case "accepted-into-folder":
      return `✓ accepted into the project's folder: ${fact.files === 1 ? "1 file" : `${fact.files} files`} written`
    case "described":
      return "✎ a new description of the changes was asked for"
    case "squashed":
      return "⇣ the changes were squashed into one revision"
    case "refreshed":
      return "↻ the changes were rebuilt from this thread's work"
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
    case "undelivered":
      return `■ the answer was not sent: ${awayLine(fact.toName, fact.why)}`
    case "round":
      return `↳ ${fact.line}`
    case "unanswered":
      return fact.why === "stopped"
        ? "■ an asked agent was stopped before it answered"
        : "■ an asked agent's run failed before it answered"
    case "branched":
      return `⑂ ${branchesWords(fact.titles.length)} ${fact.how} from the proposal`
  }
}

const branchesWords = (n: number): string =>
  n === 1 ? "1 branch" : `${n} branches`

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
      return `${name} accepted this thread's work${into(fact.to)}, as the commit with change id ${fact.as}: ${fact.bookmark} moved forward to it. That work is no longer proposed; what you do next is proposed on top of it.`
    case "accepted-into-folder":
      return `${name} accepted this thread's work: its files are written into the project's folder. That work is no longer proposed; what you do next is proposed on top of it.`
    case "described":
      return `${name} asked for a new description of this thread's proposed changes.`
    case "squashed":
      return `${name} squashed this thread's proposed changes back into one revision.`
    case "refreshed":
      return `${name} rebuilt this thread's proposed changes from your work as it is now, discarding their edits to them.`
    case "stopped":
      return fact.budget === undefined
        ? `${name} stopped this run.`
        : `This run was stopped: the budget of tokens ${name}'s message set for agents talking was spent.`
    case "dismissed":
      return `${name} dismissed another thread's agent from this thread's members; it is no longer asked here.`
    case "left":
      return "Another thread's agent left this thread's members; it is no longer asked here."
    case "undelivered":
      return `Your answer was not sent to ${fact.toName}, which asked: ${awayLine(fact.toName, fact.why)}.`
    case "round":
      return `After the agents answered: ${fact.line}`
    case "unanswered":
      return `The agent you asked in another thread did not answer: its run ${fact.why === "stopped" ? "was stopped" : "failed"}.`
    case "budget-spent":
      return `Agents talking from ${name}'s message spent its budget of ${tokensWords(fact.limit)}. Asking another thread's agent is refused until ${name} adds more.`
    case "branched":
      return fact.how === "started"
        ? `${name} started ${branchesWords(fact.titles.length)} from your proposal, each a thread of its own with its own agent: ${fact.titles.join("; ")}.`
        : `${name} opened ${branchesWords(fact.titles.length)} from your proposal, not yet sent: ${fact.titles.join("; ")}.`
  }
}

/** The fact message, its content naming the person as `name`. */
export const encodeFact = (
  fact: QueuedFact,
  name: string,
  timestamp: number,
): FactMessage => FACT.encode(fact, factContent(fact, name), timestamp)

/**
 * An acceptance's fact, from the decision it carried out: the change it
 * added, the bookmark it moved, and that bookmark as the thread knows it,
 * accepted work or a WIP.
 */
export const acceptedFact = (input: {
  readonly lane: ThreadId
  readonly by: WriterId
  readonly decision: Extract<AcceptanceDecision, { readonly kind: "accept" }>
  readonly acceptedBookmark: string
}): ProposedChangesFact => {
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

/** The fact of an action on proposed changes that are not an acceptance: what it did, and who asked. */
export const actionFact = (
  action: "describe" | "squash" | "refresh",
  lane: ThreadId,
  by: WriterId,
): ProposedChangesFact => ({
  kind:
    action === "describe"
      ? "described"
      : action === "squash"
        ? "squashed"
        : "refreshed",
  lane,
  by,
})
