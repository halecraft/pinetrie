// client/card-words — what a card says about its place and its command
// (ADR-0048, ADR-0055), each label in one function. Pure.

import type { CardCommand, WriterId } from "@pineta/core"
import { displayName } from "@pineta/marginalia"
import type { Refusal } from "./card-moves.ts"
import { lineWords, type Reader } from "./send.ts"

/**
 * A command's name as people read it: the button's label too. `base` names
 * the thread's base, and the line for `continue-on-line` (ADR-0060).
 */
export const commandWords = (
  command: CardCommand,
  base: string | null = null,
): string => {
  switch (command) {
    case "bring-up-to-date":
      return base === null
        ? "bring up to date"
        : `bring up to date with ${base}`
    case "continue-on-line":
      return base === null ? "continue on the line" : `continue on ${base}`
  }
}

/** A command on a card, named last: what the card is sent through. */
export const commandTag = (command: CardCommand): string =>
  `→ ${commandWords(command)}`

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
 * A move of yours the host refused (ADR-0059). Gone from the queue, the host
 * had taken the card first (S69), so it was sent as its queuer's message;
 * moved, someone else moved it first.
 */
export function refusalWords(refusal: Refusal, reader: Reader): string {
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
