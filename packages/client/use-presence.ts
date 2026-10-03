// client/use-presence — each part of the screen that shows who else is here
// reads the one presence field it shows (ADR-0024). `useSelector` re-renders
// its reader on every write to that field, the page's own refresh included,
// so only small components call these: never `App`, never a `Column` (S59).

import { useSelector } from "@kyneta/react"
import {
  type EntryId,
  readingAt,
  seenBy,
  type TreeIndex,
  type WriterId,
  whoIsAt,
} from "@pineta/core"
import { readReading, readReadingRoots, readTyping } from "@pineta/reads"
import type { PresenceDocHandle } from "@pineta/schema"
import { useMemo } from "react"

/** Others following each thread end, you left out (`readingAt`). */
export function useReadingAt(
  presence: PresenceDocHandle,
  me: WriterId,
): ReadonlyMap<EntryId, readonly WriterId[]> {
  const reading = useSelector(presence, readReading)
  return useMemo(() => readingAt(reading, me), [reading, me])
}

/** The root each followed thread end's reader reported (ADR-0063). */
export function useReadingRoots(
  presence: PresenceDocHandle,
): ReadonlyMap<EntryId, EntryId> {
  return useSelector(presence, readReadingRoots)
}

/** Others following the thread that ends at `end` (`seenBy`). */
export function useSeenBy(
  presence: PresenceDocHandle,
  me: WriterId,
  index: TreeIndex,
  end: EntryId,
): readonly WriterId[] {
  const reading = useSelector(presence, readReading)
  return useMemo(
    () => seenBy(reading, me, index, end),
    [reading, me, index, end],
  )
}

/** Others typing in the composer at the thread end `end`, each once (`whoIsAt`). */
export function useTypingAt(
  presence: PresenceDocHandle,
  me: WriterId,
  end: EntryId,
): readonly WriterId[] {
  const entries = useSelector(presence, readTyping)
  return useMemo(() => whoIsAt(entries, end, me), [entries, end, me])
}
