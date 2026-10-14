// e2e/browser/banner — a thread's banner in its column's header, drawn
// before its first message.

import { errorText } from "@pinetrie/core"
import type { Checks } from "../checks.ts"
import {
  SUITE_CONFIG,
  startSuiteHost,
  suiteModel,
  suitePlaces,
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
      const bannerHost = await startSuiteHost({
        model: { kind: "scripted", script: suiteModel() },
        places: suitePlaces({
          user: { ...SUITE_CONFIG, icons: { source: "drawn" } },
        }),
        log: () => {},
      })
      const bp = await (await browser.newContext()).newPage()
      await asPerson(bp, "bea@browser.test", "Bea")
      try {
        await bp.goto(bannerHost.httpUrl, { waitUntil: "domcontentloaded" })
        // Under drawn icons a header never shows a built-in icon first: a
        // watcher set before the thread exists notes any that appears.
        await bp.evaluate(() => {
          const seen = { builtIn: false }
          Object.assign(window, { __iconsSeen: seen })
          new MutationObserver(() => {
            if (
              document.querySelector('.column-head img[data-kind="built-in"]')
            )
              seen.builtIn = true
          }).observe(document.body, { childList: true, subtree: true })
        })
        // Drawn before the first message is typed.
        await bp.click("#sidebar .add-agent")
        const drawn = await bp
          .waitForSelector(`${col(0)} .column-head .thread-icon[data-loaded]`, {
            timeout: 30_000,
          })
          .then(
            () => true,
            () => false,
          )
        // Past the fade: its transitions done. The mark's pulse, an
        // animation of its own, may run on.
        await bp
          .waitForFunction(
            sel =>
              document
                .querySelector(`${sel} .column-head .thread-mark`)
                ?.getAnimations({ subtree: true })
                .every(a => !(a instanceof CSSTransition)) === true,
            col(0),
            { timeout: 5_000 },
          )
          .catch(() => {})
        const header = await bp.evaluate(sel => {
          const head = document.querySelector(`${sel} .column-head`)
          const mark = head?.querySelector(".agent-name .thread-mark")
          const img = mark?.querySelector("img.thread-icon")
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
            kind: img.dataset.kind,
            builtInFirst: (
              window as unknown as { __iconsSeen: { builtIn: boolean } }
            ).__iconsSeen.builtIn,
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
            header.kind === "banner" &&
            !header.builtInFirst &&
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
        await bp.waitForSelector("#sidebar .open-root", { timeout: 15_000 })

        // Back to its task, the column mounts again with its banner already there.
        const root =
          (await bp.getAttribute("#sidebar .open-root", "data-task")) ?? ""
        await stepAway(bp)
        await stepBack(bp, root)
        const again = await bp
          .waitForSelector(`${col(0)} .column-head .thread-icon`, {
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
        // Vite's HMR socket, which kept the host's server from closing.
        const end: { outcome: string | null } = { outcome: null }
        void bannerHost.shutdown().then(
          () => {
            end.outcome = "stopped"
          },
          (e: unknown) => {
            end.outcome = `failed: ${errorText(e)}`
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
