// web-core/page-url — a page that covers the stage, in the browser: its name
// in the URL's hash, and how leaving it treats the browser's history. The
// page's shell (`packages/web/use-page.ts`) reads `location` and `history`
// and carries these out.

import { isPage, type PageName } from "@pinetrie/interface"

/** The page a URL hash names, or null for the stage. */
export function pageOfHash(hash: string): PageName | null {
  const name = hash.startsWith("#") ? hash.slice(1) : ""
  return isPage(name) ? name : null
}

/** The hash that names `page`. */
export const hashOfPage = (page: PageName): string => `#${page}`

/** What a tab stores in `history.state` with the entry it pushes to open a page. */
export const PAGE_STATE = { pinetrie: "page" } as const

/**
 * How to leave a page. "back" when this tab pushed its entry, so Back
 * returns to the stage's entry; "replace" when the page was loaded from
 * its URL, where Back would leave pine·trie.
 */
export function planLeave(historyState: unknown): "back" | "replace" {
  return typeof historyState === "object" &&
    historyState !== null &&
    "pinetrie" in historyState &&
    historyState.pinetrie === PAGE_STATE.pinetrie
    ? "back"
    : "replace"
}
