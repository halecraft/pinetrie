// client/use-presence — each part of the screen that shows who else is here
// reads the one presence field it shows (ADR-0024). `useSelector` re-renders
// its reader on every write to that field, the page's own refresh included,
// so only small components call these: never `App`, never a `Column` (S59).

import { useSelector } from "@kyneta/react"
import {
  readingAt,
  seenBy,
  type TreeIndex,
  type WriterId,
  whoIsAt,
} from "@pineta/core"
import { readEditing, readReading, readTyping } from "@pineta/reads"
import type { PresenceDocHandle } from "@pineta/schema"
import { useMemo } from "react"

/** Others following each thread end, you left out (`readingAt`). */
export function useReadingAt(
  presence: PresenceDocHandle,
  me: WriterId,
): ReadonlyMap<string, readonly WriterId[]> {
  const reading = useSelector(presence, readReading)
  return useMemo(() => readingAt(reading, me), [reading, me])
}

/** Others following the thread that ends at `end` (`seenBy`). */
export function useSeenBy(
  presence: PresenceDocHandle,
  me: WriterId,
  index: TreeIndex,
  end: string,
): readonly WriterId[] {
  const reading = useSelector(presence, readReading)
  return useMemo(
    () => seenBy(reading, me, index, end),
    [reading, me, index, end],
  )
}

// Module-level, so `useSelector`'s memo of its read holds.
const FIELDS = { typing: readTyping, editing: readEditing } as const

/**
 * Others whose `field` is `value`, each once: who types at a thread end, who
 * edits a note.
 */
export function useWhoIsAt(
  presence: PresenceDocHandle,
  field: keyof typeof FIELDS,
  me: WriterId,
  value: string,
): readonly WriterId[] {
  const entries = useSelector(presence, FIELDS[field])
  return useMemo(() => whoIsAt(entries, value, me), [entries, value, me])
}
