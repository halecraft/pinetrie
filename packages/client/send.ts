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
} from "@pineta/core"
import { addressChat, parseCommand } from "@pineta/marginalia"
import type { Outcome } from "@pineta/protocol/codec"

export interface SendSettled {
  /**
   * Text to put back in the composer, or null to leave it. A message the host
   * did not write comes back, so nothing typed is lost: a conflict, or a
   * refusal such as a root archived a moment before (ADR-0029).
   */
  readonly restore: string | null
  readonly status: string
  /** A reply another writer raced: the sender chooses to queue or branch. */
  readonly conflict: {
    readonly text: string
    readonly by: string | null
  } | null
}

const ordinal = (n: number): string =>
  n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`

export function settleSend(outcome: Outcome, message: string): SendSettled {
  switch (outcome.kind) {
    case "conflict":
      return {
        restore: message,
        status: "",
        conflict: { text: message, by: outcome.by },
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
 * text that is only its column's prefill is nothing: `@agent ` alone would ask
 * the agent with no question.
 */
export function sendable(
  text: string,
  prefill: string | undefined,
): string | null {
  const message = text.trim()
  return message === "" || message === prefill?.trim() ? null : message
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
  /** Who the agent is answering, or who waits first, by name. */
  readonly holderName: string | null
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
  const button =
    mode === "queue"
      ? queueWords(input.holderName)
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
      !compelled && others.length > 0 ? `to ${to.people.join(", ")}` : null,
    placeholder: agentByDefault(how)
      ? "ask the agent…"
      : "say something · @agent to ask",
  }
}

/** "queue after Bea", or "queue" when no one is named: the button's and the conflict prompt's. */
export const queueWords = (by: string | null): string =>
  by === null ? "queue" : `queue after ${by}`

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
