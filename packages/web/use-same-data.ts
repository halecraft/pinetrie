// web/use-same-data — a value kept by identity while its data is unchanged.

import { sameData } from "@pinetrie/interface"
import { useRef } from "react"

/**
 * `value`, or the one given last render when the two are the same data
 * (`sameData`): what memos keyed on it see as unchanged. For a small value
 * rebuilt from something that changes for reasons it does not show, such as
 * the tab's columns, rebuilt from the cards on every card's change.
 */
export function useSameData<T>(value: T): T {
  const kept = useRef(value)
  if (!sameData(kept.current, value)) kept.current = value
  return kept.current
}
