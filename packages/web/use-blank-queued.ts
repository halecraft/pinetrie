// web/use-blank-queued — the queued cards that are blank messages, as this
// page holds their texts (`blankQueued`, ADR-0113). A lane with only blank
// cards queued is not waiting, as the host decides it. It changes only when
// a card becomes blank or stops being blank, so typing in a queued card
// redraws nothing that reads it.

import { subscribe } from "@kyneta/schema"
import type { CardId, CardRecord } from "@pinetrie/core"
import { blankQueued } from "@pinetrie/rules"
import { textHolds } from "@pinetrie/schema"
import type { SessionClient } from "@pinetrie/session"
import { useEffect, useMemo, useState } from "react"

const sameSet = (a: ReadonlySet<CardId>, b: ReadonlySet<CardId>): boolean =>
  a.size === b.size && [...a].every(c => b.has(c))

export function useBlankQueued(
  session: Pick<SessionClient, "cardText">,
  cards: readonly CardRecord[],
): ReadonlySet<CardId> {
  const queued = useMemo(
    () => cards.filter(c => c.place.kind === "queued"),
    [cards],
  )
  const read = () =>
    blankQueued(queued, {
      holds: (id, seen) => textHolds(session.cardText(id), seen),
      text: id => session.cardText(id).text(),
    })
  const [blank, setBlank] = useState<ReadonlySet<CardId>>(read)
  const key = queued
    .map(c => `${c.id}:${c.place.kind === "queued" ? c.place.seen : ""}`)
    .join(" ")
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the queued cards and their versions, not the array
  useEffect(() => {
    const update = () => {
      const now = read()
      setBlank(was => (sameSet(was, now) ? was : now))
    }
    update()
    const stops = queued.map(c => subscribe(session.cardText(c.id), update))
    return () => {
      for (const stop of stops) stop()
    }
  }, [key, session])
  return blank
}
