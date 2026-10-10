// e2e/browser/page — what the browser scenarios share: the send button's
// words, menus, frames and render counts, a page made a person, and selectors.

import { errorText, NOBODY, THE_AGENT } from "@pinetrie/core"
import { identityCodec, recipientWords } from "@pinetrie/interface"
import { COMMIT_MARK } from "@pinetrie/web/commit-marks"
import { IDENTITY_KEY } from "@pinetrie/web/storage-keys"
import type { Browser } from "@playwright/test"
import { chromium, type Page } from "@playwright/test"

// The send button's labels, from the words the composer draws them with.
export const TO_AGENT = recipientWords({
  compels: { kind: "agent", agent: THE_AGENT },
  people: [],
  asks: [],
  invites: [],
}).label
export const TO_NOBODY = recipientWords({
  compels: NOBODY,
  people: [],
  asks: [],
  invites: [],
}).label

/** The ⋯ of the root you are on in the sidebar: every root has one, shown on hover or focus. */
export const OWN_MENU = '#sidebar [aria-current="true"] ~ .open-more .open-menu'

/**
 * Open the menu behind `trigger`, and find `item` in it if a person could see
 * it: Playwright scrolls a clipped element into view and clicks it, so a menu
 * check proves it can be seen by what `elementFromPoint` finds at the item's
 * centre (`packages/web/TECHNICAL.md`, Gotchas). Null when not seen.
 */
export async function seeInMenu(p: Page, trigger: string, item: string) {
  // A ⋯ in the sidebar or on the board shows only while its item is hovered.
  const holder = p
    .locator(trigger)
    .first()
    .locator(
      "xpath=ancestor::*[contains(@class,'sidebar-item') or contains(@class,'thread-card')][1]",
    )
  if ((await holder.count()) > 0) await holder.hover()
  await p.click(trigger)
  const el = await p
    .waitForSelector(`.menu ${item}`, { timeout: 15_000 })
    .catch(() => null)
  if (el === null) return null
  const seen = await el.evaluate(n => {
    const r = n.getBoundingClientRect()
    const hit = document.elementFromPoint(
      r.left + r.width / 2,
      r.top + r.height / 2,
    )
    return hit !== null && n.contains(hit)
  })
  return seen ? el : null
}

/**
 * `seeInMenu`, then choose the item. Whether it was chosen: one not seen, or
 * disabled, is not clicked, and the menu is closed. Playwright would wait 30 s
 * for a disabled item and throw, which ended the suite at that check.
 */
export async function chooseFromMenu(
  p: Page,
  trigger: string,
  item: string,
): Promise<boolean> {
  const el = await seeInMenu(p, trigger, item)
  if (el === null || !(await el.isEnabled())) {
    await p.keyboard.press("Escape")
    return false
  }
  // A menu that closes under the click (its list scrolled) chose nothing.
  return el.click().then(
    () => true,
    () => false,
  )
}

/**
 * Choose `item` in the ⋯ of the card framed by `frame` (ADR-0111). A column
 * that scrolls as its cards change closes a menu it holds (`popover.tsx`),
 * so the menu is opened again until the item is chosen. Whether it was.
 */
export async function chooseOnCard(
  p: Page,
  frame: string,
  item: string,
): Promise<boolean> {
  const trigger = `${frame} .card-menu-trigger`
  for (let tries = 0; tries < 3; tries++) {
    // The Escape that closes a menu not chosen from also folds a grid's
    // open card, and its ⋯ with it.
    if (tries > 0 && (await p.locator(trigger).count()) === 0) return false
    if (await chooseFromMenu(p, trigger, item)) return true
  }
  return false
}

/**
 * Open `card` in the note column that holds it (ADR-0116): its box focused,
 * so the note unfolds. The selector of its frame, which may not be there.
 */
export async function openNote(p: Page, card: string): Promise<string> {
  // A note column you have not opened is folded (ADR-0116): unfold each.
  const textarea = `.note-column textarea[data-card="${card}"]`
  await p
    .waitForFunction(
      t =>
        document.querySelector(t) !== null ||
        document.querySelector('.folded-column[data-kind="note-column"]') !==
          null,
      textarea,
      { timeout: 10_000 },
    )
    .catch(() => {})
  for (const folded of await p
    .locator('.folded-column[data-kind="note-column"] .folded-title')
    .all())
    await folded.click().catch(() => {})
  await p
    .locator(`.note-column textarea[data-card="${card}"]`)
    .focus({ timeout: 10_000 })
    .catch(() => {})
  return `.note-column .card-frame:has(textarea[data-card="${card}"])`
}

/** Your name as the page shows it: the one mentions resolve against. */
export const shownName = async (p: Page) =>
  (await p.getAttribute("#bottom .me-trigger", "title")) ?? ""

/** The name this device keeps for you (`pinetrie-identity`), or null. */
export const storedName = (p: Page) =>
  p.evaluate(key => {
    const raw = localStorage.getItem(key)
    return raw === null ? null : (JSON.parse(raw) as { name?: string }).name
  }, IDENTITY_KEY)

/**
 * Open your profile page from the menu your avatar opens (ADR-0098), and
 * whether a person could see it: `elementFromPoint` at its centre, as
 * `seeInMenu` checks a menu.
 */
export async function openProfile(p: Page): Promise<boolean> {
  if (!(await chooseFromMenu(p, "#bottom .me-trigger", ".account-profile")))
    return false
  const box = await p
    .waitForSelector('.page[data-page="profile"]', { timeout: 15_000 })
    .catch(() => null)
  if (box === null) return false
  return box.evaluate(n => {
    const r = n.getBoundingClientRect()
    const hit = document.elementFromPoint(
      r.left + r.width / 2,
      r.top + r.height / 2,
    )
    return hit !== null && n.contains(hit)
  })
}

/** In the page: the messages its rail draws, a dot each and a capsule's count. */
export const RAIL_MESSAGES = () =>
  document.querySelectorAll(".rail .rail-dot").length +
  [...document.querySelectorAll(".rail .rail-stretch")].reduce(
    (n, run) => n + Number(run.getAttribute("data-count")),
    0,
  )

/** One sample of a column, as `recordFrames` takes it. */
interface ColumnFrame {
  /**
   * `frame`: at an animation frame, before layout, so its DOM is what is
   * painted but its height may not be. `resize`: in a ResizeObserver callback
   * after `useFollow`'s, so its height is what is painted.
   */
  readonly at: "frame" | "resize"
  /** The column body's scroll height. */
  readonly height: number
  readonly clientHeight: number
  /** Branch chips drawn in it (`.open-branch`). */
  readonly chips: number
  /** The agent's messages drawn in it, a reply being written included. */
  readonly steps: number
  /** Its thread's lane is running: its composer offers Stop. */
  readonly running: boolean
  /** Each tool row's command drawn (`.tool-command`), as text: no tag. */
  readonly labels: readonly string[]
}

/**
 * Sample column `c` on every animation frame and every change of its size, in
 * the page, until the returned function stops it and hands back what it saw:
 * a slow render's frames are each seen, as a person sees them (S35). The
 * column must be mounted already, so this observer runs after its own.
 */
/** Wait two frames: a change's layout, its ResizeObserver callbacks and its paint have run. */
export const twoFrames = (p: Page) =>
  p.evaluate(
    () =>
      new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))),
  )

export async function recordFrames(
  p: Page,
  c: string,
): Promise<() => Promise<readonly ColumnFrame[]>> {
  await p.evaluate(sel => {
    const w = window as unknown as { __frames: unknown[]; __recording: boolean }
    w.__frames = []
    w.__recording = true
    const column = document.querySelector(sel)
    const body = column?.querySelector(".column-body")
    const sample = (at: "frame" | "resize") =>
      w.__frames.push({
        at,
        height: body?.scrollHeight ?? 0,
        clientHeight: body?.clientHeight ?? 0,
        chips: column?.querySelectorAll(".open-branch").length ?? 0,
        steps: column?.querySelectorAll(".msg.assistant").length ?? 0,
        running: column?.querySelector(".stop") != null,
        labels: [...(column?.querySelectorAll(".tool-command") ?? [])].map(
          l => l.textContent ?? "",
        ),
      })
    const tick = () => {
      if (!w.__recording) return
      sample("frame")
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    const resized = new ResizeObserver(() => {
      if (w.__recording) sample("resize")
    })
    const content = column?.querySelector(".column-content")
    if (content != null) resized.observe(content)
    if (body != null) resized.observe(body)
  }, c)
  return () =>
    p.evaluate(() => {
      const w = window as unknown as {
        __frames: ColumnFrame[]
        __recording: boolean
      }
      w.__recording = false
      return w.__frames
    })
}

/**
 * The component renders the page recorded since the last call, and clears
 * them. React's development build, which the host's Vite serves, measures
 * every render whose props its diff finds changed on its "Components ⚛"
 * track, with the diff as [label, value] pairs (S54): a label is a
 * two-character mark, an indent, then the prop's name. A render whose props
 * are new objects with the same data is not measured, so a message list also
 * marks each of its commits (`markCommit`), counted here with no props. Both
 * are written in passive effects, which can run after the DOM a check waits
 * for has changed, so it reads two frames later.
 */
export const componentRenders = (p: Page) =>
  p.evaluate(async prefix => {
    await new Promise(done =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => setTimeout(done, 0)),
      ),
    )
    const measured = performance.getEntriesByType("measure").flatMap(e => {
      const d = (e as PerformanceMeasure).detail?.devtools
      if (d?.track !== "Components \u269b") return []
      const props: string[] = (d.properties ?? []).map(
        (pair: readonly string[]) => pair[0] ?? "",
      )
      return [{ name: e.name.replace("\u200b", ""), props }]
    })
    const marked = performance
      .getEntriesByType("mark")
      .filter(e => e.name.startsWith(prefix))
    for (const name of new Set(marked.map(e => e.name)))
      performance.clearMarks(name)
    performance.clearMeasures()
    return [
      ...measured,
      ...marked.map(e => ({
        name: e.name.slice(prefix.length),
        props: [] as string[],
      })),
    ]
  }, COMMIT_MARK)

/**
 * Chromium's headless shell. In a lane it comes with the lane's image
 * (ADR-0041); on the Mac, install it once:
 *
 *     pnpm --filter @pinetrie/app exec playwright install chromium-headless-shell
 */
export async function launchBrowser(): Promise<Browser> {
  try {
    return await chromium.launch()
  } catch (error: unknown) {
    const detail = errorText(error)
    throw new Error(
      `could not launch Chromium: ${detail.split("\n")[0]}. Install it once: pnpm --filter @pinetrie/app exec playwright install chromium-headless-shell`,
    )
  }
}

/**
 * Make `p` a person before it loads: what the identity form would have
 * stored. A page from `browser.newPage()` has a context, and so a device, of
 * its own, which would otherwise ask.
 */
export const asPerson = (p: Page, email: string, name: string) =>
  p.addInitScript(([key, value]) => localStorage.setItem(key, value), [
    IDENTITY_KEY,
    JSON.stringify(identityCodec.encode({ email, name })),
  ] as const)
/**
 * A page that opens a column's pane: wide enough for your full list, the
 * rail, the thread and the pane's 40rem beside it (ADR-0087). At the
 * default 1280, the pane covers the page.
 */
export const PANE_VIEWPORT = { width: 1440, height: 720 }
/** Column `n` of the strip, by position. */
export const col = (n: number) => `.column[data-position="${n}"]`
/**
 * A plain message by its text. Plain text is drawn as markdown: one
 * paragraph, and `:text-is` matches the smallest element holding the text.
 */
export const msg = (text: string) =>
  `.msg:has(> .text > p:only-child:text-is(${JSON.stringify(text)}))`
/**
 * Read column `n` raw (ADR-0106): every message and tool row, which the
 * checks written before densities look at once a run has ended. A column
 * opens in story, folding each ask's work; the choice is kept with it. Its
 * control appears with its first message.
 */
export async function readRaw(p: Page, n = 0): Promise<void> {
  const raw = `${col(n)} .density-choice[data-density="raw"]`
  const shown = await p.waitForSelector(raw, { timeout: 15_000 }).then(
    () => true,
    () => false,
  )
  if (!shown) return
  if ((await p.getAttribute(raw, "aria-pressed")) !== "true") await p.click(raw)
}
/**
 * Wait until `p` has connected and synced: the sidebar is drawn, which waits
 * for the document to settle, and it shows no "syncing…". Rejects after
 * `timeout`.
 */
export const connected = (p: Page, timeout = 20_000) =>
  p.waitForFunction(
    () =>
      document.querySelector("#sidebar .add-agent") !== null &&
      document.querySelector(".sync-note") === null,
    undefined,
    { timeout },
  )
/** A task in the sidebar (ADR-0122, ADR-0116). */
export const itemSel = (task: string) =>
  `#sidebar .open-root[data-task="${task}"]`
/** A task on the board: inside `#board`. */
export const boardSel = (task: string) => `.thread-card[data-task="${task}"]`
/**
 * Step away from the root you are on, so its columns unmount: to a new tab,
 * which is closed again by `stepBack`. The sidebar has nothing else to step to
 * that every scenario holds.
 */
export async function stepAway(p: Page): Promise<void> {
  await p.click("#sidebar .add-agent")
  await p.waitForSelector('#sidebar .open-new[aria-current="true"]', {
    timeout: 15_000,
  })
}
/** Back on `task` from `stepAway`, and the new tab closed. */
export async function stepBack(p: Page, task: string): Promise<void> {
  await p.click(itemSel(task))
  await p.$$eval("#sidebar .open-new ~ .open-close", bs => {
    for (const b of bs) (b as HTMLButtonElement).click()
  })
}
/**
 * Open the board, unless it is open. A page with nothing in its list opens
 * it itself once settled, so it waits for that first.
 */
export async function openBoard(p: Page): Promise<void> {
  await connected(p)
  if ((await p.$("#board")) === null) await p.click("#bottom .board-toggle")
  await p.waitForSelector("#board", { timeout: 15_000 })
}
/** The messages the rail on `p` accounts for: dots, and each stretch's count. */
export const railCount = (p: Page) => p.evaluate(RAIL_MESSAGES)
/**
 * Open task `r` from the board (ADR-0122): select its item, which shows it
 * and puts it in the sidebar, and wait until you are on it. An archived task
 * is found in the archive's rows, by its label's search.
 */
export const openFromBoard = async (p: Page, r: string) => {
  await openBoard(p)
  await p.click(`#board ${boardSel(r)} .board-open`)
  await p.waitForSelector(`${itemSel(r)}[aria-current="true"]`, {
    timeout: 15_000,
  })
}
