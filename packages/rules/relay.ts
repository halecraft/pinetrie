// relay — another thread's agent asked, and its answer.

import {
  type AnswerDetails,
  type Asker,
  type Away,
  type EntryId,
  type ForeignLane,
  firstLine,
  type HeardDetails,
  type Reach,
  type RelayDetails,
  type ThreadId,
  type ThreadLane,
  type TranscriptMessage,
  type WriterId,
} from "@pinetrie/core"
import { Type } from "typebox"
import { Value } from "typebox/value"
import {
  EntryIdSchema,
  List,
  ThreadIdSchema,
  WriterIdSchema,
} from "./decode.ts"
import { foreignLaneWords } from "./held.ts"
import { type HistoryMessage, historyMessage } from "./history.ts"
import { reachWords } from "./reach.ts"
import { transcriptLines } from "./request.ts"

const HEARD_TYPE = "pinetrie.heard"
const RELAY_TYPE = "pinetrie.relay"
const ANSWER_TYPE = "pinetrie.answer"

const HeardSchema = Type.Object({
  from: ThreadIdSchema,
  fromName: Type.String(),
  entries: List(EntryIdSchema),
})

const AskerSchema = Type.Union([
  Type.Object({ kind: Type.Literal("person"), writer: WriterIdSchema }),
  Type.Object({ kind: Type.Literal("agent"), thread: ThreadIdSchema }),
])

const RelaySchema = Type.Object({
  from: ThreadIdSchema,
  fromName: Type.String(),
  source: EntryIdSchema,
  asker: AskerSchema,
  askerName: Type.String(),
  text: Type.String(),
  budget: EntryIdSchema,
  by: WriterIdSchema,
})

const AnswerSchema = Type.Object({
  from: ThreadIdSchema,
  fromName: Type.String(),
  relay: EntryIdSchema,
  source: EntryIdSchema,
  text: Type.String(),
  wakes: Type.Boolean(),
  budget: EntryIdSchema,
  by: WriterIdSchema,
})

/** What an asked agent heard: not shown as a message, drawn folded. */
export const HEARD = historyMessage(HEARD_TYPE, HeardSchema, false)
export const RELAY = historyMessage(RELAY_TYPE, RelaySchema)
export const ANSWER = historyMessage(ANSWER_TYPE, AnswerSchema)

export type HeardMessage = HistoryMessage<typeof HEARD_TYPE, HeardDetails>
export type RelayMessage = HistoryMessage<typeof RELAY_TYPE, RelayDetails>
export type AnswerMessage = HistoryMessage<typeof ANSWER_TYPE, AnswerDetails>

/** An ask card's relay, in the places document's flat strings. */
export const encodeRelay = (relay: RelayDetails): string =>
  JSON.stringify(relay)

/** An ask card's stored relay -> the relay; undefined for one malformed. Total. */
export function decodeStoredRelay(stored: string): RelayDetails | undefined {
  try {
    const relay: unknown = JSON.parse(stored)
    return Value.Check(RelaySchema, relay) ? relay : undefined
  } catch {
    return undefined
  }
}

export const decodeHeard = HEARD.decode
export const decodeRelay = RELAY.decode
export const decodeAnswer = ANSWER.decode

/**
 * The line every agent thread's `<rules>` holds on other threads' agents:
 * how to ask one, that an ask does not wait, and what an asked
 * agent's answer is.
 */
export const AGENTS_RULE =
  "Other threads' agents can be members of this thread. Ask one with the ask tool, by its thread's name: it does not wait, and the answer arrives later as a message. An @name you write asks nobody. When another thread's agent or person asks you, your last message of that run is your answer there."

/** What the asked agent reads of what it heard: one line per message. */
export const heardContent = (
  fromName: string,
  lines: readonly string[],
): string =>
  [
    `What was said in the thread ${fromName} since you last heard from it:`,
    ...lines.map(l => `- ${l}`),
  ].join("\n")

/** What the asked agent reads of the ask: who asked, where, and what. */
export const relayContent = (d: RelayDetails): string =>
  `${d.askerName}, in the thread ${d.fromName}, asks you: ${d.text}\n\n(Your last message of this run is posted in ${d.fromName} as your answer.)`

/** What the asking thread's agent reads of an answer. */
export const answerContent = (d: AnswerDetails): string =>
  `${d.fromName} answers, from its own thread: ${d.text}`

export const encodeHeard = (
  d: HeardDetails,
  lines: readonly string[],
  timestamp: number,
): HeardMessage => HEARD.encode(d, heardContent(d.fromName, lines), timestamp)

export const encodeRelayMessage = (
  d: RelayDetails,
  timestamp: number,
): RelayMessage => RELAY.encode(d, relayContent(d), timestamp)

export const encodeAnswer = (
  d: AnswerDetails,
  timestamp: number,
): AnswerMessage => ANSWER.encode(d, answerContent(d), timestamp)

/** The one line an ask card shows: who asks, from where, what. */
export const askLine = (d: RelayDetails): string =>
  `⇢ ${d.askerName} in ${d.fromName} asks: ${firstLine(d.text, 120)}`

/** The one line a column shows for what an agent heard. */
export const heardLine = (d: HeardDetails): string =>
  `heard in ${d.fromName}: ${d.entries.length} ${d.entries.length === 1 ? "message" : "messages"}`

/** Why an ask was refused, as a value; `relayRefusalText` words it. */
export type RelayRefusal =
  | { readonly kind: "unknown"; readonly name: string }
  /** The asked thread, or the one that asked, is out of reach. */
  | {
      readonly kind: "away"
      readonly side: "to" | "from"
      readonly name: string
      readonly reach: Away
    }
  | { readonly kind: "self" }
  | { readonly kind: "not-member"; readonly name: string }
  | { readonly kind: "no-lane"; readonly name: string }
  /** The asked thread's lane keeps a history of the other kind: no run starts there. */
  | {
      readonly kind: "foreign"
      readonly name: string
      readonly lane: ForeignLane
    }
  | { readonly kind: "spent" }

/** A refused ask, in the words its asker reads; `nameOf` names people. */
export function relayRefusalText(
  why: RelayRefusal,
  nameOf: (w: WriterId) => string,
): string {
  switch (why.kind) {
    case "unknown":
      return `There is no open thread named ${why.name}.`
    case "away":
      return why.side === "to"
        ? `${reachWords(why.name, why.reach, nameOf)}: it cannot be asked.`
        : `${reachWords(why.name, why.reach, nameOf)}: its ask was not relayed.`
    case "self":
      return "That is this thread: ask another thread's agent."
    case "not-member":
      return `${why.name} is not a member of this thread: a person invites it first, by mentioning it.`
    case "no-lane":
      return `${why.name} has no agent of its own to ask: nobody has asked an agent there yet.`
    case "foreign":
      return `${why.name} cannot be asked: ${foreignLaneWords(why.lane)}.`
    case "spent":
      return "The budget for agents talking is spent: a person must add more first."
  }
}

/** A relay planned: what the asked agent hears first, if anything, and the ask. */
export type RelayPlan =
  | {
      readonly kind: "relay"
      readonly to: ThreadId
      readonly heard: {
        readonly details: HeardDetails
        readonly lines: readonly string[]
      } | null
      readonly relay: RelayDetails
    }
  | { readonly kind: "refused"; readonly why: RelayRefusal }

/**
 * Whether both threads of an ask are in reach: the asked one, and
 * the one that asked, which may have gone while its ask waited as a card.
 * Null when both are open. The host asks it before it opens either thread's
 * root, and `planRelay` again.
 */
export function unreachableRefusal(input: {
  readonly fromName: string
  readonly fromReach: Reach
  readonly toName: string
  readonly toReach: Reach
}): RelayRefusal | null {
  if (input.toReach.kind !== "open")
    return {
      kind: "away",
      side: "to",
      name: input.toName,
      reach: input.toReach,
    }
  if (input.fromReach.kind !== "open")
    return {
      kind: "away",
      side: "from",
      name: input.fromName,
      reach: input.fromReach,
    }
  return null
}

/**
 * An ask relayed from thread `from` into `to`'s thread.
 *
 * - Both threads must be in reach (`unreachableRefusal`), before anything else.
 * - Only a member is asked, and only a thread with a lane has an agent to
 *   ask, and a run may start on it: a lane of another kind has none; a
 *   spent budget asks nobody.
 * - What `to` has not heard is the asking thread's messages after the
 *   newest it heard (`lastHeardEntry`), or, having heard none, from the message
 *   that invited it on; never the ask itself, which the relay carries, nor
 *   `to`'s own answers.
 */
export function planRelay(input: {
  readonly from: ThreadId
  readonly fromName: string
  /** The asked thread, and its name. */
  readonly to: ThreadId
  readonly toName: string
  readonly fromReach: Reach
  readonly toReach: Reach
  readonly members: readonly ThreadId[]
  readonly toLane: ThreadLane
  /** Why no run starts on the asked thread's lane (`LaneWork.runnable`); null when one may. */
  readonly toForeign: ForeignLane | null
  /** The asking thread's path, root first (`projectTranscript`). */
  readonly path: readonly TranscriptMessage[]
  /** The newest entry of `from` that `to` has heard (`lastHeardEntry`). */
  readonly heard: EntryId | null
  /** The message that invited `to`, on the path; null when none is. */
  readonly lastInvitation: EntryId | null
  readonly source: EntryId
  readonly asker: Asker
  readonly askerName: string
  readonly text: string
  readonly budget: EntryId
  readonly spent: boolean
  readonly by: WriterId
}): RelayPlan {
  const refuse = (why: RelayRefusal): RelayPlan => ({ kind: "refused", why })
  const away = unreachableRefusal(input)
  if (away !== null) return refuse(away)
  if (input.to === input.from) return refuse({ kind: "self" })
  if (!input.members.includes(input.to))
    return refuse({ kind: "not-member", name: input.toName })
  if (input.toLane.kind === "none")
    return refuse({ kind: "no-lane", name: input.toName })
  if (input.toForeign !== null)
    return refuse({
      kind: "foreign",
      name: input.toName,
      lane: input.toForeign,
    })
  if (input.spent) return refuse({ kind: "spent" })
  const at = (id: EntryId) => input.path.findIndex(m => m.id === id)
  const start =
    input.heard !== null
      ? at(input.heard) + 1
      : input.lastInvitation !== null
        ? Math.max(0, at(input.lastInvitation))
        : 0
  const unheard = input.path
    .slice(start)
    .filter(m => m.id !== input.source && !isAnswerFrom(m, input.to))
  const lines = transcriptLines(unheard)
  return {
    kind: "relay",
    to: input.to,
    heard:
      lines.length === 0
        ? null
        : {
            details: {
              from: input.from,
              fromName: input.fromName,
              entries: unheard.map(m => m.id),
            },
            lines,
          },
    relay: {
      from: input.from,
      fromName: input.fromName,
      source: input.source,
      asker: input.asker,
      askerName: input.askerName,
      text: input.text,
      budget: input.budget,
      by: input.by,
    },
  }
}

const isAnswerFrom = (m: TranscriptMessage, thread: ThreadId): boolean =>
  m.role === "answer" && m.from === thread

/** How a relayed run ended, as its end reads it. */
export type RelayEnd =
  | { readonly kind: "answered"; readonly text: string }
  | { readonly kind: "stopped" }
  | { readonly kind: "failed" }

/** An answer planned: the message to send, or the fact that none came. */
export type AnswerPlan =
  | { readonly kind: "answer"; readonly answer: AnswerDetails }
  | {
      readonly kind: "unanswered"
      readonly why: "stopped" | "failed"
    }
  /** The thread that asked is out of reach: the answering thread is told. */
  | { readonly kind: "undelivered"; readonly reach: Away }

/**
 * What a relayed run's end sends back to the thread that asked.
 *
 *
 * - An answered run's last message is the answer. It wakes the asker only
 *   when an agent asked and its budget is not spent: an answer to a person's
 *   ask wakes nobody, and nothing else wakes anyone.
 * - A stopped or failed run sends no answer, and wakes nobody: the asking
 *   thread is told it went unanswered.
 * - Nothing is sent to a thread that asked and has since gone out of reach:
 *   its task archived, or taken into an inventory. The answering
 *   thread is told instead.
 */
export function planAnswer(input: {
  /** The relayed run's prompt, and its entry. */
  readonly relay: RelayDetails
  readonly relayEntry: EntryId
  /** The answering thread, and its name. */
  readonly thread: ThreadId
  readonly name: string
  readonly end: RelayEnd
  readonly spent: boolean
  /** Where the thread that asked is now. */
  readonly fromReach: Reach
}): AnswerPlan {
  const { relay, end, fromReach } = input
  if (fromReach.kind !== "open")
    return { kind: "undelivered", reach: fromReach }
  if (end.kind !== "answered") return { kind: "unanswered", why: end.kind }
  return {
    kind: "answer",
    answer: {
      from: input.thread,
      fromName: input.name,
      relay: input.relayEntry,
      source: relay.source,
      text: end.text,
      wakes: relay.asker.kind === "agent" && !input.spent,
      budget: relay.budget,
      by: relay.by,
    },
  }
}
