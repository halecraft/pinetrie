// web/use-card-texts — the texts of several cards, for their faces: your
// inventory's and a notes board's.

import { subscribe } from "@kyneta/schema"
import type { TextCardId } from "@pinetrie/core"
import type { SessionClient } from "@pinetrie/session"
import { useEffect, useState } from "react"

/**
 * The text of each card in `ids`, read from its document and kept current.
 * A card's text arrives after its record, so one not yet read is "".
 */
export function useCardTexts(
  session: Pick<SessionClient, "cardText">,
  ids: readonly TextCardId[],
): ReadonlyMap<TextCardId, string> {
  const [texts, setTexts] = useState<ReadonlyMap<TextCardId, string>>(new Map())
  const key = ids.join(" ")
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the ids, not the array
  useEffect(() => {
    const stops = ids.map(id => {
      const doc = session.cardText(id)
      const read = () =>
        setTexts(prev =>
          prev.get(id) === doc.text()
            ? prev
            : new Map(prev).set(id, doc.text()),
        )
      read()
      return subscribe(doc, read)
    })
    return () => {
      for (const stop of stops) stop()
    }
  }, [key, session])
  return texts
}
