// fact — what the host records in a thread: what a command on its proposed
// changes did, a conflict's version a person chose, who stopped a run, a member dismissed or gone, a budget spent,
// an ask unanswered or an answer undelivered, a round's line, and a proposal's
// branches opened.

import type {
  AcceptanceDecision,
  ConflictChoice,
  LatestFrom,
  ThreadId,
  WriterId,
} from "@pinetrie/core"
import type { Away, ProposedChangesFact, QueuedFact } from "@pinetrie/threads"
import { Type } from "typebox"
import {
  CanvasIdSchema,
  EntryIdSchema,
  isWellFormed,
  List,
  ThreadIdSchema,
  WriterIdSchema,
} from "./decode.ts"
import { type HistoryMessage, historyMessage } from "./history.ts"
import { LatestFromSchema, latestSourceName } from "./latest-from.ts"

const QueuedFactSchema = Type.Union([
  Type.Object({
    kind: Type.Literal("accepted"),
    lane: ThreadIdSchema,
    by: WriterIdSchema,
    as: Type.String({ minLength: 1 }),
    bookmark: Type.String({ minLength: 1 }),
    to: LatestFromSchema,
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
    kind: Type.Literal("resolved"),
    lane: ThreadIdSchema,
    by: WriterIdSchema,
    path: Type.String({ minLength: 1 }),
    choose: Type.Union([
      Type.Literal("ours"),
      Type.Literal("theirs"),
      Type.Literal("base"),
    ]),
  }),
  Type.Object({
    kind: Type.Literal("stopped"),
    lane: ThreadIdSchema,
    prompt: EntryIdSchema,
    by: WriterIdSchema,
    at: Type.Number(),
    allowance: Type.Optional(EntryIdSchema),
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
      Type.Object({
        kind: Type.Literal("in-inventory"),
        holder: WriterIdSchema,
      }),
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
    kind: Type.Literal("allowance-spent"),
    lane: ThreadIdSchema,
    allowance: EntryIdSchema,
    limit: Type.Number(),
    by: WriterIdSchema,
  }),
])

const FACT_TYPE = "pinetrie.fact"

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
    return isWellFormed(QueuedFactSchema, fact) ? fact : undefined
  } catch {
    return undefined
  }
}

/** A stored message -> its fact, or undefined if it is not one. */
export const decodeFact = (message: unknown): QueuedFact | undefined =>
  FACT.decode(message)

/** Where an acceptance went, after "accepted": nothing for accepted work, else a WIP's name. */
const into = (to: LatestFrom) =>
  to.kind === "accepted" ? "" : ` into ${latestSourceName(to)}`

/**
 * Why a thread is out of reach, naming no person: a fact's words are fixed
 * when it is written, and only its own `by` is named then.
 */
const awayLine = (name: string, why: Away): string =>
  why.kind === "archived"
    ? `${name}'s canvas is archived`
    : why.kind === "in-inventory"
      ? `${name} is in someone's inventory`
      : `${name} is no longer on any canvas`

/** What a fact's line leaves out, as its title; null for none. */
export function factDetail(fact: QueuedFact): string | null {
  return fact.kind === "accepted" ? `change id ${fact.as}` : null
}

/** The one line a column shows for a fact. */
export function factLine(fact: QueuedFact): string {
  switch (fact.kind) {
    case "accepted":
      return `✓ accepted${into(fact.to)}`
    case "accepted-into-folder":
      return `✓ accepted into the project's folder: ${fact.files === 1 ? "1 file" : `${fact.files} files`} written`
    case "described":
      return "✎ asked for a new description"
    case "squashed":
      return "⇣ the changes were squashed into one revision"
    case "refreshed":
      return "↻ the changes were rebuilt from this thread's work"
    case "resolved":
      return `✓ ${choiceWords(fact.choose)} of ${fact.path} chosen: its conflict is closed`
    case "stopped":
      return fact.allowance === undefined
        ? "■ the run was stopped"
        : "■ the run was stopped: its allowance was used up"
    case "dismissed":
      return "− an agent was dismissed from this thread"
    case "left":
      return "− an agent left this thread"
    case "allowance-spent":
      return `■ agents used up their ${tokensWords(fact.limit).replace(/ tokens?$/, "-token")} allowance`
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

/** A conflict's version as a fact names it. */
const choiceWords = (choose: ConflictChoice): string =>
  choose === "ours"
    ? "this thread's own version"
    : choose === "theirs"
      ? "the latest version it got"
      : "the version both sides began from"

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
      return `${name} rebuilt this thread's proposed changes from your work as it is now, dropping their edits to them.`
    case "resolved":
      return `${name} chose ${choiceWords(fact.choose)} of ${fact.path}; its conflict is closed${fact.choose === "ours" ? "" : ", and your copy holds that version now"}.`
    case "stopped":
      return fact.allowance === undefined
        ? `${name} stopped this run.`
        : `This run was stopped: the allowance of tokens ${name}'s message set for agents talking was used up.`
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
    case "allowance-spent":
      return `Agents talking from ${name}'s message used up its allowance of ${tokensWords(fact.limit)}. Asking another thread's agent is refused until ${name} adds more.`
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
        : { kind: "unfinished", bookmark: destination },
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
