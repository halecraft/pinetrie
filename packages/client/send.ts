// client/send — what a composer says and does: before a send, what it will
// do (`planSend`), its button in words (`sendButton`) and where a new lane
// works; after it, what the composer shows (`settleSend`). Pure decisions;
// `card-editor.tsx` draws them.

import {
  type Address,
  agentByDefault,
  type ChatMode,
  isBusy,
  type ProjectRecord,
  parseMentions,
  type ThreadLane,
  type WorkSetting,
  type WriterId,
} from "@pineta/core"
import { addressChat, displayName, parseCommand } from "@pineta/marginalia"
import type { Outcome } from "@pineta/protocol/codec"
import type { Prefill } from "./columns.ts"

/**
 * What the composer shows after the host answers. Nothing is put back: the
 * box was never cleared, and a message the host did not write leaves its card
 * where it was (ADR-0048), a conflict or a refusal such as a root archived a
 * moment before (ADR-0029). A failure leaves the card too, though the host
 * may have written the message before it failed.
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
    case "queued":
      return {
        status: `waiting · ${ordinal(outcome.position + 1)} in line`,
        conflict: null,
      }
    default:
      return { status: "", conflict: null }
  }
}

/**
 * What a composer sends: its text trimmed, or null for nothing to send. A
 * text that is only its column's blank prefill is nothing: `@agent ` alone
 * would ask the agent with no question. Nothing is sent while an image is
 * uploading: its markdown is not in the text yet.
 */
export function sendable(
  text: string,
  prefill: Prefill | undefined,
  uploading: boolean,
): string | null {
  if (uploading) return null
  const message = text.trim()
  return message === "" ||
    (prefill?.blank === true && message === prefill.text.trim())
    ? null
    : message
}

// ── before a send ─────────────────────────────────────────────────────────

/**
 * What a composer's next send does, as values: `sendButton` and
 * `placeholderWords` say it.
 */
export interface SendPlan {
  readonly mode: ChatMode
  /** The send creates a lane: the chip then says where it works. */
  readonly createsLane: boolean
  /** Who it is for: `addressChat`'s answer, unchanged. */
  readonly to: Address
  /** Where a queued send would wait: the button's in `queue` mode, and a conflict's. */
  readonly queue: QueuePlace
  /** A message naming no one asks the agent (`agentByDefault`). */
  readonly agentByDefault: boolean
}

/**
 * What a composer's next send does, decided as the host will decide it: who
 * the message is for is `addressChat`, which `planChat` runs too, over the
 * thread `threadOf` gives (ADR-0021).
 *
 * - A fresh column sends `branch`. Elsewhere, a send that asks the agent while
 *   its lane is busy queues behind the others.
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
  const busy = lane.kind === "lane" && isBusy(lane)
  const mode: ChatMode = fresh
    ? "branch"
    : compelled && busy
      ? "queue"
      : "reply"
  return {
    mode,
    createsLane: compelled && (fresh || lane.kind === "none"),
    to,
    queue: queuePlace(lane, input.reader),
    agentByDefault: agentByDefault(how),
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

/** The button's label while an image uploads: a send then would lack its markdown. */
export const UPLOADING = "uploading image…"

/**
 * The send button: what `plan` will do, or that an upload is out. It cannot
 * be pressed while an image uploads or a send is in flight.
 */
export function sendButton(plan: SendPlan, busy: EditorBusy): SendButton {
  const words = busy.uploading
    ? { label: UPLOADING, title: null }
    : plan.mode === "queue"
      ? queueWords(plan.queue)
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

/** The box's placeholder: whether a message naming no one asks the agent. */
export const placeholderWords = (plan: SendPlan): string =>
  plan.agentByDefault ? "send to agent…" : "say something · @agent to ask"

/** Where a message queued now would wait: what the queue button says. */
export type QueuePlace =
  /** Nothing waits: it is taken when the run ends. */
  | { readonly kind: "next" }
  /** Behind `ahead` waiting items, the last of them yours. */
  | { readonly kind: "afterYours"; readonly ahead: number }
  /** Behind `ahead` waiting items, the last of them `name`'s. */
  | { readonly kind: "after"; readonly name: string; readonly ahead: number }

/**
 * Where a message queued on `lane` would wait: behind the newest item in its
 * outbox, of any kind, since the host takes them in the order sent.
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

/** Where a lane works, in the chip's words. */
export function whereWords(work: WorkSetting, project: ProjectRecord): string {
  if (work.kind === "own") return "on a copy"
  return work.dir === project.root ? "in your working copy" : `in ${work.dir}`
}

/** A row of the where menu. */
export interface WhereChoice {
  readonly key: string
  readonly className: "where-own" | "where-yours" | "where-used" | "where-other"
  /** The setting it picks; null for "in another directory…", which asks for one. */
  readonly setting: WorkSetting | null
  readonly row: string
  readonly disabled: boolean
  readonly title: string | undefined
}

/**
 * The where menu's rows, in order. A row with a setting starts with the chip's
 * words for it, so the chip and the menu say the same thing.
 */
export function whereChoices(
  project: ProjectRecord,
  usedDirs: readonly string[],
): readonly WhereChoice[] {
  const own: WorkSetting = { kind: "own" }
  const yours: WorkSetting = { kind: "direct", dir: project.root }
  return [
    {
      key: "own",
      className: "where-own",
      setting: own,
      row: `${whereWords(own, project)} · you take its changes`,
      disabled: project.kind !== "lanes",
      title: project.kind === "direct" ? project.reason : undefined,
    },
    {
      key: "yours",
      className: "where-yours",
      setting: yours,
      row: `${whereWords(yours, project)} · edits your files`,
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
          row: whereWords(setting, project),
          disabled: false,
          title: undefined,
        }
      }),
    {
      key: "other",
      className: "where-other",
      setting: null,
      row: "in another directory…",
      disabled: false,
      title: undefined,
    },
  ]
}
