// e2e/browser/page — what the browser scenarios share: the send button's
// words, menus, frames and render counts, a page made a person, and selectors.

import { errorText } from "@pinetrie/core"
import {
  identityCodec,
  type ListWidth,
  recipientWords,
} from "@pinetrie/interface"
import { NOBODY } from "@pinetrie/threads"
import { COMMIT_MARK } from "@pinetrie/web/commit-marks"
import { IDENTITY_KEY } from "@pinetrie/web/storage-keys"
import type { Browser } from "@playwright/test"
import { chromium, type Page } from "@playwright/test"

// The send button's label to nobody, from the words the composer draws it with.
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
 * Choose `item` in the ⋯ of the card framed by `frame`. A column
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
 * Open `card` in the note column that holds it: its box focused,
 * so the note unfolds. The selector of its frame, which may not be there.
 */
export async function openNote(p: Page, card: string): Promise<string> {
  // A note column you have not opened is folded: unfold each.
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
    .locator('.folded-column[data-kind="note-column"] .unfold')
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
 * Open your profile page from the menu your avatar opens, and
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
 * a slow render's frames are each seen, as a person sees them. The
 * column must be mounted already, so this observer runs after its own.
 */
/** Wait for the next frame. */
export const oneFrame = (p: Page) =>
  p.evaluate(() => new Promise(r => requestAnimationFrame(r)))
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
 * track, with the diff as [label, value] pairs: a label is a
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
 * Wait until the page renders nothing for a quarter second, at most five
 * seconds, and clear what it recorded: the renders counted next are what
 * follows. A step's own writes land a few renders after it resolves.
 */
export async function waitForQuiet(p: Page): Promise<void> {
  await componentRenders(p)
  for (let tries = 0; tries < 20; tries++) {
    await p.waitForTimeout(250)
    if ((await componentRenders(p)).length === 0) return
  }
}

/**
 * Chromium's headless shell. In a lane it comes with the lane's image;
 * on the Mac, install it once:
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
 * rail, the thread and the pane's 40rem beside it. At the
 * default 1280, the pane covers the page.
 */
export const PANE_VIEWPORT = { width: 1440, height: 720 }
/**
 * Wait until the sidebar shows `width`, and say whether it did. A resize
 * folds or unfolds a sidebar nobody has chosen a width for a few frames
 * after `setViewportSize` resolves, so a read straight after one sees the
 * old width.
 */
export const waitForListWidth = (p: Page, width: ListWidth) =>
  p
    .waitForFunction(w => document.documentElement.dataset.list === w, width, {
      timeout: 10_000,
    })
    .then(
      () => true,
      () => false,
    )
/** Column `n` of the strip, by position. */
export const col = (n: number) => `.column[data-position="${n}"]`
/**
 * A plain message by its text. Plain text is drawn as markdown: one
 * paragraph, and `:text-is` matches the smallest element holding the text.
 */
export const msg = (text: string) =>
  `.msg:has(> .text > p:only-child:text-is(${JSON.stringify(text)}))`
/**
 * Open `column`'s details, where its density and fork row are: its status
 * button opens them. Nothing when they are open already.
 */
export const openDetails = (p: Page, column: string) =>
  p
    .click(`${column} .head-status-button[aria-expanded="false"]`, {
      timeout: 5_000,
    })
    .catch(() => {})

/**
 * Read column `n` raw: every message and tool row, which the
 * checks written before densities look at once a run has ended. A column
 * opens in story, folding each ask's work; the choice is kept with it. Its
 * control appears with its first message.
 */
export async function readRaw(p: Page, n = 0): Promise<void> {
  const raw = `${col(n)} .density-choice[data-density="raw"]`
  await openDetails(p, col(n))
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
      document.querySelector("#sidebar .add-canvas") !== null &&
      document.querySelector(".sync-note") === null,
    undefined,
    { timeout },
  )
/**
 * Type `text` into the box `box` after what it holds: a new canvas's
 * `@agent `, so its first send asks the agent, and nothing once it is sent.
 */
export async function typeAfter(
  p: Page,
  box: string,
  text: string,
): Promise<void> {
  await p.focus(box)
  await p.keyboard.press("ControlOrMeta+End")
  await p.keyboard.insertText(text)
}
/** A canvas in the sidebar. */
export const itemSel = (canvas: string) =>
  `#sidebar .open-root[data-canvas="${canvas}"]`
/** A canvas on the board: inside `#board`. */
export const boardSel = (canvas: string) =>
  `.thread-card[data-canvas="${canvas}"]`
/**
 * Step away from the root you are on, so its columns unmount: to a new tab,
 * a canvas of its own holding one thread not yet started, which
 * `stepBack` closes again. The sidebar has nothing else to step to that
 * every scenario holds.
 */
export async function stepAway(p: Page): Promise<void> {
  await p.click("#sidebar .add-canvas")
  await p.waitForSelector(".column[data-card] .trash-column", {
    timeout: 15_000,
  })
}
/**
 * Back on `canvas` from `stepAway`: the new tab's column closed, trashing
 * its thread and its canvas, then `canvas` shown.
 */
export async function stepBack(p: Page, canvas: string): Promise<void> {
  await p.click(".column[data-card] .trash-column")
  await p.click(itemSel(canvas))
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
 * Open canvas `r` from the board: select its item, which shows it
 * and puts it in the sidebar, and wait until you are on it. An archived canvas
 * is found in the archive's rows, by its label's search.
 */
export const openFromBoard = async (p: Page, r: string) => {
  await openBoard(p)
  await p.click(`#board ${boardSel(r)} .board-open`)
  await p.waitForSelector(`${itemSel(r)}[aria-current="true"]`, {
    timeout: 15_000,
  })
}

/**
 * A point of `selector`'s element, in its own box, that the pointer reaches:
 * the first, on a grid of its box from its foot up, that `elementFromPoint`
 * finds inside it. Your inventory, open over the middle of the screen, can
 * cover most of a column's foot; a drag aims where it does not. Its centre
 * when no point is reached, so the drag fails where Playwright says why.
 */
export async function reachable(
  p: Page,
  selector: string,
): Promise<{ x: number; y: number }> {
  return p.$eval(selector, el => {
    const r = el.getBoundingClientRect()
    for (let y = r.height - 4; y > 0; y -= 8)
      for (let x = 8; x < r.width; x += 16) {
        const hit = document.elementFromPoint(r.left + x, r.top + y)
        if (hit !== null && el.contains(hit)) return { x, y }
      }
    return { x: r.width / 2, y: r.height / 2 }
  })
}
