// participant — who is in a session, and what each is called.
//
// A session is its participants (ADR-0021). A name is a label, never an
// identity: `pineta.participant` values keyed by writer id. Everyone who has
// written is a participant, named or not, so everyone shown on screen can be
// mentioned.

import { emailLocalPart, type WriterId } from "@pineta/core"

/** pi value namespace for display names. The key is the writer's id. */
export const PARTICIPANT_NAMESPACE = "pineta.participant"

/**
 * Stored `pineta.participant` values -> each writer's name. Total: a value that
 * is not a string is skipped, like any malformed stored value.
 */
export function participantNames(
  values: Iterable<{ readonly key: string; readonly value: unknown }>,
): ReadonlyMap<WriterId, string> {
  const out = new Map<WriterId, string>()
  for (const { key, value } of values) {
    if (typeof value === "string") out.set(key as WriterId, value)
  }
  return out
}

/**
 * A writer's name for display: the one they set, or the part of their email
 * before the `@`, so a speaker is never blank (ADR-0037).
 */
export const displayName = (
  writer: WriterId,
  set: string | undefined,
): string => set ?? emailLocalPart(writer)

/**
 * Every participant's display name: each named writer, and each writer in the
 * tree, through `displayName`. The list a mention resolves against, so someone
 * unnamed, shown as `ada.l`, can be mentioned as `@ada.l`'s handle, `@adal`.
 * Sorted, so two readers of one document agree.
 */
export function participants(
  names: ReadonlyMap<WriterId, string>,
  writers: Iterable<WriterId>,
): readonly string[] {
  const all = new Set<WriterId>([...names.keys(), ...writers])
  return [...all].map(w => displayName(w, names.get(w))).sort()
}
