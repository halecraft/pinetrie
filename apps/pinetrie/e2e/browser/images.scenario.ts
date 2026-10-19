// e2e/browser/images — an image pasted into the composer, opened in the
// column's pane, as a table is; a file dropped on a card, shared as a chip;
// and a tool's image, drawn in its row, which opens capped.

import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { writerId } from "@pinetrie/core"
import { UPLOADING } from "@pinetrie/interface"
import { blobSha256, scriptedModel } from "@pinetrie/pi"
import type { CDPSession, Page } from "@playwright/test"
import type { Checks } from "../checks.ts"
import { idleNow, startSuiteHost, suiteModel, waitFor } from "../harness.ts"
import { greyPng, RED_PNG } from "../images.ts"
import type { LaneHosts } from "../lane-hosts.ts"
import type { Scenario } from "../scenario.ts"

import {
  asPerson,
  chooseFromMenu,
  col,
  launchBrowser,
  openProfile,
  PANE_VIEWPORT,
  readRaw,
  typeAfter,
} from "./page.ts"

export const scenario: Scenario = {
  lanes: true,
  run: ({ check }, { lanes }) => run(check, lanes),
}

async function run(check: Checks["check"], lanes: LaneHosts): Promise<void> {
  const browser = await launchBrowser()
  try {
    {
      const imageHost = await startSuiteHost({
        model: { kind: "scripted", script: suiteModel() },
        log: () => {},
      })
      const ppContext = await browser.newContext({ viewport: PANE_VIEWPORT })
      // A copy writes the clipboard, which the checks read.
      await ppContext.grantPermissions(["clipboard-read", "clipboard-write"])
      const pp = await ppContext.newPage()
      await asPerson(pp, "pia@browser.test", "Pia")
      const qp = await (await browser.newContext()).newPage()
      await asPerson(qp, "quinn@browser.test", "Quinn")
      try {
        await pp.goto(imageHost.httpUrl, { waitUntil: "domcontentloaded" })
        await pp.click("#sidebar .add-canvas")
        const box = `${col(0)} .composer .input`
        const sendButton = `${col(0)} .composer .send`
        await typeAfter(pp, box, "what colour is this?")
        // Uploads are held a moment, so the composer is seen waiting for one.
        let release = () => {}
        const held = new Promise<void>(resolve => {
          release = resolve
        })
        await pp.route("**/blob", async route => {
          await held
          await route.continue()
        })
        /** Paste `base64` as a PNG file named `name` into column 0's box. */
        const paste = (base64: string, name: string) =>
          pp.evaluate(
            ([sel, b64, fileName]) => {
              const input = document.querySelector(sel)
              if (!(input instanceof HTMLTextAreaElement)) return false
              input.focus()
              input.setSelectionRange(input.value.length, input.value.length)
              const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
              const data = new DataTransfer()
              data.items.add(new File([bytes], fileName, { type: "image/png" }))
              const event = new ClipboardEvent("paste", {
                clipboardData: data,
                bubbles: true,
                cancelable: true,
              })
              input.dispatchEvent(event)
              return event.defaultPrevented
            },
            [box, base64, name] as const,
          )
        const prevented = await paste(RED_PNG.toString("base64"), "red.png")
        const waiting = await pp
          .waitForFunction(
            ([sel, uploading]) => {
              const b = document.querySelector(sel)
              return (
                b instanceof HTMLButtonElement &&
                b.disabled &&
                b.textContent?.trim() === uploading
              )
            },
            [sendButton, UPLOADING] as const,
            { timeout: 5_000 },
          )
          .then(
            () => true,
            () => false,
          )
        release()
        const sha = blobSha256(RED_PNG)
        const markdown = `![red.png](/blob/${sha})`
        const inserted = await pp
          .waitForFunction(
            ([sel, md]) =>
              (document.querySelector(sel) as HTMLTextAreaElement | null)
                ?.value === `@agent what colour is this?\n${md}`,
            [box, markdown] as const,
            { timeout: 10_000 },
          )
          .then(
            () => true,
            () => false,
          )
        check(
          "pasting an image uploads it, the send waits for it, and its markdown goes in at the cursor",
          prevented && waiting && inserted,
          `${prevented}, ${waiting}, ${inserted}`,
        )
        await pp.click(sendButton)
        const drawn = `${col(0)} .msg img.blob-image[src="/blob/${sha}"]`
        /** The image at `at`, once it has loaded: its sizes; null if it never does. */
        const loaded = (p: Page, at = drawn, timeout = 15_000) =>
          p
            .waitForFunction(
              sel => {
                const img = document.querySelector(sel)
                return img instanceof HTMLImageElement &&
                  img.complete &&
                  img.naturalWidth > 0
                  ? [img.naturalWidth, img.getAttribute("width")]
                  : null
              },
              at,
              { timeout },
            )
            .then(
              h => h.jsonValue(),
              () => null,
            )
        const mine = await loaded(pp)
        check(
          "the sent message draws the image, at its stored width",
          JSON.stringify(mine) === JSON.stringify([40, "40"]),
          `${JSON.stringify(mine)}`,
        )
        await qp.goto(imageHost.httpUrl, { waitUntil: "domcontentloaded" })
        // A window with nothing in its list opens on the board, where the
        // other window's reader avatar leads to its thread.
        await qp
          .waitForSelector("#board .reader-trigger", { timeout: 20_000 })
          .catch(() => null)
        await chooseFromMenu(qp, "#board .reader-trigger", ".here-thread")
        const theirs = await loaded(qp)
        check(
          "another window draws it too",
          JSON.stringify(theirs) === JSON.stringify([40, "40"]),
          `${JSON.stringify(theirs)}`,
        )
        // A click opens it in the column's pane, beside the thread.
        const pages: Page[] = []
        pp.context().on("page", p => pages.push(p))
        const url = pp.url()
        const pane = `${col(0)} > .pane`
        await pp.click(drawn)
        // The pane beside the thread: the thread's 28rem, and both inside
        // the strip. Opening scrolls the pane into view, so a pane too wide
        // pushes the thread out on the left instead.
        const measure = () =>
          pp.evaluate(
            ([column, panel]) => {
              const thread = document.querySelector(
                `${column} > .column-thread`,
              )
              const shown = document.querySelector(panel)
              const s = document
                .querySelector("#strip")
                ?.getBoundingClientRect()
              if (thread === null || shown === null || s === undefined)
                return null
              const rem = Number.parseFloat(
                getComputedStyle(document.documentElement).fontSize,
              )
              const t = thread.getBoundingClientRect()
              const q = shown.getBoundingClientRect()
              return {
                thread: Math.round(t.width) === Math.round(28 * rem),
                right: q.left >= t.right - 1,
                inside: t.left >= s.left - 0.5 && q.right <= s.right + 0.5,
                pane: Math.round(q.width),
              }
            },
            [col(0), pane] as const,
          )
        const full = await pp
          .waitForSelector(`${pane} .pane-image img[src="/blob/${sha}"]`, {
            timeout: 5_000,
          })
          .then(measure, () => null)
        // Folded to icons, the strip widens and the pane with it.
        await pp.click("#sidebar .list-fold")
        const folded = await pp
          .waitForFunction(
            () => document.documentElement.dataset.list === "icons",
            null,
            { timeout: 5_000 },
          )
          .then(measure, () => null)
        await pp.click("#sidebar .list-fold")
        check(
          "a click on an image opens it beside the thread, which keeps its 28rem, inside the strip, and no new tab",
          [full, folded].every(
            m => m?.thread === true && m.right && m.inside,
          ) &&
            (folded?.pane ?? 0) > (full?.pane ?? 0) &&
            pages.length === 0 &&
            pp.url() === url,
          `${JSON.stringify({ full, folded })}, ${pages.length} new pages`,
        )
        await pp.click(`${pane} .pane-close`)
        // A person's table, long enough to scroll the pane.
        await waitFor(() => idleNow(imageHost))
        await pp.fill(
          box,
          [
            "| n | what |",
            "|---|---|",
            ...Array.from({ length: 80 }, (_, i) => `| ${i} | row ${i} |`),
          ].join("\n"),
        )
        await pp.click(sendButton)
        const open = `${col(0)} .msg[data-entry] .table-wrap .table-open`
        await pp.click(open, { timeout: 15_000 })
        const table = `${pane} .pane-table`
        const pinned = await pp
          .waitForSelector(`${table} thead th`, { timeout: 5_000 })
          .then(
            () =>
              pp.$eval(`${pane} .pane-body`, body => {
                body.scrollTop = 600
                const th = body.querySelector("thead th")
                return {
                  scrolled: body.scrollTop > 0,
                  top:
                    th === null
                      ? null
                      : Math.round(
                          th.getBoundingClientRect().top -
                            body.getBoundingClientRect().top,
                        ),
                }
              }),
            () => null,
          )
        check(
          "a table's ⤢ opens it in the pane, its header row pinned as the pane scrolls",
          pinned?.scrolled === true &&
            pinned.top !== null &&
            Math.abs(pinned.top) <= 1,
          `${JSON.stringify(pinned)}`,
        )
        // Over a narrow window, the pane is a modal dialog over the page.
        await pp.click(open)
        const size = pp.viewportSize()
        await pp.setViewportSize({ width: 900, height: size?.height ?? 720 })
        await pp.click(open)
        const covers = await pp
          .waitForSelector("dialog.pane[open] .pane-table", { timeout: 5_000 })
          .then(
            () =>
              pp.evaluate(() => {
                const d = document.querySelector("dialog.pane[open]")
                if (d === null) return null
                const r = d.getBoundingClientRect()
                const hit = document.elementFromPoint(
                  innerWidth / 2,
                  innerHeight / 2,
                )
                return {
                  box: [r.left, r.top, r.right, r.bottom].map(Math.round),
                  window: [innerWidth, innerHeight],
                  hit: hit !== null && d.contains(hit),
                }
              }),
            () => null,
          )
        await pp.keyboard.press("Escape")
        const back = await pp
          .waitForFunction(
            sel =>
              document.querySelector("dialog.pane") === null &&
              document.activeElement === document.querySelector(sel),
            open,
            { timeout: 2_000 },
          )
          .then(
            () => true,
            () => false,
          )
        if (size !== null) await pp.setViewportSize(size)
        check(
          "in a narrow window the pane covers the page, and Escape gives focus back to the table's ⤢",
          covers !== null &&
            covers.box[0] === 0 &&
            covers.box[1] === 0 &&
            (covers.box[2] ?? 0) >= (covers.window[0] ?? 1) &&
            (covers.box[3] ?? 0) >= (covers.window[1] ?? 1) &&
            covers.hit &&
            back,
          `${JSON.stringify(covers)}, focus back ${back}`,
        )
        // Copy, cut and paste: Cmd+C with focus on the table's
        // bar copies the table's markdown, with pine·trie's data beside it,
        // and takes nothing into the inventory, which stays closed. Cmd+V in
        // her composer pastes it there as a link to the table. The
        // clipboard cell shows the copy, and keep pastes a reference to it
        // into a slot, previewed as its quote.
        const refSlot = '.inventory .slot:has(.compact[data-kind="reference"])'
        await pp.evaluate(() => navigator.clipboard.writeText(""))
        await pp.focus(`${col(0)} .msg[data-entry] .table-wrap .table-open`)
        await pp.keyboard.press("ControlOrMeta+c")
        const readClipboard = () =>
          pp.evaluate(() => navigator.clipboard.readText()).catch(() => "")
        await waitFor(async () => (await readClipboard()) !== "", 5_000).catch(
          () => 0,
        )
        const copied = await readClipboard()
        const closed = !(await pp.locator(".inventory").isVisible())
        const none = (await pp.locator(refSlot).count()) === 0
        check(
          "Cmd+C on a table's bar copies its markdown and takes nothing into the inventory, which stays closed",
          copied.startsWith("| n | what |") && closed && none,
          `copied ${JSON.stringify(copied.slice(0, 12))}, closed ${closed}, no reference ${none}`,
        )
        await pp.fill(box, "")
        await pp.focus(box)
        await pp.keyboard.press("ControlOrMeta+v")
        const linked = await pp
          .waitForFunction(
            sel =>
              (
                document.querySelector(sel) as HTMLTextAreaElement | null
              )?.value.includes("](/a/b/") === true,
            box,
            { timeout: 5_000 },
          )
          .then(
            () => true,
            () => false,
          )
        check(
          "Cmd+V in a composer pastes a copied table as a link to it",
          linked,
          await pp.inputValue(box),
        )
        await pp.fill(box, "")
        await pp.click("#bottom .inventory-toggle")
        const shown = await pp
          .waitForSelector(".inventory .clipboard-cell", { timeout: 5_000 })
          .then(
            () => true,
            () => false,
          )
        if (shown) await pp.click(".inventory .clipboard-cell .save")
        const kept = await pp
          .waitForSelector(refSlot, { timeout: 10_000 })
          .then(
            () => true,
            () => false,
          )
        // Kept into the selected slot, it is on the bench at once: a click on
        // it would open it full instead.
        const previewed = await pp
          .waitForSelector(".inventory .bench .reference-quote table", {
            timeout: 10_000,
          })
          .then(
            () => true,
            () => false,
          )
        check(
          "the clipboard cell shows the last copy, and keep puts a reference to it in a slot, previewed as its quote",
          shown && kept && previewed,
          `cell ${shown}, kept ${kept}, previewed ${previewed}`,
        )
        await pp.click("#bottom .inventory-toggle")
        // A file dropped on the composer's card is shared: its link goes in
        // the box, and sent, it is a chip naming it. The drop is the
        // browser's own, through CDP, as one from the desktop is.
        const notes = Buffer.from("the notes\n")
        const notesSha = blobSha256(notes)
        const notesFile = path.join(
          mkdtempSync(path.join(tmpdir(), "pinetrie-drop-")),
          "notes.txt",
        )
        writeFileSync(notesFile, notes)
        const at = await pp.locator(box).boundingBox()
        const cdp = await pp.context().newCDPSession(pp)
        const drag = { items: [], files: [notesFile], dragOperationsMask: 1 }
        for (const type of ["dragEnter", "dragOver", "drop"] as const)
          await cdp.send("Input.dispatchDragEvent", {
            type,
            x: (at?.x ?? 0) + 10,
            y: (at?.y ?? 0) + 10,
            data: drag,
          })
        const dropLinked = await pp
          .waitForFunction(
            ([sel, md]) =>
              (document.querySelector(sel) as HTMLTextAreaElement | null)
                ?.value === md,
            [box, `[notes.txt](/blob/${notesSha})`] as const,
            { timeout: 10_000 },
          )
          .then(
            () => true,
            () => false,
          )
        if (dropLinked) await pp.click(sendButton)
        const chip = await pp
          .waitForSelector(
            `${col(0)} .msg a.share-chip[data-share="${notesSha}"]`,
            { timeout: 10_000 },
          )
          .then(
            el => el.textContent(),
            () => null,
          )
        check(
          "a file dropped on a card is shared: its link goes in the box, and sent it is a chip naming it",
          dropLinked && chip?.startsWith("notes.txt") === true,
          `linked ${dropLinked}, chip ${JSON.stringify(chip)}`,
        )
        // A file dropped where no card takes it is refused, never opened in
        // the tab.
        const refused = await pp.evaluate(() => {
          const data = new DataTransfer()
          data.items.add(new File(["x"], "x.txt", { type: "text/plain" }))
          const drop = new DragEvent("drop", {
            dataTransfer: data,
            bubbles: true,
            cancelable: true,
          })
          document.body.dispatchEvent(drop)
          return drop.defaultPrevented
        })
        check(
          "a file dropped where no card takes it is refused, not opened",
          refused,
          `refused ${refused}`,
        )
        // Media columns: files dropped between columns make one there, an
        // image dragged out of a message is put in it, a file dropped on an
        // image is a version, an image dragged before another moves there,
        // and the pane's put makes another after the thread.
        const media = await mediaColumns(pp, cdp, notesFile, drawn)
        check(
          "files dropped past the last column make a media column there, each image titled by its file, and say what was left out",
          media.made,
          media.madeDetail,
        )
        check(
          "an image dragged out of a message onto a media column is put at its end",
          media.dragged,
          media.draggedDetail,
        )
        check(
          "a file dropped on an image is a version of it",
          media.versioned,
          media.versionedDetail,
        )
        check(
          "an image dragged onto another in its column moves before it",
          media.reordered,
          media.reorderedDetail,
        )
        check(
          "a file dropped on an image's top edge is a new image before it",
          media.inserted,
          media.insertedDetail,
        )
        check(
          "an image dragged to the next one's bottom edge lands after it",
          media.after,
          media.afterDetail,
        )
        check(
          "the pane's put on canvas makes a media column after its thread",
          media.paned,
          media.panedDetail,
        )
        // Pia's picture: chosen on her profile page, cropped to a
        // square in the browser and sent at 256, then drawn in her circle in
        // Quinn's window, where she reads the thread he has open.
        await openProfile(pp)
        await pp.setInputFiles(".picture-file", {
          name: "me.png",
          mimeType: "image/png",
          buffer: greyPng(300, 200),
        })
        await pp.click(".picture-use", { timeout: 5_000 }).catch(() => {})
        const took = await pp
          .waitForSelector(".picture-crop", {
            state: "detached",
            timeout: 15_000,
          })
          .then(
            () => true,
            () => false,
          )
        await pp.click(".page-back").catch(() => {})
        const pictured = await qp
          .waitForFunction(
            sel => {
              const img = document.querySelector(sel)
              return img instanceof HTMLImageElement &&
                img.complete &&
                img.naturalWidth > 0
                ? [img.naturalWidth, img.naturalHeight]
                : null
            },
            `.avatar[data-writer="${writerId("pia@browser.test")}"] img`,
            { timeout: 15_000 },
          )
          .then(
            h => h.jsonValue(),
            () => null,
          )
        check(
          "a picture set on the profile page shows on your avatar in another person's window",
          took && JSON.stringify(pictured) === JSON.stringify([256, 256]),
          `set ${took}, drawn ${JSON.stringify(pictured)}`,
        )
      } finally {
        await pp.context().close()
        await qp.context().close()
        await imageHost.shutdown()
      }
    }
    {
      // Taller than a capped row's 10rem.
      const tall = greyPng(300, 400)
      const script = scriptedModel()
      const section = await lanes.sectionHost({
        files: { "tall.png": tall },
        model: { kind: "scripted", script },
      })
      const imageHost = section.host
      // It may use the clipboard, for copy's check.
      const ip = await (
        await browser.newContext({
          permissions: ["clipboard-read", "clipboard-write"],
        })
      ).newPage()
      await asPerson(ip, "ida@browser.test", "Ida")
      try {
        await ip.goto(imageHost.httpUrl, { waitUntil: "domcontentloaded" })
        await ip.click("#sidebar .add-canvas")
        // Sends `text` and waits for the scripted `reply` in column 0, then
        // for the host to go idle. Idle alone is not enough: until the host
        // has taken the send and started its run, it is idle too.
        const say = async (text: string, reply: string) => {
          await typeAfter(ip, `${col(0)} .composer .input`, text)
          await ip.click(`${col(0)} .composer .send`)
          await readRaw(ip)
          await ip
            .waitForFunction(
              ([c, r]) =>
                [...document.querySelectorAll(`${c} .msg.assistant`)].some(m =>
                  (m.textContent ?? "").includes(r ?? ""),
                ),
              [col(0), reply] as const,
              { timeout: 90_000 },
            )
            .catch(() => {})
          await waitFor(() => idleNow(imageHost))
        }
        script.use([
          { tool: "read", args: { path: "tall.png" } },
          { text: "A grey rectangle." },
        ])
        await say("what is tall.png?", "A grey rectangle.")
        const row = `${col(0)} .tool[data-tool="read"]`
        const sha = blobSha256(tall)
        const img = `${row} .tool-images img[src="/blob/${sha}"]`
        /** The row's size, and its image once loaded: shown size, alt, title. */
        const drawn = () =>
          ip
            .waitForFunction(
              ([r, i]) => {
                const image = document.querySelector(i)
                const details = document.querySelector(r)
                if (
                  !(image instanceof HTMLImageElement) ||
                  !image.complete ||
                  image.naturalWidth === 0
                )
                  return null
                const box = image.getBoundingClientRect()
                return {
                  thumb:
                    details
                      ?.querySelector(".tool-images")
                      ?.hasAttribute("data-thumb") === true,
                  more: details?.querySelector(".tool-more")?.textContent,
                  height: Math.round(box.height),
                  alt: image.alt,
                  title: image.title,
                  text: details?.querySelector(".tool-output") !== null,
                }
              },
              [row, img] as const,
              { timeout: 15_000 },
            )
            .then(
              h => h.jsonValue(),
              () => null,
            )
        const capped = await drawn()
        const rem = await ip.evaluate(() =>
          Number.parseFloat(
            getComputedStyle(document.documentElement).fontSize,
          ),
        )
        check(
          "a read image is drawn in its row's summary, 10rem tall at most, in place of its caption",
          capped?.thumb === true &&
            capped.more === "full size" &&
            capped.height <= 10 * rem + 1 &&
            capped.alt === "tall.png" &&
            capped.title.startsWith("Read image file [image/png]") &&
            !capped.text,
          `${JSON.stringify(capped)}`,
        )
        // The message holds only the call, and copy takes the call and its output.
        const caller = `${col(0)} .msg:has(> .tool[data-tool="read"])`
        await ip.hover(caller)
        await ip.click(`${caller} > .tools > .copy`)
        const copied = await ip
          .waitForFunction(
            async () => (await navigator.clipboard.readText()) !== "",
            undefined,
            { timeout: 5_000 },
          )
          .then(
            () => ip.evaluate(() => navigator.clipboard.readText()),
            () => "",
          )
        check(
          "a message that only called a tool copies the call and its output",
          copied.startsWith(
            "`read tall.png`\n\n```\nRead image file [image/png]",
          ),
          `${JSON.stringify(copied)}`,
        )
        await ip.click(`${row} .tool-more`).catch(() => {})
        const full = await drawn()
        check(
          "its toggle shows the image whole",
          full?.thumb === false &&
            full.more === "less" &&
            capped !== null &&
            full.height > capped.height,
          `${JSON.stringify(full)}`,
        )
      } finally {
        await ip.context().close()
        await section.close()
      }
    }
  } finally {
    await browser.close().catch(() => {})
  }
}

/** Media columns on Pia's canvas, from a drop, a drag, a version, a reorder and the pane's put. */
async function mediaColumns(
  pp: Page,
  cdp: CDPSession,
  textFile: string,
  messageImage: string,
) {
  // Tall enough that the images a drag moves among sit clear of the bands
  // where a media column scrolls under a drag (`edgeScroll`).
  const viewport = pp.viewportSize()
  await pp.setViewportSize({ width: viewport?.width ?? 1440, height: 1400 })
  /** The media column's images scrolled to their top. */
  const toTop = () =>
    pp.evaluate(() => {
      const images = document.querySelector(".media-column .media-images")
      if (images !== null) images.scrollTop = 0
    })
  const dir = mkdtempSync(path.join(tmpdir(), "pinetrie-media-"))
  const wide = path.join(dir, "wide.png")
  const tall = path.join(dir, "tall.png")
  writeFileSync(wide, greyPng(60, 30))
  writeFileSync(tall, greyPng(30, 60))
  const fileDrop = async (x: number, y: number, files: string[]) => {
    const data = { items: [], files, dragOperationsMask: 1 }
    for (const type of ["dragEnter", "dragOver", "drop"] as const)
      await cdp.send("Input.dispatchDragEvent", { type, x, y, data })
  }
  /** The middle of the part of `sel` the window shows; null when it shows none. */
  const visible = async (sel: string) => {
    const b = await pp
      .locator(sel)
      .first()
      .boundingBox({ timeout: 5_000 })
      .catch(() => null)
    const view = pp.viewportSize()
    if (b === null || view === null) return null
    const top = Math.max(b.y, 0)
    const bottom = Math.min(b.y + b.height, view.height)
    const left = Math.max(b.x, 0)
    const right = Math.min(b.x + b.width, view.width)
    return bottom <= top || right <= left
      ? null
      : { x: (left + right) / 2, y: (top + bottom) / 2 }
  }
  /** A drag by the pointer from `from` onto `to`, `from` scrolled into view first. */
  const pointerDrag = async (from: string, to: string) => {
    await pp
      .locator(from)
      .first()
      .scrollIntoViewIfNeeded({ timeout: 5_000 })
      .catch(() => {})
    const a = await visible(from)
    const b = await visible(to)
    if (a === null || b === null) return
    await pp.mouse.move(a.x, a.y)
    await pp.mouse.down()
    await pp.mouse.move(b.x, b.y, { steps: 12 })
    await pp.mouse.up()
  }
  const centre = async (sel: string) => (await visible(sel)) ?? { x: 0, y: 0 }
  const images = (column = ".media-column") =>
    pp.locator(`${column} .media-image`).count()
  /** Whether `test` holds within ten seconds. */
  const until = async (test: () => Promise<boolean>) =>
    (await waitFor(test, 10_000)) >= 0
  // Past the last column: a media column, the text file left out.
  const thread = await pp.locator(col(0)).boundingBox()
  await fileDrop(
    (thread?.x ?? 0) + (thread?.width ?? 0) + 30,
    (thread?.y ?? 0) + 200,
    [wide, textFile],
  )
  const made = await until(async () => (await images()) === 1)
  const title = await pp
    .locator(".media-column .media-image-title")
    .first()
    .textContent({ timeout: 5_000 })
    .catch(() => null)
  const left = await pp
    .locator(".canvas-end .media-left")
    .textContent({ timeout: 5_000 })
    .catch(() => null)
  // The message's image dragged onto the column's header.
  await pointerDrag(messageImage, ".media-column .column-head")
  const dragged = await until(async () => (await images()) === 2)
  // A file dropped on the first image: its second version.
  const first = await centre(".media-column .media-image img")
  await fileDrop(first.x, first.y, [tall])
  const versioned = await until(
    async () =>
      (await pp
        .locator(".media-column .media-versions")
        .first()
        .textContent({ timeout: 1_000 })
        .catch(() => null)) === "‹2 of 2›",
  )
  // The second image dragged onto the first: it moves before it.
  const order = () =>
    pp
      .locator(".media-column .media-image")
      .evaluateAll(els => els.map(e => e.getAttribute("data-card")))
  const before = await order()
  await toTop()
  await pointerDrag(
    ".media-column .media-image:nth-child(2) .media-image-grip",
    ".media-column .media-image:nth-child(1) img",
  )
  const reordered = await until(async () => {
    const now = await order()
    return now.length === 2 && now[0] === before[1] && now[1] === before[0]
  })
  // A file dropped on the first image's top edge: a new image before it.
  const edgeOf = async (sel: string, edge: "top" | "bottom") => {
    await pp
      .locator(sel)
      .first()
      .scrollIntoViewIfNeeded({ timeout: 5_000 })
      .catch(() => {})
    const b = await pp
      .locator(sel)
      .first()
      .boundingBox({ timeout: 5_000 })
      .catch(() => null)
    return b === null
      ? { x: 0, y: 0 }
      : {
          x: b.x + b.width / 2,
          y: edge === "top" ? b.y + 4 : b.y + b.height - 4,
        }
  }
  const twoBefore = await order()
  const top = await edgeOf(".media-column .media-image:nth-child(1)", "top")
  await fileDrop(top.x, top.y, [wide])
  const inserted = await until(async () => {
    const now = await order()
    return (
      now.length === 3 &&
      !twoBefore.includes(now[0] ?? null) &&
      now[1] === twoBefore[0] &&
      now[2] === twoBefore[1]
    )
  })
  // The new first image dragged to the next one's bottom edge: after it.
  const threeBefore = await order()
  await toTop()
  const grip = await visible(
    ".media-column .media-image:nth-child(1) .media-image-grip",
  )
  const next = await pp
    .locator(".media-column .media-image:nth-child(2)")
    .boundingBox({ timeout: 5_000 })
    .catch(() => null)
  if (grip !== null && next !== null) {
    await pp.mouse.move(grip.x, grip.y)
    await pp.mouse.down()
    await pp.mouse.move(next.x + next.width / 2, next.y + next.height - 4, {
      steps: 12,
    })
    await pp.mouse.up()
  }
  const after = await until(async () => {
    const now = await order()
    return (
      now.length === 3 &&
      now[0] === threeBefore[1] &&
      now[1] === threeBefore[0] &&
      now[2] === threeBefore[2]
    )
  })
  // The pane's put: a second media column, just after the thread.
  await pp.click(messageImage)
  await pp
    .click(".pane .add-put-on-canvas", { timeout: 10_000 })
    .catch(() => {})
  const paned = await until(
    async () => (await pp.locator(".media-column").count()) === 2,
  )
  const strip = await pp
    .locator("#strip > [data-card]")
    .evaluateAll(els => els.map(e => e.getAttribute("data-kind")))
  await pp.keyboard.press("Escape")
  if (viewport !== null) await pp.setViewportSize(viewport)
  return {
    made: made && title === "wide.png" && left?.includes("1 file") === true,
    madeDetail: `made ${made}, title ${JSON.stringify(title)}, left ${JSON.stringify(left)}`,
    dragged,
    draggedDetail: `images ${await images()}`,
    versioned,
    versionedDetail: `versioned ${versioned}`,
    reordered,
    reorderedDetail: `before ${JSON.stringify(before)}`,
    inserted,
    insertedDetail: `before ${JSON.stringify(twoBefore)}`,
    after,
    afterDetail: `before ${JSON.stringify(threeBefore)}`,
    paned: paned && strip[1] === "media",
    panedDetail: `strip ${JSON.stringify(strip)}`,
  }
}
