// e2e/browser/page-kit — what each scenario split from `page` starts with:
// a browser, a host on the scripted model, Ada's page on it, and the helpers
// its steps share. `twoCanvases` makes, through the session, the canvases a
// later scenario starts from, so none depends on another's steps.

import { atEntry, type EntryId, entryId, ROOT, writerId } from "@pinetrie/core"
import { readRoots } from "@pinetrie/reads"
import type { Browser, Page } from "@playwright/test"
import {
  canvasHolding,
  heldTree,
  idleNow,
  join,
  START_AGENT,
  startSuiteHost,
  suiteModel,
  waitFor,
} from "../harness.ts"
import { asPerson, connected, typeAfter } from "./page.ts"

export type SuiteHost = Awaited<ReturnType<typeof startSuiteHost>>

/** A message for Ada only: it names her, so in agent work it asks no one. */
export const FOR_ADA = "@Ada just a note"
/** A message whose markdown draws as other text: what copy copies is not what it shows. */
export const STILL_SOURCE = "still **off** it"
export const STILL = "still off it"
/** The page's person. */
export const ADA_EMAIL = "ada@browser.test"
export const ME = writerId(ADA_EMAIL)
/** Her name once `page` has renamed her in her profile. */
const ADA_RENAMED = "Ada Lovelace"

export const col = (n: number) => `.column[data-position="${n}"]`
// Plain text is drawn as markdown: one paragraph. `:text-is` matches the
// smallest element holding the text, which is that paragraph.
export const msg = (text: string) =>
  `.msg:has(> .text > p:only-child:text-is(${JSON.stringify(text)}))`
/**
 * `STILL`'s message. `msg` finds none: `:text-is` does not match a
 * paragraph whose text is split by a <strong>.
 */
export const stillMsg = (scope: string) =>
  `${scope} .msg:has(> .text > p:only-child:has-text(${JSON.stringify(STILL)}))`

/** The browser, the host and Ada's page, with the helpers over them. */
export async function startKit(browser: Browser) {
  const script = suiteModel()
  const host = await startSuiteHost({
    model: { kind: "scripted", script },
    log: (m: string) => console.log("    [host]", m),
  })
  console.log(`  host              : ${host.httpUrl}\n`)
  /** The canvas the thread `root` starts is in: what the sidebar and the board name it by. */
  // Read while the host holds the root, and kept: an archived canvas's
  // root is let go.
  const canvasByRoot = new Map<string, string>()
  const rootCanvas = (root: string): string => {
    const known = canvasByRoot.get(root)
    if (known !== undefined) return known
    try {
      const canvas = canvasHolding(host, entryId(root))
      canvasByRoot.set(root, canvas)
      return canvas
    } catch {
      return "no-canvas"
    }
  }
  /**
   * The page's message count, on ▦, reaches the host's directory's: it has
   * every root's record, held or not.
   */
  const countIsHosts = (p: Page) =>
    waitFor(async () => {
      let n = 0
      for (const r of readRoots(host.session).values()) n += r.messages
      const shown = await p
        .getAttribute("#bottom .board-toggle", "data-messages")
        .catch(() => null)
      return shown === String(n)
    }, 15_000)

  // An explicit context: a page from `browser.newPage()` owns its context, and
  // Playwright refuses a second tab in it, which the column checks open. It may
  // use the clipboard, so a check can read what copy wrote.
  const page = await (
    await browser.newContext({
      permissions: ["clipboard-read", "clipboard-write"],
    })
  ).newPage()
  const errors: string[] = []
  page.on("pageerror", e => errors.push(String(e.message)))
  page.on("console", m => m.type() === "error" && errors.push(m.text()))

  const label = async (n: number) =>
    (await page.textContent(`${col(n)} .composer .send`))?.trim() ?? ""
  const send = async (n: number, text: string) => {
    await page.fill(`${col(n)} .composer .input`, text)
    await page.click(`${col(n)} .composer .send`)
  }
  /** Send `text` after what column `n`'s box holds: a new canvas's `@agent `. */
  const sendAfter = async (n: number, text: string) => {
    await typeAfter(page, `${col(n)} .composer .input`, text)
    await page.click(`${col(n)} .composer .send`)
  }
  const idle = () => waitFor(() => idleNow(host))
  /** Where the caret is in column `n`'s box, or null if it is not focused. */
  const caretIn = (n: number) =>
    page.$eval(`${col(n)} .composer .input`, box =>
      document.activeElement === box
        ? (box as HTMLTextAreaElement).selectionStart
        : null,
    )
  const shows = (text: string, scope = "") =>
    page
      .waitForSelector(`${scope} ${msg(text)}`.trim(), { timeout: 60_000 })
      .then(
        () => true,
        () => false,
      )
  const texts = (n: number) =>
    page.$$eval(`${col(n)} .msg > .text`, ns =>
      ns.map(t => t.textContent ?? ""),
    )
  const top = (sel: string) =>
    page.$eval(sel, n => n.getBoundingClientRect().top).catch(() => Number.NaN)

  return {
    script,
    host,
    page,
    errors,
    rootCanvas,
    countIsHosts,
    label,
    send,
    sendAfter,
    idle,
    caretIn,
    shows,
    texts,
    top,
    async close() {
      await page.close().catch(() => {})
      await host.shutdown().catch(() => {})
    },
  }
}

export type Kit = Awaited<ReturnType<typeof startKit>>

/**
 * The page as Ada, stored on the device so no form asks, loaded and
 * connected. Throws on React's production build: the render checks would
 * count nothing (`page` checks it once, as a check).
 */
export async function openAsAda(kit: Kit): Promise<void> {
  await asPerson(kit.page, ADA_EMAIL, ADA_RENAMED)
  await kit.page.goto(kit.host.httpUrl, {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  })
  // A page that asks anyway is answered, as she would: whether a reload
  // keeps who you are is a check of its own, not this start's.
  await kit.page.waitForSelector("#identity, #sidebar", { timeout: 20_000 })
  if ((await kit.page.locator("#identity").count()) > 0) {
    await kit.page.fill('#identity input[name="email"]', ADA_EMAIL)
    await kit.page.fill('#identity input[name="name"]', ADA_RENAMED)
    await kit.page.click('#identity button[type="submit"]')
  }
  await connected(kit.page)
  const devReact = await kit.page
    .waitForFunction(
      () =>
        performance
          .getEntriesByType("measure")
          .some(
            e =>
              (e as PerformanceMeasure).detail?.devtools?.track ===
              "Components \u269b",
          ),
      undefined,
      { timeout: 10_000 },
    )
    .then(
      () => true,
      () => false,
    )
  if (!devReact)
    throw new Error("React's production build: the render checks count nothing")
}

/** The root above `entry`, as the host's tree has it. */
const rootAbove = (kit: Kit, entry: EntryId): EntryId => {
  const tree = heldTree(kit.host)
  let at = entry
  for (let up = tree.parentOf(at); up !== null; up = tree.parentOf(at)) at = up
  return at
}

/** The agent's reply to `entry`, as the host's tree has it. */
const replyTo = (kit: Kit, entry: EntryId): EntryId => {
  const tree = heldTree(kit.host)
  const reply = (tree.childrenOf.get(entry) ?? []).find(
    id => tree.entries[id]?.message?.role === "assistant",
  )
  if (reply === undefined) throw new Error(`no reply to ${entry}`)
  return reply
}

/**
 * What `page`'s first part leaves, made through the session as Ada on
 * another device, before her page loads: her name as her profile set it, a
 * first canvas (an agent thread
 * asked twice, a note for Ada between) and the DOWN canvas (an agent thread
 * asked twice, and a chat from its first reply holding "off the record" and
 * `STILL_SOURCE`), both in her sidebar in that order.
 */
export async function twoCanvases(
  kit: Kit,
): Promise<{ readonly firstRoot: EntryId; readonly downRoot: EntryId }> {
  const ada = await join(kit.host, "ada", "browser")
  const idle = () => waitFor(() => idleNow(kit.host), 60_000)
  /** `text` sent at `at`, then the host idle; the entry it made. */
  const said = async (
    text: string,
    at: Parameters<typeof ada.send>[1],
    how: Parameters<typeof ada.send>[2] = {},
  ): Promise<EntryId> => {
    const sent = await ada.send(text, at, how)
    if (sent.kind !== "appended" && sent.kind !== "started")
      throw new Error(`"${text}" was not sent: ${JSON.stringify(sent)}`)
    await idle()
    // A send that starts a run answers with the run, not the entry.
    const tree = heldTree(kit.host)
    const made = Object.keys(tree.entries)
      .map(entryId)
      .filter(id => {
        const m = tree.entries[id]?.message
        return m?.role === "person" && m.content === text
      })
      .sort()
      .at(-1)
    if (made === undefined) throw new Error(`"${text}" is in no entry`)
    return made
  }
  try {
    await ada.request({ kind: "name", name: ADA_RENAMED })
    const firstAsk = await said(
      "@agent Say exactly: BROWSER-OK",
      ROOT,
      START_AGENT,
    )
    const firstRoot = rootAbove(kit, firstAsk)
    const note = await said(FOR_ADA, atEntry(replyTo(kit, firstAsk)))
    await said("@agent say exactly: BROWSER-TWO", atEntry(note))
    const downAsk = await said(
      "@agent say exactly: DOWN-ONE",
      ROOT,
      START_AGENT,
    )
    const downRoot = rootAbove(kit, downAsk)
    const downReply = replyTo(kit, downAsk)
    // In `page`'s order: the chat from the first reply, then the agent
    // thread asked again, then the chat's second message.
    const off = await said("off the record", atEntry(downReply), {
      mode: "branch",
    })
    await said("@agent say exactly: DOWN-TWO", atEntry(downReply))
    await said(STILL_SOURCE, atEntry(off))
    for (const root of [firstRoot, downRoot])
      ada.openThreads.ensure(canvasHolding(kit.host, root))
    await waitFor(() => ada.openThreads.canvases.current().length === 2, 15_000)
    return { firstRoot, downRoot }
  } finally {
    await ada.close()
  }
}
