// client/card-words — what a card says about its place and its command
// (ADR-0048, ADR-0055), each label in one function. Pure.

import type { CardCommand, ThreadBase, WriterId } from "@pineta/core"
import { baseName, displayName } from "@pineta/marginalia"
import type { Refusal } from "./card-moves.ts"
import { lineWords, type Reader } from "./send.ts"

/**
 * A command's name as people read it: the strip's button. `base` is the
 * thread's (`effectiveBase`); `continue-on-line` always moves it to the
 * project (ADR-0060).
 */
export const commandWords = (
  command: CardCommand,
  base: ThreadBase,
): string => {
  switch (command) {
    case "bring-up-to-date":
      return `catch up with ${baseName(base)}`
    case "continue-on-line":
      return "continue from the project"
  }
}

/**
 * What a card with a command does when sent, above its box, and on a queued
 * one: the command first, then the card's text as the agent's next message.
 */
export const commandNote = (command: CardCommand, base: ThreadBase): string => {
  switch (command) {
    case "bring-up-to-date":
      return `↓ catches up with ${baseName(base)} first, then sends what you write`
    case "continue-on-line":
      return "↓ continues from the project first, then sends what you write"
  }
}

/** A queued card's button that takes it back below the line. */
export const UNQUEUE = "unqueue"

/** The × beside a command: what pressing it does. */
export const CLEAR_COMMAND = "send it as a plain message"

const who = (by: WriterId, reader: Reader): string =>
  by === reader.me ? "you" : displayName(by, reader.nameOf.get(by))

/** A queued card's heading: who queued it, and its place in line, from 0. */
export const queuedWords = (by: WriterId, n: number, reader: Reader): string =>
  `queued by ${who(by, reader)} · ${lineWords(n)}`

/** A card the host could not send, until it is queued again. */
export const unsentWords = (reason: string): string => `not sent: ${reason}`

/**
 * Something of yours refused (ADR-0059): a move or an undo the host
 * refused, or an undone swap whose slots changed. Gone from the queue, the
 * host had taken the card first (S69), so it was sent as its queuer's
 * message; moved, someone else moved it first.
 */
export function refusalWords(refusal: Refusal, reader: Reader): string {
  if (refusal.code === "slots-changed")
    return "not undone: those slots have changed since"
  const { by } = refusal
  switch (refusal.code) {
    case "gone":
      if (!refusal.fromQueue) return "not moved: it was sent or removed first"
      return by === null
        ? "already sent: it was taken before you unqueued it"
        : by === reader.me
          ? "already sent as your message: it was taken before you unqueued it"
          : `already sent as ${displayName(by, reader.nameOf.get(by))}'s message: it was taken before you unqueued it`
    case "moved":
      return by === null
        ? "not moved: someone moved it first"
        : `not moved: ${who(by, reader)} moved it first`
    case "full":
      return "inventory full"
    case "not-yours":
      return "not moved: that inventory is someone else's"
    case "exists":
    case "not-fresh":
      return "not moved"
  }
}

/**
 * What an editor's status line says: what its last send said, else why the
 * host could not send its card, until it is queued again.
 */
export const cardStatus = (status: string, unsent: string | null): string =>
  status !== "" || unsent === null ? status : unsentWords(unsent)

/** The inventory panel's name, and its button in the header. */
export const INVENTORY = "inventory"
/** A card's button that takes it into your inventory; its drag handle too. */
export const TAKE = "take"
export const TAKE_TITLE =
  "take into your inventory (Ctrl+Shift+I) · drag to move"
/** A message's button that takes a copy of it, or of your selection in it. */
export const TAKE_COPY = "take a copy into your inventory"
/** The panel's button that puts the selected card in the column last focused. */
export const PUT = "put"
export const PUT_TITLE =
  "put below the line in the column you were in (Ctrl+Shift+O)"
/** The panel's button that removes the selected card: final. */
export const REMOVE = "remove"
/** Closing a fresh column that holds text: the default, and the final choice. */
export const KEEP_IN_INVENTORY = "keep in inventory"
export const DISCARD = "discard"
/** The close ask's question, by how many cards hold text. */
export const closeAskWords = (n: number): string =>
  n === 1
    ? "keep what you typed in your inventory?"
    : `keep the ${n} cards here in your inventory?`

/** A refusal's React key: what it is about, and why. */
export const refusalKey = (refusal: Refusal): string =>
  `${refusal.code}:${refusal.card ?? ""}`
