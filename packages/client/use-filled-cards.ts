// client/use-filled-cards — which of your cards hold text (ADR-0048, step 2).
//
// A card's record outlives its text, so the marks read each card's text. A
// subscription of its own, not `useSelector`: Kyneta's `useTracked` renders
// whenever a tracked read fires, with no comparison of values, so a read of
// the texts would render `App` on every keystroke. `withFilled` keeps the
// set's identity until a card flips, and React skips a render for the same
// state.

import { subscribe } from "@kyneta/schema"
import type { CardId, CardRecord } from "@pinetrie/core"
import type { SessionClient } from "@pinetrie/session"
import { useEffect, useState } from "react"
import { holdsText, withFilled } from "./card-marks.ts"

/**
 * The ids of `mine` whose text holds something typed (`holdsText`). A card's
 * text is opened with `cardText`, which is `get`: a card typed on another
 * device must open here, and the browser keeps no store from which Kyneta's
 * `open` could find it. Until its text arrives, a card reads as empty.
 */
export function useFilledCards(
  session: Pick<SessionClient, "cardText">,
  mine: readonly CardRecord[],
): ReadonlySet<CardId> {
  const [filled, setFilled] = useState<ReadonlySet<CardId>>(() => new Set())
  // Keyed on the ids, not the array: `readPlaces` keeps unchanged records, but
  // the filtered list is new whenever any card changes.
  const ids = mine.map(c => c.id).join(" ")
  useEffect(() => {
    const cards = ids === "" ? [] : (ids.split(" ") as CardId[])
    const stops = cards.map(id => {
      const doc = session.cardText(id)
      const read = () =>
        setFilled(prev => withFilled(prev, id, holdsText(doc.text())))
      read()
      return subscribe(doc, read)
    })
    // A card no longer yours, or gone, is no longer counted.
    setFilled(prev => {
      const kept = [...prev].filter(id => cards.includes(id))
      return kept.length === prev.size ? prev : new Set(kept)
    })
    return () => {
      for (const stop of stops) stop()
    }
  }, [ids, session])
  return filled
}
