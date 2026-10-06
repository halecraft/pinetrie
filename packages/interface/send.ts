// interface/send — what a composer says and does: before a send, what it will
// do (`planSend`), its button in words (`sendButton`) and where a new lane
// works; after it, what the composer shows (`settleSend`). Pure decisions;
// `card-editor.tsx` draws them.

import {
  type Address,
  type CardCommand,
  type ChatMode,
  type LineRecord,
  type ProjectRecord,
  parseMentions,
  sendWaits,
  type ThreadLane,
  type WorkSetting,
  type WriterId,
} from "@pinetrie/core"
import type { Outcome } from "@pinetrie/protocol/codec"
import {
  addressChat,
  agentByDefault,
  displayName,
  parseCommand,
} from "@pinetrie/rules"
import type { ChatHow } from "@pinetrie/session"
import type { Prefill } from "./columns.ts"

/** What every send from one column carries, whichever card it is sent from. */
export type ColumnHow = Pick<
  ChatHow,
  "lane" | "reserved" | "base" | "root" | "pinned"
> & {
  readonly asksAgent: boolean
  readonly column: string
}

/**
 * What the composer shows after the host answers. Nothing is put back: the
 * box was never cleared, and a message the host did not write leaves its card
 * where it was (ADR-0048), a conflict or a refusal such as a root archived a
 * moment before (ADR-0029). A failure leaves the card too, though the host
 * may have written the message before it failed. A send that found its lane
 * busy is queued by the host in the same step (`queued`): the card has left
 * the composer, as a sent one has (ADR-0059).
 */
export interface SendSettled {
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
 * What a composer sends: its text trimmed, or null for nothing to send. A
 * text that is only its column's blank prefill is nothing: `@agent ` alone
 * would ask the agent with no question. A card with a command is sent with
 * no text: the command alone is something to do (ADR-0055). Nothing is sent
 * while an image is uploading: its markdown is not in the text yet.
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
 * lane is free (ADR-0059).
 */
export type ComposerMode = ChatMode | "queue"

export interface SendPlan {
  readonly mode: ComposerMode
  /** The send creates a lane: the chip then says where it works. */
  readonly createsLane: boolean
  /** Who it is for: `addressChat`'s answer, unchanged. */
  readonly to: Address
  /** Where a queued send would wait: the button's in `queue` mode, and a conflict's. */
  readonly queue: QueuePlace
  /** The thread's queue is held: a queued send waits for a release (ADR-0048 step 7). */
  readonly held: boolean
  /**
   * The card's command (ADR-0055), and whether it has text to send after
   * it: the button then names the command.
   */
  readonly command: {
    readonly command: CardCommand
    readonly text: boolean
  } | null
  /** A message naming no one asks the agent (`agentByDefault`). */
  readonly agentByDefault: boolean
}

/**
 * What a composer's next send does, decided as the host will decide it: who
 * the message is for is `addressChat`, which `@pinetrie/rules`' `planChat`
 * runs too, over the thread `threadOf` gives (ADR-0021).
 *
 * - A fresh column sends `branch`. Elsewhere, a send to a busy lane, plain or
 *   asking the agent, queues its card behind the others; so does a card with
 *   a command, even on an idle lane, since only the host's pop carries a
 *   command out (ADR-0055).
 * - A send that asks the agent creates a lane where there is none, and in a
 *   fresh column always, since a branch never continues a lane: then a chip
 *   says where that lane will work (ADR-0032).
 */
export function planSend(input: {
  readonly text: string
  readonly fresh: boolean
  readonly lane: ThreadLane
  readonly asksAgent: boolean
  readonly participants: readonly string[]
  readonly reader: Reader
  /** The card's command (ADR-0055), or null. */
  readonly command: CardCommand | null
}): SendPlan {
  const { fresh, lane } = input
  const how = {
    mode: fresh ? "branch" : "reply",
    lane,
    asksAgent: input.asksAgent,
  } as const
  const to = addressChat({
    ...how,
    mentions: parseMentions(input.text),
    participants: input.participants,
    command: parseCommand(input.text) !== null,
  })
  const compelled = to.compels.kind === "agent"
  const queued =
    lane.kind === "lane" && (sendWaits(lane) || input.command !== null)
  const mode: ComposerMode = fresh ? "branch" : queued ? "queue" : "reply"
  return {
    mode,
    createsLane: compelled && (fresh || lane.kind === "none"),
    to,
    queue: queuePlace(lane, input.reader),
    held: lane.kind === "lane" && lane.heldBy !== null,
    agentByDefault: agentByDefault(how),
    command:
      input.command === null
        ? null
        : { command: input.command, text: input.text.trim() !== "" },
  }
}

/** What the editor is doing, apart from what its text says. */
export interface EditorBusy {
  readonly uploading: boolean
  readonly sending: boolean
}

/** A button's words: the queue's, or who a send is for. */
export interface ButtonWords {
  readonly label: string
  /** Everyone the label names, or the queue's length; null when it shortens nothing. */
  readonly title: string | null
}

export interface SendButton extends ButtonWords {
  readonly disabled: boolean
}

/** The queue button's title while the thread's queue is held. */
export const HELD_QUEUE_TITLE =
  "the queue is held: sent once someone releases it"

/** The button's label while an image uploads: a send then would lack its markdown. */
export const UPLOADING = "uploading image…"

/**
 * The send button: what `plan` will do, or that an upload is out. It cannot
 * be pressed while an image uploads or a send is in flight.
 */
export function sendButton(plan: SendPlan, busy: EditorBusy): SendButton {
  const words = busy.uploading
    ? { label: UPLOADING, title: null }
    : plan.command !== null
      ? commandSendWords(plan.command, plan.queue)
      : plan.mode === "queue"
        ? plan.held
          ? { ...queueWords(plan.queue), title: HELD_QUEUE_TITLE }
          : queueWords(plan.queue)
        : recipientWords(plan.to)
  return { ...words, disabled: busy.uploading || busy.sending }
}

/**
 * Who a send is for, in the button's words. A send that asks the agent says
 * so, whoever else it names.
 */
export function recipientWords(to: Address): ButtonWords {
  if (to.compels.kind === "agent")
    return { label: "send to agent", title: null }
  const [first, ...others] = to.people
  if (first === undefined) return { label: "send", title: null }
  return others.length === 0
    ? { label: `send to ${first}`, title: null }
    : {
        label: `send to ${first} +${others.length}`,
        title: `to ${to.people.join(", ")}`,
      }
}

/**
 * The send button of a card with a command (ADR-0055): the command, then
 * the card's text if it has some. Where it waits goes in its title.
 */
export function commandSendWords(
  command: NonNullable<SendPlan["command"]>,
  queue: QueuePlace,
): ButtonWords {
  const verb =
    command.command === "split"
      ? "split"
      : command.command === "continue-on-line"
        ? "continue"
        : "catch up"
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
  /** Nothing waits: it is popped when the run ends. */
  | { readonly kind: "next" }
  /** Behind `ahead` queued cards, the last of them yours. */
  | { readonly kind: "afterYours"; readonly ahead: number }
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
  if (last === reader.me) return { kind: "afterYours", ahead: lane.waiting }
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
  const label =
    place.kind === "next"
      ? "queue up next"
      : place.kind === "afterYours"
        ? "queue after yours"
        : `queue after ${place.name}`
  const title =
    place.kind !== "next" && place.ahead > 1
      ? `${place.ahead} waiting ahead`
      : null
  return { label, title }
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

// ── where a new lane works ────────────────────────────────────────────────

/**
 * Where a new thread's agent works, and what that means for your files: the
 * line under the box, which opens the where menu. A lane of its own starts
 * from accepted work unless it starts from a WIP (ADR-0060).
 */
export function whereWords(
  work: WorkSetting,
  project: ProjectRecord,
  base: string | null = null,
): string {
  if (work.kind === "own")
    return base === null
      ? "works on its own copy · your files stay as they are"
      : `starts from your unfinished work: ${base}`
  return work.dir === project.root
    ? "edits your files directly"
    : `edits files in ${work.dir}`
}

/**
 * A new lane here would be cloned from a commit with conflicts: its offer
 * would start conflicted until it catches up (ADR-0072).
 */
export const forkWords = (files: number): string =>
  `starts from a copy with an unresolved conflict in ${files} ${files === 1 ? "file" : "files"}`

/** A row of the where menu: its name, what it means, and whether it is chosen. */
export interface WhereChoice {
  readonly key: string
  readonly className: "where-own" | "where-yours" | "where-used" | "where-other"
  /** The setting it picks; null for "another directory…", which asks for one. */
  readonly setting: WorkSetting | null
  readonly row: string
  readonly detail: string | null
  /** Whether it is the current choice; undefined for one that asks. */
  readonly checked: boolean | undefined
  readonly disabled: boolean
  readonly title: string | undefined
}

/**
 * The where menu's first section, in order: its own copy, your files, each
 * directory another lane works in, and another directory. `onto` is the
 * line's bookmark, for its own copy's title; null before the line is read.
 */
export function whereChoices(
  project: ProjectRecord,
  usedDirs: readonly string[],
  work: WorkSetting,
  onto: string | null = null,
): readonly WhereChoice[] {
  const chosen = (setting: WorkSetting) =>
    setting.kind === work.kind &&
    (setting.kind === "own" ||
      (work.kind === "direct" && setting.dir === work.dir))
  const own: WorkSetting = { kind: "own" }
  const yours: WorkSetting = { kind: "direct", dir: project.root }
  return [
    {
      key: "own",
      className: "where-own",
      setting: own,
      row: "its own copy",
      detail: "you review its work, then accept it",
      checked: chosen(own),
      disabled: project.kind !== "lanes",
      title:
        project.kind === "direct"
          ? project.reason
          : onto === null
            ? undefined
            : `a lane of its own, cloned from ${onto}; its work comes back as pinetrie-offer/<thread>`,
    },
    {
      key: "yours",
      className: "where-yours",
      setting: yours,
      row: "your files",
      detail: "it edits them directly",
      checked: chosen(yours),
      disabled: false,
      title: undefined,
    },
    ...usedDirs
      .filter(dir => dir !== project.root)
      .map((dir): WhereChoice => {
        const setting: WorkSetting = { kind: "direct", dir }
        return {
          key: dir,
          className: "where-used",
          setting,
          row: dir,
          detail: "another thread works there",
          checked: chosen(setting),
          disabled: false,
          title: undefined,
        }
      }),
    {
      key: "other",
      className: "where-other",
      setting: null,
      row: "another directory…",
      detail: null,
      checked: undefined,
      disabled: false,
      title: undefined,
    },
  ]
}

// ── where a new lane starts (ADR-0060) ────────────────────────────────────

/** A row of the where menu that picks a new lane's base. */
export interface BaseChoice {
  readonly key: string
  /** The WIP bookmark it picks; null for the line. */
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
 * nor with no WIP: accepted work is then the only start, and needs no
 * choosing.
 */
export function baseChoices(
  line: LineRecord | null,
  chosen: string | null,
): readonly BaseChoice[] {
  if (line === null || line.commit === null || line.wips.length === 0) return []
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
      title: `${line.onto} at ${line.commit.slice(0, 8)}`,
    },
    ...line.wips.map(w => ({
      key: `base:${w.bookmark}`,
      base: w.bookmark,
      row: w.bookmark,
      detail: behind(w.behind),
      chosen: chosen === w.bookmark,
      title: `${w.bookmark} at ${w.commit.slice(0, 8)}, copied for the thread`,
    })),
  ]
}
