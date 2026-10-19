// interface/send — what a composer says and does: before a send, what it will
// do (`planSend`), its button in words (`sendButton`) and where a new lane
// works; after it, what the composer shows (`settleSend`).
// `card-editor.tsx` draws them.

import {
  type AgentCandidate,
  type CanvasId,
  type CardCommand,
  parseMentions,
  type QueueHoldChange,
  type Recipients,
  type SendMode,
  sendWaits,
  type ThreadId,
  type ThreadLane,
  type WriterId,
} from "@pinetrie/core"
import type { Outcome } from "@pinetrie/protocol/codec"
import {
  type AcceptedRecord,
  addressMessage,
  agentByDefault,
  displayName,
  parseCommand,
  type SetupRecord,
  shortId,
} from "@pinetrie/rules"
import type { SendHow } from "@pinetrie/session"
import { COMMAND_VERB } from "./card-words.ts"
import type { Prefill } from "./columns.ts"
import { UPLOADING } from "./paste.ts"
import { noModelWords } from "./setup-words.ts"

/** What every send from one column carries, whichever card it is sent from. */
export type ColumnHow = Pick<SendHow, "base" | "root" | "pinned"> & {
  readonly column: string
  /** The column's thread: the one a unstarted column's first send starts. */
  readonly thread: ThreadId
  /**
   * The canvas the column is on, where a thread its send starts goes; a new
   * tab's, minted as it opened. Null before it is known: nothing is sent
   * meanwhile.
   */
  readonly canvas: CanvasId | null
}

/**
 * What the composer shows after the host answers. Nothing is put back: the box
 * was never cleared, and a message the host did not write leaves its card where
 * it was, a conflict or a refusal such as a root archived a moment before. A
 * failure leaves the card too, though the host may have written the message
 * before it failed. A send that found its lane busy is queued by the host in
 * the same step (`queued`): the card has left the composer, as a sent one has.
 */
interface SendSettled {
  readonly status: string
  /**
   * A reply that lost a race: the sender chooses to queue or branch. `line`
   * says who asked first (`raceWords`).
   */
  readonly conflict: {
    readonly text: string
    readonly line: string
  } | null
}

/** Who is reading: to tell their own messages apart, and name the rest. */
export interface Reader {
  readonly me: WriterId
  readonly nameOf: ReadonlyMap<WriterId, string>
}

/**
 * A command the host failed carrying out, in the client's words. Never "not
 * sent": the host may have written part of it before it failed.
 */
export const failedWords = (message: string): string =>
  `the host failed: ${message}`

const ordinal = (n: number): string =>
  n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`

/** A queued card's place in its lane's queue, from 0: "1st in line". */
export const lineWords = (n: number): string => `${ordinal(n + 1)} in line`

/**
 * Whether the host's answer took the card out of the composer: written,
 * running, or queued behind a busy lane. Then the box empties.
 */
export const spent = (outcome: Outcome): boolean =>
  outcome.kind === "appended" ||
  outcome.kind === "started" ||
  outcome.kind === "queued"

export function settleSend(
  outcome: Outcome,
  message: string,
  reader: Reader,
): SendSettled {
  switch (outcome.kind) {
    case "conflict":
      return {
        status: "",
        conflict: {
          text: message,
          line: `${raceWords(outcome.by, reader)}.`,
        },
      }
    case "refused":
      return {
        status: `not sent: ${outcome.message}`,
        conflict: null,
      }
    case "failed":
      return { status: failedWords(outcome.message), conflict: null }
    default:
      return { status: "", conflict: null }
  }
}

/**
 * What a composer sends: its text trimmed, or null for nothing to send. A text
 * that is only its column's blank prefill is nothing: `@agent ` alone would ask
 * the agent with no question. A card with a command is sent with no text: the
 * command alone is something to do. Nothing is sent while an image is
 * uploading: its markdown is not in the text yet.
 */
export function sendable(
  text: string,
  prefill: Prefill | undefined,
  uploading: boolean,
  command: CardCommand | null = null,
): string | null {
  if (uploading) return null
  const message = text.trim()
  const nothing =
    message === "" ||
    (prefill?.blank === true && message === prefill.text.trim())
  if (!nothing) return message
  return command === null ? null : ""
}

// ── before a send ─────────────────────────────────────────────────────────

/**
 * What a composer's next send does, as values: `sendButton` and
 * `placeholderWords` say it.
 */
/**
 * What a composer's send does: a chat in its mode, or `queue`, which asks
 * the host to queue the card and sends no chat: the host pops it when its
 * lane is free.
 */
export type ComposerMode = SendMode | "queue"

export interface SendPlan {
  readonly mode: ComposerMode
  /** The send creates a lane: the chip then says where it works. */
  readonly createsLane: boolean
  /** Who it is for: `addressMessage`'s answer, unchanged. */
  readonly to: Recipients
  /** Where a queued send would wait: the button's in `queue` mode, and a conflict's. */
  readonly queue: QueuePlace
  /**
   * What a queued send does to the queue's hold: on an idle thread whose queue
   * is held, it releases it, so the queue goes and this card after it; else it
   * leaves the hold as it is.
   */
  readonly hold: Extract<QueueHoldChange, "keep" | "release">
  /**
   * The card's command, and whether it has text to send after it: the button
   * then names the command.
   */
  readonly command: {
    readonly command: CardCommand
    readonly text: boolean
  } | null
  /** A message naming no one asks the agent (`agentByDefault`). */
  readonly agentByDefault: boolean
  /** Other threads' agents a mention may reach, by thread, their names: the button names them. */
  readonly agentNames: ReadonlyMap<ThreadId, string>
  /**
   * Why the host has no model, when this send would ask an agent: it is then
   * refused here, before it is sent (a run's refusal cannot reach its
   * author). Null when the send asks no agent, or the host has a model.
   */
  readonly noModel: string | null
}

/** Why the host has no model, in the setup page's words; null when it has one or has not said. */
export const noModelLine = (setup: SetupRecord | null): string | null =>
  setup?.model.kind === "none"
    ? noModelWords(setup.model.why, setup.model.named)
    : null

/**
 * What a composer's next send does, decided as the host will decide it: who
 * the message is for is `addressMessage`, which `@pinetrie/rules`' `planMessage`
 * runs too, over the thread `threadOf` gives.
 *
 * - A unstarted column sends `branch`. Elsewhere, a send to a busy lane, plain or
 *   asking the agent, queues its card behind the others; so does a card with
 *   a command, even on an idle lane, since only the host's pop carries a
 *   command out.
 * - A send that asks the agent creates a lane where there is none, and in a
 *   an unstarted thread's column always, since a branch never continues a lane: then a chip
 *   says where that lane will work.
 */
export function planSend(input: {
  readonly text: string
  readonly unstarted: boolean
  readonly lane: ThreadLane
  readonly participants: readonly string[]
  /** Other threads' agents on open canvases. */
  readonly agents: readonly AgentCandidate[]
  readonly reader: Reader
  /** The card's command, or null. */
  readonly command: CardCommand | null
  /** Why the host has no model (`noModelLine`); null when it has one. */
  readonly noModel: string | null
}): SendPlan {
  const { unstarted, lane } = input
  const how = { mode: unstarted ? "branch" : "reply", lane } as const
  const to = addressMessage({
    ...how,
    mentions: parseMentions(input.text),
    participants: input.participants,
    agents: input.agents,
    command: parseCommand(input.text) !== null,
  })
  const compelled = to.compels.kind === "agent"
  const queued =
    lane.kind === "lane" && (sendWaits(lane) || input.command !== null)
  const mode: ComposerMode = unstarted ? "branch" : queued ? "queue" : "reply"
  const releases = lane.kind === "lane" && !lane.running && lane.heldBy !== null
  return {
    mode,
    createsLane: compelled && (unstarted || lane.kind === "none"),
    to,
    queue: releases
      ? { kind: "releases", count: lane.waiting + 1 }
      : queuePlace(lane, input.reader),
    hold: releases ? "release" : "keep",
    agentByDefault: agentByDefault(how),
    agentNames: new Map(input.agents.map(a => [a.thread, a.name])),
    command:
      input.command === null
        ? null
        : { command: input.command, text: input.text.trim() !== "" },
    noModel: compelled || input.command !== null ? input.noModel : null,
  }
}

/** What the editor is doing, apart from what its text says. */
interface EditorBusy {
  readonly uploading: boolean
  readonly sending: boolean
}

/** A button's words: the queue's, or who a send is for. */
export interface ButtonWords {
  readonly label: string
  /** Everyone the label names, or the queue's length; null when it shortens nothing. */
  readonly title: string | null
}

interface SendButton extends ButtonWords {
  readonly disabled: boolean
  /** The send needs a model the host has not: the setup page says why. */
  readonly setup: boolean
}

/** The button's label while a send that asks an agent has no model to ask. */
export const NO_MODEL_LABEL = "no model"

/** The link beside it, to the setup page. */
export const SEE_SETUP = "See Setup"

/**
 * The send button: what `plan` will do, or that an upload is out. It cannot
 * be pressed while a share uploads or a send is in flight.
 */
export function sendButton(plan: SendPlan, busy: EditorBusy): SendButton {
  if (plan.noModel !== null)
    return {
      label: NO_MODEL_LABEL,
      title: `No model: ${plan.noModel}`,
      disabled: true,
      setup: true,
    }
  const words = busy.uploading
    ? { label: UPLOADING, title: null }
    : plan.command !== null
      ? commandSendWords(plan.command, plan.queue)
      : plan.mode === "queue"
        ? queueWords(plan.queue)
        : recipientWords(plan.to, plan.agentNames)
  return { ...words, disabled: busy.uploading || busy.sending, setup: false }
}

/**
 * Who a send is for, in the button's words. A send that asks the agent says
 * so, whoever else it names. Other threads' agents it invites come first
 * ("invite amber-fox · send to agent"), and those it asks are named as
 * people are: `names` gives each its thread's name.
 */
export function recipientWords(
  to: Recipients,
  names: ReadonlyMap<ThreadId, string> = new Map(),
): ButtonWords {
  const nameOf = (t: ThreadId) => names.get(t) ?? "another agent"
  const invited = to.invites.filter(t => !to.asks.includes(t)).map(nameOf)
  const prefix = invited.length === 0 ? "" : `invite ${invited.join(", ")} · `
  const words = sendWords(to, nameOf)
  return { label: `${prefix}${words.label}`, title: words.title }
}

function sendWords(
  to: Recipients,
  nameOf: (t: ThreadId) => string,
): ButtonWords {
  if (to.compels.kind === "agent")
    return { label: "send to agent", title: null }
  const named = [...to.asks.map(nameOf), ...to.people]
  const [first, ...others] = named
  if (first === undefined) return { label: "send", title: null }
  return others.length === 0
    ? { label: `send to ${first}`, title: null }
    : {
        label: `send to ${first} +${others.length}`,
        title: `to ${named.join(", ")}`,
      }
}

/**
 * The send button of a card with a command: the command, then the card's text
 * if it has some. Where it waits goes in its title.
 */
function commandSendWords(
  command: NonNullable<SendPlan["command"]>,
  queue: QueuePlace,
): ButtonWords {
  const verb = COMMAND_VERB[command.command]
  return {
    label:
      command.command === "split" || !command.text ? verb : `${verb} and send`,
    title: queue.kind === "next" ? null : queueWords(queue).label,
  }
}

/**
 * The box's placeholder: with a command, that its text is optional; else
 * whether a message naming no one asks the agent.
 */
export const placeholderWords = (plan: SendPlan): string =>
  plan.command !== null
    ? "what should the agent do with the new work? (optional)"
    : plan.agentByDefault
      ? "send to agent…"
      : "say something · @agent to ask"

/** Where a message queued now would wait: what the queue button says. */
export type QueuePlace =
  /**
   * Last in a held queue that the send releases: `count` cards go, this one
   * with them.
   */
  | { readonly kind: "releases"; readonly count: number }
  /** Nothing waits: it is popped when the run ends. */
  | { readonly kind: "next" }
  /** Behind `ahead` queued cards, the last of them yours. */
  | { readonly kind: "afterMine"; readonly ahead: number }
  /** Behind `ahead` queued cards, the last of them `name`'s. */
  | { readonly kind: "after"; readonly name: string; readonly ahead: number }

/**
 * Where a card queued on `lane` would wait: behind the last card in its
 * queue, since the host pops them in order.
 */
export function queuePlace(lane: ThreadLane, reader: Reader): QueuePlace {
  if (lane.kind === "none") return { kind: "next" }
  const last = lane.lastWaiting
  if (last === null) return { kind: "next" }
  if (last === reader.me) return { kind: "afterMine", ahead: lane.waiting }
  return {
    kind: "after",
    name: displayName(last, reader.nameOf.get(last)),
    ahead: lane.waiting,
  }
}

/**
 * Where a queued send waits, in words: the send button's, and a conflict's.
 * The title counts the queue when one name stands for more than one.
 */
export function queueWords(place: QueuePlace): ButtonWords {
  switch (place.kind) {
    case "releases":
      return {
        label: `send all (${place.count})`,
        title: "release the held queue: what waits goes first, then this",
      }
    case "next":
      return { label: "queue up next", title: null }
    case "afterMine":
    case "after":
      return {
        label:
          place.kind === "afterMine"
            ? "queue after yours"
            : `queue after ${place.name}`,
        title: place.ahead > 1 ? `${place.ahead} waiting ahead` : null,
      }
  }
}

/**
 * Who asked the agent first, as a clause, for a conflict. `by` is the reader
 * when the host falls back to the lane's asker (`askedBy`) and that is them.
 */
export function raceWords(by: WriterId | null, reader: Reader): string {
  if (by === null) return "Another thread started here a moment before you"
  if (by === reader.me) return "You already asked the agent here"
  return `${displayName(by, reader.nameOf.get(by))} asked the agent a moment before you`
}

// ── where a new lane starts ────────────────────────────────────

/**
 * A new lane here would be cloned from a commit with conflicts: its proposed
 * changes would start conflicted until it catches up.
 */
export const forkWords = (files: number): string =>
  `starts from a copy with an unresolved conflict in ${files} ${files === 1 ? "file" : "files"}`

/**
 * What a new thread starts from, the line that opens the menu of bases
 * (`baseChoices`): accepted work, or a WIP.
 */
export const startWords = (base: string | null): string =>
  base === null
    ? "starts from accepted work"
    : `starts from your unfinished work: ${base}`

/** A row of the where menu that picks a new lane's base. */
interface BaseChoice {
  readonly key: string
  /** The WIP bookmark it picks; null for accepted work. */
  readonly base: string | null
  readonly row: string
  readonly detail: string | null
  readonly chosen: boolean
  /** The jj facts: the bookmark and its commit. */
  readonly title: string
}

/**
 * The bases a new lane may start from: accepted work, then each WIP bookmark
 * above it, with how far it is behind accepted work. None with no line yet,
 * nor with no WIP, nor in a folder project, which has none: accepted work is
 * then the only start, and needs no choosing.
 */
export function baseChoices(
  accepted: AcceptedRecord | null,
  chosen: string | null,
): readonly BaseChoice[] {
  if (
    accepted === null ||
    accepted.kind === "folder" ||
    accepted.commit === null ||
    accepted.unfinishedWork.length === 0
  )
    return []
  const behind = (n: number) =>
    n === 0
      ? "your unfinished work"
      : `your unfinished work · ${n} ${n === 1 ? "commit" : "commits"} behind accepted work`
  return [
    {
      key: "base:line",
      base: null,
      row: "accepted work",
      detail: null,
      chosen: chosen === null,
      title: `${accepted.acceptedBookmark} at ${shortId(accepted.commit)}`,
    },
    ...accepted.unfinishedWork.map(w => ({
      key: `base:${w.bookmark}`,
      base: w.bookmark,
      row: w.bookmark,
      detail: behind(w.behind),
      chosen: chosen === w.bookmark,
      title: `${w.bookmark} at ${shortId(w.commit)}, copied for the thread`,
    })),
  ]
}
