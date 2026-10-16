// web/use-presence — each part of the screen that shows who else is here reads
// the one presence field it shows. `useSelector` re-renders its reader on every
// write to that field, the page's own refresh included, so only small
// components call these: never `App`, never a `Column`.

import { useSelector } from "@kyneta/react"
import type { CanvasId, EntryId, TreeIndex, WriterId } from "@pinetrie/core"
import { readingAt, seenBy, whoIsAt } from "@pinetrie/interface"
import { readReading, readReadingCanvases, readTyping } from "@pinetrie/reads"
import type { PresenceDocHandle } from "@pinetrie/schema"
import { useMemo } from "react"

/** Others reading each thread end, you left out (`readingAt`). */
export function useReadingAt(
  presence: PresenceDocHandle,
  me: WriterId,
): ReadonlyMap<EntryId, readonly WriterId[]> {
  const reading = useSelector(presence, readReading)
  return useMemo(() => readingAt(reading, me), [reading, me])
}

/** The canvas each thread end being read was reported on. */
export function useReadingCanvases(
  presence: PresenceDocHandle,
): ReadonlyMap<EntryId, CanvasId> {
  return useSelector(presence, readReadingCanvases)
}

/** Others reading the thread that ends at `end` (`seenBy`). */
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
