// interface/names — how a speaker, and a message in a label, are shown.
//
// A message keeps the name its writer had when they sent it: that is what the
// agent read, and rewriting it on a rename would change history the agent has
// already seen, and the provider's prompt cache with it. The screen shows who
// that person is NOW, with the name they sent it under when it differs, so a
// message sent before someone named themselves does not read as a stranger's.

import { PRODUCT_NAME, type WriterId } from "@pinetrie/core"
import { displayName } from "@pinetrie/rules"
import {
  isLineRole,
  type PersonMessage,
  type TranscriptMessage,
} from "@pinetrie/threads"

/**
 * A message written together names its sender, then the others who wrote it:
 * "Ada, with Bea". Each by their current name.
 */
const withContributors = (speaker: string, others: readonly string[]) =>
  others.length === 0 ? speaker : `${speaker}, with ${others.join(", ")}`

/** "Duane (duane)" when the name has changed since; "Duane" when it has not. */
export function speakerLabel(
  current: ReadonlyMap<string, string>,
  writer: string | undefined,
  asSent: string,
): string {
  const now = writer === undefined ? undefined : current.get(writer)
  return now === undefined || now === asSent ? asSent : `${now} (${asSent})`
}

/**
 * Who a message is from, as its column names it: a person by their name now
 * (`speakerLabel`), with those who wrote it with them (`withContributors`);
 * another thread's ask by its asker, and an answer by the thread that
 * answered; the agent as "agent"; a line the host wrote (`isLineRole`) as
 * pine·trie, since its own words say what happened; else the role itself.
 */
export function speakerWords(
  message: TranscriptMessage,
  nameOf: ReadonlyMap<WriterId, string>,
): string {
  switch (message.role) {
    case "person":
      return personWords(message, nameOf)
    case "relay":
    case "answer":
      return message.author
    case "assistant":
      return "agent"
    default:
      return isLineRole(message.role) ? PRODUCT_NAME : message.role
  }
}

/** A person's message's speaker, as `speakerWords` names it. */
export const personWords = (
  message: Pick<PersonMessage, "writer" | "author" | "contributors">,
  nameOf: ReadonlyMap<WriterId, string>,
): string =>
  withContributors(
    speakerLabel(nameOf, message.writer, message.author),
    (message.contributors ?? []).map(w => displayName(w, nameOf.get(w))),
  )

/** "Ada, Bea": each writer by their current name, in the order given. */
export const writerNames = (
  nameOf: ReadonlyMap<WriterId, string>,
  writers: readonly WriterId[],
): string => writers.map(w => displayName(w, nameOf.get(w))).join(", ")
