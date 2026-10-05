// e2e/browser/banner — a thread's banner in its column's header (ADR-0050,
// ADR-0053), drawn before its first message (ADR-0057).

import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { messageOf } from "../../host/basics.ts"
import type { Checks } from "../checks.ts"
import {
  SUITE_CONFIG,
  startSuiteHost,
  suiteModel,
  waitFor,
} from "../harness.ts"
import type { Scenario } from "../scenario.ts"

import { asPerson, col, launchBrowser, stepAway, stepBack } from "./page.ts"

export const scenario: Scenario = {
  run: ({ check }) => run(check),
}

async function run(check: Checks["check"]): Promise<void> {
  const browser = await launchBrowser()
  try {
    {
      const config = path.join(
        mkdtempSync(path.join(tmpdir(), "pineta-browser-banner-")),
        "config.json",
      )
      writeFileSync(
        config,
        JSON.stringify({ ...SUITE_CONFIG, banner: { enabled: true } }),
      )
      const bannerHost = await startSuiteHost({
        model: { kind: "scripted", script: suiteModel() },
        userConfig: config,
        log: () => {},
      })
      const bp = await (await browser.newContext()).newPage()
      await asPerson(bp, "bea@browser.test", "Bea")
      try {
        await bp.goto(bannerHost.httpUrl, { waitUntil: "domcontentloaded" })
        // Drawn before the first message is typed (ADR-0057).
        await bp.click("#open-list .add-agent")
        const drawn = await bp
          .waitForSelector(`${col(0)} .column-head .banner[data-loaded]`, {
            timeout: 30_000,
          })
          .then(
            () => true,
            () => false,
          )
        // Past the fade.
        await bp.waitForTimeout(800)
        const header = await bp.evaluate(sel => {
          const head = document.querySelector(`${sel} .column-head`)
          const mark = head?.querySelector(".agent-name .thread-mark")
          const img = mark?.querySelector("img.banner")
          const star = mark?.querySelector(".thread-star")
          if (
            !(head instanceof HTMLElement) ||
            !(mark instanceof HTMLElement) ||
            !(img instanceof HTMLImageElement) ||
            !(star instanceof HTMLElement)
          )
            return null
          // Where the name's text starts, and how tall the header is: the same
          // with the image as without it, so its arrival moves nothing.
          const layout = () => {
            const text = document.createRange()
            const name = mark.nextSibling
            if (name !== null) text.selectNode(name)
            return `${text.getBoundingClientRect().left},${head.offsetHeight}`
          }
          const withImage = layout()
          img.style.display = "none"
          const without = layout()
          img.style.display = ""
          const style = getComputedStyle(img)
          return {
            natural: img.naturalWidth,
            fit: style.objectFit,
            blend: style.mixBlendMode,
            opacity: style.opacity,
            starOpacity: getComputedStyle(star).opacity,
            fills:
              img.offsetWidth === mark.offsetWidth &&
              img.offsetHeight === mark.offsetHeight &&
              mark.offsetWidth === mark.offsetHeight,
            still: withImage === without,
            stripe: getComputedStyle(head).borderTopWidth,
          }
        }, col(0))
        check(
          "a new thread's banner takes the star's square before its name, its black blended away, and moves nothing as it arrives",
          drawn &&
            header !== null &&
            header.natural > 0 &&
            header.fit === "contain" &&
            header.blend === "lighten" &&
            header.opacity === "1" &&
            header.starOpacity === "0" &&
            header.fills &&
            header.still &&
            header.stripe === "4px",
          `${JSON.stringify(header)}`,
        )

        // The first send makes the thread's root, which the check below
        // returns to. That the lane keeps the reserved name is `page`'s check:
        // a scripted model draws one image for every name.
        await bp.fill(`${col(0)} .composer .input`, "plan the parser")
        await bp.click(`${col(0)} .composer .send`)
        await bp.waitForSelector("#open-list .open-root", { timeout: 15_000 })

        // Back to its root, the column mounts again with its banner already there.
        const root =
          (await bp.getAttribute("#open-list .open-root", "data-root")) ?? ""
        await stepAway(bp)
        await stepBack(bp, root)
        const again = await bp
          .waitForSelector(`${col(0)} .column-head .banner`, {
            timeout: 15_000,
          })
          .then(img =>
            img.evaluate(n => ({
              fade: n.hasAttribute("data-fade"),
              opacity: getComputedStyle(n).opacity,
            })),
          )
        check(
          "a banner already there shows at once when its column mounts again, without fading in",
          !again.fade && again.opacity === "1",
          `${JSON.stringify(again)}`,
        )

        // The other scenarios close their pages first. An open page holds
        // Vite's HMR socket, which kept the host's server from closing (S98).
        const end: { outcome: string | null } = { outcome: null }
        void bannerHost.shutdown().then(
          () => {
            end.outcome = "stopped"
          },
          (e: unknown) => {
            end.outcome = `failed: ${messageOf(e)}`
          },
        )
        const took = await waitFor(() => end.outcome !== null, 10_000)
        check(
          "the host shuts down with a page still open",
          end.outcome === "stopped",
          end.outcome === null ? "timed out" : `${end.outcome} in ${took} ms`,
        )
      } finally {
        await bp.context().close()
        await bannerHost.shutdown()
      }
    }
  } finally {
    await browser.close().catch(() => {})
  }
}
