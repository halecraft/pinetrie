// client/send — what a composer says and does: before a send, its words and
// the send's mode (`planSend`, and where a new lane works); after it, what the
// composer shows (`settleSend`). Pure decisions; `composer.tsx` draws them.

import {
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

export interface SendSettled {
  /**
   * Text to put back in the composer, or null to leave it. A message the host
   * did not write comes back, so nothing typed is lost: a conflict, or a
   * refusal such as a root archived a moment before (ADR-0029).
   */
  readonly restore: string | null
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
        restore: message,
        status: "",
        conflict: {
          text: message,
          line: `${raceWords(outcome.by, reader)}.`,
        },
      }
    case "refused":
      return {
        restore: message,
        status: `not sent: ${outcome.message}`,
        conflict: null,
      }
    case "queued":
      return {
        restore: null,
        status: `waiting · ${ordinal(outcome.position + 1)} in line`,
        conflict: null,
      }
    default:
      return { restore: null, status: "", conflict: null }
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

/** What a composer's next send does, and the words it shows for it. */
export interface SendPlan {
  readonly mode: ChatMode
  /** The send creates a lane: the chip then says where it works. */
  readonly createsLane: boolean
  /** The button's words. */
  readonly button: string
  /** Everyone the button names, when it shortens them; else null. */
  readonly title: string | null
  readonly placeholder: string
}

/**
 * What the composer's button will do, decided as the host will decide it: who
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
  /** Where a queued message would wait. */
  readonly queue: QueuePlace
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
  const [first, ...others] = to.people
  const queue = queueWords(input.queue)
  const button =
    mode === "queue"
      ? queue.button
      : compelled
        ? "ask the agent"
        : first === undefined
          ? "send"
          : others.length === 0
            ? `send to ${first}`
            : `send to ${first} +${others.length}`
  return {
    mode,
    createsLane: compelled && (fresh || lane.kind === "none"),
    button,
    title:
      mode === "queue"
        ? queue.title
        : !compelled && others.length > 0
          ? `to ${to.people.join(", ")}`
          : null,
    placeholder: agentByDefault(how)
      ? "ask the agent…"
      : "say something · @agent to ask",
  }
}

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
 * The queue button's words, the composer's and the conflict prompt's. The
 * title counts the queue when one name stands for more than one waiting.
 */
export function queueWords(place: QueuePlace): {
  readonly button: string
  readonly title: string | null
} {
  const button =
    place.kind === "next"
      ? "queue up next"
      : place.kind === "afterYours"
        ? "queue after yours"
        : `queue after ${place.name}`
  const title =
    place.kind !== "next" && place.ahead > 1
      ? `${place.ahead} waiting ahead`
      : null
  return { button, title }
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
