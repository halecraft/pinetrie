// e2e/browser/banner — a thread's banner in its column's header (ADR-0050,
// ADR-0053).

import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { startHost } from "../../host/index.ts"
import type { Checks } from "../checks.ts"
import { suiteModel } from "../harness.ts"
import type { Scenario } from "../scenario.ts"

import { asPerson, col, launchBrowser } from "./page.ts"

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
      writeFileSync(config, JSON.stringify({ banner: { enabled: true } }))
      const bannerHost = await startHost({
        model: { kind: "scripted", script: suiteModel() },
        userConfig: config,
        log: () => {},
      })
      const bp = await (await browser.newContext()).newPage()
      await asPerson(bp, "bea@browser.test", "Bea")
      try {
        await bp.goto(bannerHost.httpUrl, { waitUntil: "domcontentloaded" })
        await bp.click("#tabs .add-agent")
        await bp.fill(`${col(0)} .composer .input`, "plan the parser")
        await bp.click(`${col(0)} .composer .send`)
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

        // Back to the tab, the column mounts again with its banner already there.
        await bp.click("#tabs .tab-archive")
        await bp.click("#tabs .tab-root")
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
      } finally {
        await bp.context().close()
        await bannerHost.shutdown()
      }
    }
  } finally {
    await browser.close().catch(() => {})
  }
}
