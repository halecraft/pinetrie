// e2e/browser/images — an image pasted into the composer (ADR-0042), and a
// tool's image, drawn in its row, which opens capped (ADR-0051).

import path from "node:path"
import { UPLOADING } from "@pineta/client/send"
import { scriptedModel, sha256Of } from "@pineta/pi"
import type { Page } from "@playwright/test"
import { startHost } from "../../host/index.ts"
import type { Checks } from "../checks.ts"
import { committedProject, suiteModel, waitFor } from "../harness.ts"
import { greyPng, RED_PNG } from "../images.ts"
import type { Scenario } from "../scenario.ts"

import { asPerson, chooseFromMenu, col, launchBrowser } from "./page.ts"

export const scenario: Scenario = {
  run: ({ check }) => run(check),
}

async function run(check: Checks["check"]): Promise<void> {
  const browser = await launchBrowser()
  try {
    {
      const imageHost = await startHost({
        model: { kind: "scripted", script: suiteModel() },
        log: () => {},
      })
      const pp = await (await browser.newContext()).newPage()
      await asPerson(pp, "pia@browser.test", "Pia")
      const qp = await (await browser.newContext()).newPage()
      await asPerson(qp, "quinn@browser.test", "Quinn")
      try {
        await pp.goto(imageHost.httpUrl, { waitUntil: "domcontentloaded" })
        await pp.click("#tabs .add-agent")
        const box = `${col(0)} .composer .input`
        const sendButton = `${col(0)} .composer .send`
        await pp.fill(box, "what colour is this?")
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
        const sha = sha256Of(RED_PNG)
        const markdown = `![red.png](/blob/${sha})`
        const inserted = await pp
          .waitForFunction(
            ([sel, md]) =>
              (document.querySelector(sel) as HTMLTextAreaElement | null)
                ?.value === `what colour is this?\n${md}`,
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
        await qp
          .waitForSelector("#top .here-person .here-trigger", {
            timeout: 20_000,
          })
          .catch(() => null)
        await chooseFromMenu(
          qp,
          "#top .here-person .here-trigger",
          ".here-thread",
        )
        const theirs = await loaded(qp)
        check(
          "another window draws it too",
          JSON.stringify(theirs) === JSON.stringify([40, "40"]),
          `${JSON.stringify(theirs)}`,
        )
        // A click shows it over the page; Escape or a click closes it (S66).
        const viewer = "dialog.image-viewer[open]"
        /** Whether the viewer reaches `state` within 2 s. */
        const viewing = (state: "visible" | "hidden") =>
          pp.waitForSelector(viewer, { state, timeout: 2_000 }).then(
            () => true,
            () => false,
          )
        const pages: Page[] = []
        pp.context().on("page", p => pages.push(p))
        const url = pp.url()
        await pp.click(drawn)
        const shown =
          (await loaded(pp, `${viewer} img[src="/blob/${sha}"]`, 2_000)) !==
          null
        check(
          "a click on an image shows it large in the page, not in a new tab",
          shown && pages.length === 0 && pp.url() === url,
          `${shown}, ${pages.length} new pages, ${pp.url() === url}`,
        )
        await pp.keyboard.press("Escape")
        check("Escape closes the image's view", await viewing("hidden"))
        await pp.click(drawn)
        check(
          "a closed image's view opens again on a click",
          await viewing("visible"),
        )
        // The backdrop: the image is centred, and no image fills the window.
        await pp.mouse.click(5, 5)
        check(
          "a click beside the image closes its view",
          await viewing("hidden"),
        )
        await pp.click(drawn)
        const reopened = await viewing("visible")
        await pp.click(`${viewer} img`)
        check(
          "a click on the shown image closes its view",
          reopened && (await viewing("hidden")),
          `${reopened}`,
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
      const work = committedProject("pineta-browser-tool-images-", {
        "tall.png": tall,
      })
      const script = scriptedModel()
      const imageHost = await startHost({
        model: { kind: "scripted", script },
        tools: { project: work },
        containers: false,
        userConfig: path.join(work, "no-user-config.json"),
        log: () => {},
      })
      // It may use the clipboard, for copy's check (S68).
      const ip = await (
        await browser.newContext({
          permissions: ["clipboard-read", "clipboard-write"],
        })
      ).newPage()
      await asPerson(ip, "ida@browser.test", "Ida")
      try {
        await ip.goto(imageHost.httpUrl, { waitUntil: "domcontentloaded" })
        await ip.click("#tabs .add-agent")
        const say = async (text: string) => {
          await ip.fill(`${col(0)} .composer .input`, text)
          await ip.click(`${col(0)} .composer .send`)
        }
        const idle = () =>
          waitFor(() => Object.keys(imageHost.doc.activeRuns()).length === 0)
        script.use([
          { tool: "read", args: { path: "tall.png" } },
          { text: "A grey rectangle." },
        ])
        await say("what is tall.png?")
        await idle()
        const row = `${col(0)} .tool[data-tool="read"]`
        const sha = sha256Of(tall)
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
                  size: details?.getAttribute("data-size"),
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
          "a read image opens its row capped, drawn in place of its caption",
          capped?.size === "capped" &&
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
        await ip.click(`${row} summary`)
        const full = await drawn()
        check(
          "a click on its summary shows the image whole",
          full?.size === "full" &&
            capped !== null &&
            full.height > capped.height,
          `${JSON.stringify(full)}`,
        )
        await ip.click(`${row} summary`)
        script.use([{ text: "Still grey." }])
        await say("@agent and now?")
        await idle()
        await ip.waitForTimeout(300)
        const after = await ip.getAttribute(row, "data-size")
        check(
          "folded, it stays folded when another message arrives",
          after === "closed" && (await ip.$(img)) === null,
          `${after}`,
        )
      } finally {
        await ip.context().close()
        await imageHost.shutdown()
      }
    }
  } finally {
    await browser.close().catch(() => {})
  }
}
