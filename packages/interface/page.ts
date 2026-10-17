// interface/page — a page that covers the stage: its name in the URL's hash,
// how leaving it treats the browser's history, and its words. The page's shell
// (`use-page.ts`) reads `location` and `history` and carries these out.

/** A page that covers the stage: your profile, what the host read of its config, and a folder project's history. */
export type PageName = "profile" | "setup" | "history"

const PAGES: readonly PageName[] = ["profile", "setup", "history"]

const isPage = (name: string): name is PageName =>
  (PAGES as readonly string[]).includes(name)

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

interface PageWords {
  /** The page's heading, and the window's title while it shows. */
  readonly title: string
  readonly back: string
}

const TITLES: Readonly<Record<PageName, string>> = {
  profile: "Profile",
  setup: "Setup",
  history: "History",
}

/** What a way back says: a page's, and the account menu's from the inbox. */
export const BACK = "← back"

export const pageWords = (page: PageName): PageWords => ({
  title: TITLES[page],
  back: BACK,
})

/** The profile page's own words, beside the name field's (`nameHint`). */
export const profileWords = { save: "save", saved: "saved" } as const
