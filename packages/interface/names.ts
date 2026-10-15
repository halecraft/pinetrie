// interface/names — how a speaker, and a message in a label, are shown.
//
// A message keeps the name its writer had when they sent it: that is what the
// agent read, and rewriting it on a rename would change history the agent has
// already seen, and the provider's prompt cache with it. The screen shows who
// that person is NOW, with the name they sent it under when it differs, so a
// message sent before someone named themselves does not read as a stranger's.

import { LINE_ROLES, PRODUCT_NAME, type WriterId } from "@pinetrie/core"
import { displayName } from "@pinetrie/rules"

/**
 * A message written together names its sender, then the others who wrote it:
 * "Ada, with Bea". Each by their current name.
 */
export const withContributors = (speaker: string, others: readonly string[]) =>
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
 * answered; the agent as "agent"; a line the host wrote (`LINE_ROLES`) as
 * pine·trie, since its own words say what happened; else the role itself.
 */
export function speakerWords(
  message: {
    readonly role?: string
    readonly writer?: WriterId
    readonly author?: string
    readonly contributors?: readonly WriterId[]
  },
  nameOf: ReadonlyMap<WriterId, string>,
): string {
  const role = message.role ?? "unknown"
  if (role === "chat")
    return withContributors(
      speakerLabel(nameOf, message.writer, message.author ?? ""),
      (message.contributors ?? []).map(w => displayName(w, nameOf.get(w))),
    )
  if (role === "relay" || role === "answer") return message.author ?? role
  if (role === "assistant") return "agent"
  if (LINE_ROLES.has(role)) return PRODUCT_NAME
  return role
}

/** "Ada, Bea": each writer by their current name, in the order given. */
export const namesOf = (
  nameOf: ReadonlyMap<WriterId, string>,
  writers: readonly WriterId[],
): string => writers.map(w => displayName(w, nameOf.get(w))).join(", ")
