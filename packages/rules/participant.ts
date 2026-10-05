// participant — who is in a session, and what each is called.
//
// A session is its participants (ADR-0021). A name is a label, never an
// identity: a `pinetrie.participant` value is a name, keyed by writer id.
// Everyone who has written is a participant, named or not, so everyone shown
// on screen can be mentioned.

import {
  emailLocalPart,
  type ParticipantRecord,
  type WriterId,
} from "@pinetrie/core"
import { Type } from "typebox"
import { decodeAt, writerKey } from "./decode.ts"
import type { RecordSpec } from "./records.ts"

/**
 * Each writer's name, at the writer's id. The contents are the name alone.
 * Total: contents that are not a string are malformed.
 */
export const PARTICIPANT: RecordSpec<ParticipantRecord, WriterId, "session"> = {
  namespace: "pinetrie.participant",
  home: "session",
  keyOf: r => r.writer,
  encode: r => r.name,
  decode: (contents, key) =>
    decodeAt(Type.String(), contents, writerKey(key), (name, writer) => ({
      writer,
      name,
    })),
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
