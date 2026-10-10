// web/use-page — the page over the stage (ADR-0098), kept in the URL's
// hash so the browser's Back leaves it and a reload stays on it. What the
// hash names and how to leave are `page.ts`'s (`@pinetrie/interface`); this
// reads `location` and moves `history`.
//
// `pushState` and `replaceState` fire no event, so `goTo` tells the
// subscribers itself. Back fires `popstate`, and a hash typed in the address
// bar `hashchange`.

import {
  hashOfPage,
  PAGE_STATE,
  type PageName,
  pageOfHash,
  planLeave,
} from "@pinetrie/interface"
import { useSyncExternalStore } from "react"

const told = new Set<() => void>()

const subscribe = (change: () => void): (() => void) => {
  told.add(change)
  window.addEventListener("popstate", change)
  window.addEventListener("hashchange", change)
  return () => {
    told.delete(change)
    window.removeEventListener("popstate", change)
    window.removeEventListener("hashchange", change)
  }
}

const current = (): PageName | null => pageOfHash(location.hash)

/** Show `to` over the stage, or, with null, leave the page shown. */
export function goTo(to: PageName | null): void {
  if (to === current()) return
  if (to !== null) history.pushState(PAGE_STATE, "", hashOfPage(to))
  else if (planLeave(history.state) === "back") {
    // `popstate` tells the subscribers once the entry is back.
    history.back()
    return
  } else history.replaceState(null, "", location.pathname + location.search)
  for (const change of told) change()
}

/** The page this tab shows over the stage, or null. */
export const usePage = (): PageName | null =>
  useSyncExternalStore(subscribe, current)
