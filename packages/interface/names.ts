// interface/names — how a speaker, and a message in a label, are shown.
//
// A message keeps the name its writer had when they sent it: that is what the
// agent read, and rewriting it on a rename would change history the agent has
// already seen, and the provider's prompt cache with it. The screen shows who
// that person is NOW, with the name they sent it under when it differs, so a
// message sent before someone named themselves does not read as a stranger's.

import type { WriterId } from "@pinetrie/core"
import { displayName } from "@pinetrie/rules"

/**
 * A message written together names its sender, then the others who wrote it
 * (ADR-0025, ADR-0048): "Ada, with Bea". Each by their current name.
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

/** "Ada, Bea": each writer by their current name, in the order given. */
export const namesOf = (
  nameOf: ReadonlyMap<WriterId, string>,
  writers: readonly WriterId[],
): string => writers.map(w => displayName(w, nameOf.get(w))).join(", ")

/**
 * Whose drafting card this is, and who else wrote in it (ADR-0048): "Ada's
 * draft · with Bea". `writers` are everyone who wrote in it (`writersOfClients`),
 * the owner among them or not.
 */
export function cardHeading(
  nameOf: ReadonlyMap<WriterId, string>,
  owner: WriterId,
  writers: readonly WriterId[],
): string {
  const others = writers.filter(w => w !== owner)
  const whose = `${displayName(owner, nameOf.get(owner))}'s draft`
  return others.length === 0
    ? whose
    : `${whose} · with ${namesOf(nameOf, others)}`
}
