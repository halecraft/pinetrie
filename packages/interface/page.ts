// interface/page — a page that covers the stage, and its words. How the web
// client names one in its URL's hash, and leaves it in the browser's history,
// is web-core's (`page-url.ts`).

/** A page that covers the stage: your profile, what the host read of its config, and a folder project's history. */
export type PageName = "profile" | "setup" | "history"

const PAGES: readonly PageName[] = ["profile", "setup", "history"]

/** Whether `name` names a page. */
export const isPage = (name: string): name is PageName =>
  (PAGES as readonly string[]).includes(name)

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
