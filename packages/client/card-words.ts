// client/card-words — what a card says about its place and its command
// (ADR-0048, ADR-0055), each label in one function. Pure.

import type { CardCommand, WriterId } from "@pineta/core"
import { displayName } from "@pineta/marginalia"
import { lineWords, type Reader } from "./send.ts"

/** A command's name as people read it: the button's label too. */
export const commandWords = (command: CardCommand): string => {
  switch (command) {
    case "bring-up-to-date":
      return "bring up to date"
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
 * An unqueue that lost (S69): the host had taken the card, so it was sent
 * as its queuer's message.
 */
export const alreadySentWords = (by: WriterId, reader: Reader): string =>
  by === reader.me
    ? "already sent as your message: it was taken before you unqueued it"
    : `already sent as ${displayName(by, reader.nameOf.get(by))}'s message: it was taken before you unqueued it`

/**
 * What an editor's status line says: what its last send said, else why the
 * host could not send its card, until it is queued again.
 */
export const cardStatus = (status: string, unsent: string | null): string =>
  status !== "" || unsent === null ? status : unsentWords(unsent)
