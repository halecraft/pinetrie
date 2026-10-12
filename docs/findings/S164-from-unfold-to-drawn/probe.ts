// The probe of S164, S165 and S166 (docs/findings/S164-from-unfold-to-drawn.md,
// S165-fold-then-swap.md, S166-fold-frames.md). Disposable.
//
// It imports the e2e harness by relative path: copy it to
// `apps/pinetrie/e2e/fold-probe.ts` and run it from the repo root:
//
//   node apps/pinetrie/e2e/fold-probe.ts <mode> [messages per column]
//
// Modes: mount and compositor (S164), swap (S165), frames (S166).
// FOLD_COLUMNS (default 4) columns, FOLD_RATES / FOLD_RATE the CPU
// throttling, FOLD_VARIANT the variant of compositor and swap.

import { atEntry, entryId, ROOT } from "@pinetrie/core"
import { chromium, type Page } from "@playwright/test"
import { asPerson, openFromBoard } from "./browser/page.ts"
import {
  BRANCH,
  join,
  START_AGENT,
  START_CHAT,
  startSuiteHost,
  suiteModel,
  taskAt,
} from "./harness.ts"

const MODE = process.argv[2] ?? "explore"
const PER = Number(process.argv[3] ?? 40)
const COLUMNS = Number(process.env.FOLD_COLUMNS ?? 4)

const text = (i: number) =>
  i % 4 === 0
    ? `Step ${i}: here is **why** the parser fails on \`foo\`, and a list:\n\n- first, the tokenizer\n- then the grammar, rule ${i}\n- then [the docs](https://example.com/${i})`
    : i % 4 === 1
      ? `\`\`\`ts\nexport function parse${i}(input: string): Tree {\n  const tokens = lex(input)\n  return build(tokens, ${i})\n}\n\`\`\``
      : i % 4 === 2
        ? `A longer paragraph ${i}. ${"The quick brown fox jumps over the lazy dog. ".repeat(6)}`
        : `| a | b |\n|---|---|\n| ${i} | ${i * 2} |\n| x | y |`

const host = await startSuiteHost({
  model: { kind: "scripted", script: suiteModel() },
  log: () => {},
})
const ada = await join(host, "ada", "s163")
const first = await ada.chat(
  text(0),
  ROOT,
  process.env.FOLD_AGENT === "1" ? START_AGENT : START_CHAT,
)
if (first.kind !== "appended") throw new Error(JSON.stringify(first))
const trunk = [first.id]
for (let i = 1; i < PER; i++) {
  const r = await ada.chat(text(i), atEntry(trunk.at(-1) ?? first.id))
  if (r.kind !== "appended") throw new Error(JSON.stringify(r))
  trunk.push(r.id)
}
for (let b = 1; b < COLUMNS; b++) {
  const from = trunk[Math.floor((b * PER) / (COLUMNS + 1))] ?? first.id
  let tip = await ada.chat(text(b), atEntry(from), BRANCH)
  if (tip.kind !== "appended") throw new Error(JSON.stringify(tip))
  for (let i = 1; i < PER; i++) {
    const at: string = tip.kind === "appended" ? tip.id : ""
    tip = await ada.chat(text(i + b), atEntry(entryId(at)))
    if (tip.kind !== "appended") throw new Error(JSON.stringify(tip))
  }
}
const task = taskAt(ada, first.id)
if (task === undefined) throw new Error("no task")

const browser = await chromium.launch()
const page = await (
  await browser.newContext({ viewport: { width: 1920, height: 1080 } })
).newPage()
await asPerson(page, "ada@s163.test", "Ada")
await page.goto(host.httpUrl, { waitUntil: "domcontentloaded" })
await openFromBoard(page, task)
await page.waitForTimeout(1500)

export const unfoldAll = async (p: Page) => {
  for (let tries = 0; tries < 40; tries++) {
    const folded = p.locator('.folded-column[data-kind="thread"] .folded-title')
    if ((await folded.count()) === 0) break
    await folded.first().click()
    await p.waitForTimeout(200)
  }
}

const cdp = await page.context().newCDPSession(page)
const throttle = (rate: number) =>
  cdp.send("Emulation.setCPUThrottlingRate", { rate })

if (MODE === "explore") {
  console.log(
    await page.evaluate(() => ({
      strip: [...(document.querySelector("#strip")?.children ?? [])].map(
        c => `${c.tagName}.${c.className} card=${c.getAttribute("data-card")}`,
      ),
      msgs: [...document.querySelectorAll("#strip .column")].map(
        c => c.querySelectorAll(".msg").length,
      ),
    })),
  )
}

/** Timings of one swap, read in the page: from the click to the new element drawn. */
const swap = (p: Page, press: string, appears: string) =>
  p.evaluate(
    ({ press, appears }) =>
      new Promise<Record<string, unknown>>(resolve => {
        const long: number[] = []
        const obs = new PerformanceObserver(l => {
          for (const e of l.getEntries()) long.push(Math.round(e.duration))
        })
        obs.observe({ type: "longtask", buffered: false })
        const btn = press.startsWith("fold:")
          ? ([...document.querySelectorAll<HTMLElement>(".menu button")].find(
              b => b.textContent?.trim() === "Fold",
            ) ?? null)
          : document.querySelector<HTMLElement>(press)
        if (btn === null) return resolve({ error: `no ${press}` })
        const t0 = performance.now()
        let micro: boolean | null = null
        let mutatedAt: number | null = null
        const mo = new MutationObserver(() => {
          if (mutatedAt === null && document.querySelector(appears) !== null)
            mutatedAt = performance.now() - t0
        })
        mo.observe(document.querySelector("#strip") ?? document.body, {
          childList: true,
          subtree: true,
        })
        btn.click()
        const sync = document.querySelector(appears) !== null
        const clickDone = performance.now() - t0
        queueMicrotask(() => {
          micro = document.querySelector(appears) !== null
        })
        let frames = 0
        let drawnFrame: number | null = null
        let drawnAt: number | null = null
        const tick = (now: number) => {
          frames++
          if (drawnFrame === null && document.querySelector(appears) !== null) {
            drawnFrame = frames
            drawnAt = now - t0
          } else if (drawnFrame !== null) {
            // The first frame after the element was there: it was painted.
            const el = document.querySelector(appears)
            mo.disconnect()
            setTimeout(() => {
              obs.disconnect()
              resolve({
                sync,
                micro,
                clickDone: Math.round(clickDone),
                mutatedAt: mutatedAt === null ? null : Math.round(mutatedAt),
                drawnFrame,
                drawnAt: Math.round(drawnAt ?? 0),
                paintedAt: Math.round(now - t0),
                messages: el?.querySelectorAll(".msg").length ?? 0,
                long,
              })
            }, 300)
            return
          }
          if (frames < 600) requestAnimationFrame(tick)
          else resolve({ error: "never drawn" })
        }
        requestAnimationFrame(tick)
      }),
    { press, appears },
  )

if (MODE === "mount") {
  for (const rate of (process.env.FOLD_RATES ?? "1,4").split(",").map(Number)) {
    await throttle(rate)
    const cards = await page.evaluate(() =>
      [...document.querySelectorAll('.folded-column[data-kind="thread"]')].map(
        c => c.getAttribute("data-card") ?? "",
      ),
    )
    for (const card of cards) {
      const un = await swap(
        page,
        `.folded-column[data-card="${card}"] .folded-title`,
        `.column[data-card="${card}"]`,
      )
      await page.waitForTimeout(1500)
      const later = await page.evaluate(
        c =>
          document
            .querySelector(`.column[data-card="${c}"]`)
            ?.querySelectorAll(".msg").length,
        card,
      )
      console.log(
        JSON.stringify({ rate, act: "unfold", ...un, messagesLater: later }),
      )
      // Fold it back from its ⋯.
      await page.click(`.column[data-card="${card}"] .column-menu`)
      await page.waitForSelector('.menu button:has-text("Fold")')
      const fo = await swap(
        page,
        "fold:",
        `.folded-column[data-card="${card}"]`,
      )
      console.log(JSON.stringify({ rate, act: "fold", ...fo }))
      await page.waitForTimeout(800)
    }
  }
  await throttle(1)
}

// Does a transform animation started before the swap keep moving while the
// main thread renders the unfolded column? Screencast frames during it.
if (MODE === "compositor") {
  await throttle(Number(process.env.FOLD_RATE ?? 1))
  const card = await page.evaluate(
    () =>
      document
        .querySelector('.folded-column[data-kind="thread"]')
        ?.getAttribute("data-card") ?? "",
  )
  const frames: { t: number; hash: string }[] = []
  const { createHash } = await import("node:crypto")
  cdp.on("Page.screencastFrame", async f => {
    frames.push({
      t: f.metadata.timestamp ?? 0,
      hash: createHash("sha1").update(f.data).digest("hex").slice(0, 8),
    })
    await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId })
  })
  await cdp.send("Page.startScreencast", {
    format: "jpeg",
    quality: 30,
    everyNthFrame: 1,
  })
  await page.waitForTimeout(500)
  const variant = process.env.FOLD_VARIANT ?? "before"
  const marks = await page.evaluate(
    ({ card, variant }) =>
      new Promise<Record<string, number>>(resolve => {
        // A big, plain element turned over 600 ms: something whose motion
        // shows in every frame.
        const box = document.createElement("div")
        Object.assign(box.style, {
          position: "fixed",
          left: "900px",
          top: "300px",
          width: "300px",
          height: "300px",
          background: "linear-gradient(90deg, red, blue)",
          zIndex: "9999",
          pointerEvents: "none",
        })
        document.body.append(box)
        const t0 = performance.now()
        const anim = box.animate(
          [{ transform: "rotate(0deg)" }, { transform: "rotate(90deg)" }],
          { duration: 600, easing: "linear", fill: "forwards" },
        )
        const press = () => {
          const at = performance.now() - t0
          document
            .querySelector<HTMLElement>(
              `.folded-column[data-card="${card}"] .folded-title`,
            )
            ?.click()
          // The commit runs in a microtask after the click; this timer runs after it.
          setTimeout(() => {
            const done = performance.now() - t0
            anim.finished.then(() => {
              box.remove()
              resolve({
                epoch: performance.timeOrigin + t0,
                pressAt: at,
                commitDoneBy: done,
              })
            })
          }, 0)
        }
        if (variant === "before")
          requestAnimationFrame(() => requestAnimationFrame(press))
        else press()
      }),
    { card, variant },
  )
  await page.waitForTimeout(500)
  await cdp.send("Page.stopScreencast")
  const start = marks.epoch / 1000
  const rel = frames.map(f => ({
    ms: Math.round((f.t - start) * 1000),
    hash: f.hash,
  }))
  console.log(
    JSON.stringify({
      variant,
      ...Object.fromEntries(
        Object.entries(marks).map(([k, v]) => [k, Math.round(v)]),
      ),
    }),
  )
  console.log(
    rel
      .filter(f => f.ms > -50 && f.ms < 900)
      .map(f => `${f.ms}:${f.hash}`)
      .join(" "),
  )
  await throttle(1)
}

// S165: fold by animating the live column first, then swapping. Does any
// frame show the old layout again? Markers: red on the next column (its x),
// green in the folding column's body (whether it shows).
if (MODE === "swap") {
  await throttle(Number(process.env.FOLD_RATE ?? 1))
  const variant = process.env.FOLD_VARIANT ?? "held-click"
  const frames: { t: number; data: string }[] = []
  cdp.on("Page.screencastFrame", async f => {
    frames.push({ t: f.metadata.timestamp ?? 0, data: f.data })
    await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId })
  })
  const card = await page.evaluate(() => {
    const col = document.querySelector<HTMLElement>("#strip .column[data-card]")
    const next = col?.nextElementSibling as HTMLElement | null
    if (col == null || next == null) return null
    const red = document.createElement("div")
    red.id = "s165-red"
    Object.assign(red.style, {
      position: "absolute",
      left: "4px",
      top: "120px",
      width: "8px",
      height: "40px",
      background: "#ff0000",
      zIndex: "5",
    })
    next.style.position = "relative"
    next.append(red)
    const green = document.createElement("div")
    green.id = "s165-green"
    Object.assign(green.style, {
      position: "absolute",
      left: "200px",
      top: "300px",
      width: "40px",
      height: "40px",
      background: "#00ff00",
      zIndex: "5",
    })
    col.style.position = "relative"
    col.querySelector(".column-thread")?.append(green)
    return col.getAttribute("data-card")
  })
  if (card === null) throw new Error("no column with a next")
  await page.click(`.column[data-card="${card}"] .column-menu`)
  await page.waitForSelector(".menu button")
  await page.addStyleTag({
    content: ".menu { visibility: hidden !important; }",
  })
  await cdp.send("Page.startScreencast", { format: "png", everyNthFrame: 1 })
  await page.waitForTimeout(400)
  const marks = await page.evaluate(
    ({ card, variant }) =>
      new Promise<Record<string, number>>(resolve => {
        const col = document.querySelector<HTMLElement>(
          `.column[data-card="${card}"]`,
        )
        if (col === null) return
        const strip =
          2.2 *
          Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
        const w = col.getBoundingClientRect().width
        const shift = strip - w
        const right: HTMLElement[] = []
        for (
          let n = col.nextElementSibling;
          n !== null;
          n = n.nextElementSibling
        )
          right.push(n as HTMLElement)
        const fading = [
          ...col.querySelectorAll<HTMLElement>(
            ".column-thread > :not(.column-head)",
          ),
        ]
        const opts: KeyframeAnimationOptions = {
          duration: 200,
          easing: "ease-out",
          fill: "forwards",
        }
        const t0 = performance.now()
        const anims = [
          col.animate(
            [
              { clipPath: "inset(0 0 0 0)" },
              { clipPath: `inset(0 ${w - strip}px 0 0)` },
            ],
            opts,
          ),
          ...fading.map(el =>
            el.animate([{ opacity: 1 }, { opacity: 0 }], {
              ...opts,
              duration: 120,
            }),
          ),
          ...right.map(el =>
            el.animate(
              [{ transform: "none" }, { transform: `translateX(${shift}px)` }],
              opts,
            ),
          ),
        ]
        const fold = [
          ...document.querySelectorAll<HTMLElement>(".menu button"),
        ].find(b => b.textContent?.trim() === "Fold")
        if (fold === undefined) return
        const props = (el: Element) => {
          const k = Object.keys(el).find(k => k.startsWith("__reactProps$"))
          return k === undefined
            ? null
            : (el as unknown as Record<string, { onClick?: () => void }>)[k]
        }
        const ended: Record<string, number> = {}
        const appeared = (then: () => void) => {
          const mo = new MutationObserver(() => {
            if (
              document.querySelector(`.folded-column[data-card="${card}"]`) !==
              null
            ) {
              mo.disconnect()
              ended.committedAt = performance.now() - t0
              then()
            }
          })
          mo.observe(document.querySelector("#strip") ?? document.body, {
            childList: true,
            subtree: true,
          })
        }
        const cancelAll = () => {
          for (const a of anims) a.cancel()
        }
        anims[0]?.finished.then(() => {
          ended.finishedAt = performance.now() - t0
          switch (variant) {
            case "cancel-click": // cancel, then the intent from a click (discrete)
              cancelAll()
              fold.click()
              break
            case "held-click": // hold, the intent from a click, cancel at the commit
              appeared(cancelAll)
              fold.click()
              break
            case "cancel-call": // cancel, then the intent outside an event
              cancelAll()
              props(fold)?.onClick?.()
              break
            case "held-call": // hold, the intent outside an event, cancel at the commit
              appeared(cancelAll)
              props(fold)?.onClick?.()
              break
          }
          ended.calledAt = performance.now() - t0
          setTimeout(
            () => resolve({ epoch: performance.timeOrigin + t0, ...ended }),
            600,
          )
        })
      }),
    { card, variant },
  )
  await cdp.send("Page.stopScreencast")
  await page.waitForTimeout(200)
  // Read the markers in each frame, in a page of its own.
  const reader = await browser.newPage()
  const start = marks.epoch / 1000
  const rows: string[] = []
  for (const f of frames) {
    const ms = Math.round((f.t - start) * 1000)
    if (ms < -40 || ms > 900) continue
    const seen = await reader.evaluate(async data => {
      const img = new Image()
      img.src = `data:image/png;base64,${data}`
      await img.decode()
      const c = document.createElement("canvas")
      c.width = img.width
      c.height = img.height
      const g = c.getContext("2d")
      if (g === null) return null
      g.drawImage(img, 0, 0)
      const px = g.getImageData(0, 0, c.width, c.height).data
      let redX = -1
      let green = 0
      for (let y = 0; y < c.height; y += 4)
        for (let x = 0; x < c.width; x++) {
          const i = (y * c.width + x) * 4
          const r = px[i] ?? 0
          const gg = px[i + 1] ?? 0
          const b = px[i + 2] ?? 0
          if (redX < 0 && r > 230 && gg < 30 && b < 30) redX = x
          if (gg > 200 && r < 60 && b < 60) green++
        }
      return { redX, green }
    }, f.data)
    rows.push(`${ms}:${seen?.redX}/${seen?.green}`)
  }
  console.log(
    JSON.stringify({
      variant,
      ...Object.fromEntries(
        Object.entries(marks).map(([k, v]) => [k, Math.round(v)]),
      ),
    }),
  )
  console.log(rows.join(" "))
  await throttle(1)
}

// S166: the frames of a fold and an unfold on a strip of long columns,
// against a trivial animation's (the baseline). Screencast frame intervals
// are what was shown; rAF intervals, the main thread's.
if (MODE === "frames") {
  await unfoldAll(page)
  await page.waitForTimeout(1500)
  console.log(
    "page",
    JSON.stringify(
      await page.evaluate(() => ({
        nodes: document.querySelectorAll("*").length,
        columns: document.querySelectorAll("#strip .column[data-card]").length,
        messages: document.querySelectorAll(".msg").length,
      })),
    ),
  )
  const shown: number[] = []
  cdp.on("Page.screencastFrame", async f => {
    shown.push((f.metadata.timestamp ?? 0) * 1000)
    await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId })
  })
  await cdp.send("Page.startScreencast", {
    format: "jpeg",
    quality: 20,
    everyNthFrame: 1,
  })
  const stats = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b)
    const q = (p: number) =>
      Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0)
    return {
      n: s.length,
      p50: q(0.5),
      p95: q(0.95),
      max: Math.round(s.at(-1) ?? 0),
      over20: s.filter(x => x > 20).length,
      over50: s.filter(x => x > 50).length,
    }
  }
  /** Run `act` in the page; the shown and rAF intervals between its start and end. */
  const run = async (
    label: string,
    rate: number,
    act: string,
    card: string,
  ) => {
    const from = shown.length
    const r = await page.evaluate(
      ({ act, card }) =>
        new Promise<{
          epoch: number
          end: number
          raf: number[]
          commit?: number
        }>(resolve => {
          const raf: number[] = []
          let last = 0
          let on = true
          const tick = (now: number) => {
            if (last !== 0) raf.push(now - last)
            last = now
            if (on) requestAnimationFrame(tick)
          }
          requestAnimationFrame(tick)
          const rem = Number.parseFloat(
            getComputedStyle(document.documentElement).fontSize,
          )
          const strip = 2.2 * rem
          const opts: KeyframeAnimationOptions = {
            duration: 200,
            easing: "ease-out",
            fill: "forwards",
          }
          const t0 = performance.now()
          const finish = (
            anims: Animation[],
            extra: Record<string, number> = {},
          ) =>
            Promise.all(anims.map(a => a.finished)).then(() =>
              setTimeout(() => {
                on = false
                for (const a of anims) a.cancel()
                resolve({
                  epoch: performance.timeOrigin + t0,
                  end: performance.now() - t0,
                  raf,
                  ...extra,
                })
              }, 50),
            )
          const after = (col: Element) => {
            const right: HTMLElement[] = []
            for (
              let n = col.nextElementSibling;
              n !== null;
              n = n.nextElementSibling
            )
              right.push(n as HTMLElement)
            return right
          }
          if (act === "baseline") {
            const box = document.createElement("div")
            Object.assign(box.style, {
              position: "fixed",
              left: "10px",
              top: "10px",
              width: "4px",
              height: "4px",
              background: "#123",
            })
            document.body.append(box)
            const a = box.animate(
              [{ transform: "none" }, { transform: "translateX(20px)" }],
              opts,
            )
            a.finished.then(() => box.remove())
            finish([a])
            return
          }
          if (act === "fold") {
            const col = document.querySelector<HTMLElement>(
              `.column[data-card="${card}"]`,
            )
            if (col === null) return
            const w = col.getBoundingClientRect().width
            const fading = [
              ...col.querySelectorAll<HTMLElement>(
                ".column-thread > :not(.column-head)",
              ),
            ]
            const anims = [
              col.animate(
                [
                  { clipPath: "inset(0 0 0 0)" },
                  { clipPath: `inset(0 ${w - strip}px 0 0)` },
                ],
                opts,
              ),
              ...fading.map(el =>
                el.animate([{ opacity: 1 }, { opacity: 0 }], {
                  ...opts,
                  duration: 120,
                }),
              ),
              ...after(col).map(el =>
                el.animate(
                  [
                    { transform: "none" },
                    { transform: `translateX(${strip - w}px)` },
                  ],
                  opts,
                ),
              ),
            ]
            finish(anims)
            return
          }
          // unfold: press the strip, and animate the column the commit draws, before it is painted.
          const mo = new MutationObserver(() => {
            const col = document.querySelector<HTMLElement>(
              `.column[data-card="${card}"]`,
            )
            if (col === null) return
            mo.disconnect()
            const commit = performance.now() - t0
            const w = col.getBoundingClientRect().width
            const fading = [
              ...col.querySelectorAll<HTMLElement>(
                ".column-thread > :not(.column-head)",
              ),
            ]
            const anims = [
              col.animate(
                [
                  { clipPath: `inset(0 ${w - strip}px 0 0)` },
                  { clipPath: "inset(0 0 0 0)" },
                ],
                opts,
              ),
              ...fading.map(el =>
                el.animate(
                  [{ opacity: 0 }, { opacity: 0, offset: 0.4 }, { opacity: 1 }],
                  opts,
                ),
              ),
              ...after(col).map(el =>
                el.animate(
                  [
                    { transform: `translateX(${strip - w}px)` },
                    { transform: "none" },
                  ],
                  opts,
                ),
              ),
            ]
            finish(anims, { commit })
          })
          mo.observe(document.querySelector("#strip") ?? document.body, {
            childList: true,
            subtree: true,
          })
          document
            .querySelector<HTMLElement>(
              `.folded-column[data-card="${card}"] .folded-title`,
            )
            ?.click()
        }),
      { act, card },
    )
    await page.waitForTimeout(150)
    const start = r.epoch + (r.commit ?? 0)
    const end = r.epoch + r.end
    const ts = shown.slice(from).filter(t => t >= start - 1 && t <= end)
    const gaps = ts.slice(1).map((t, i) => t - (ts[i] ?? t))
    console.log(
      JSON.stringify({
        label,
        rate,
        act,
        commit: r.commit === undefined ? undefined : Math.round(r.commit),
        shown: stats(gaps),
        raf: stats(r.raf),
      }),
    )
  }
  const cards = await page.evaluate(() =>
    [...document.querySelectorAll("#strip .column[data-card]")].map(
      c => c.getAttribute("data-card") ?? "",
    ),
  )
  const target = cards[Math.min(1, cards.length - 1)] ?? ""
  for (const rate of (process.env.FOLD_RATES ?? "1,4").split(",").map(Number)) {
    await throttle(rate)
    for (let i = 0; i < 3; i++) {
      await run(`run${i}`, rate, "baseline", target)
      await run(`run${i}`, rate, "fold", target)
      // The fold itself, then the unfold.
      for (let t = 0; t < 5; t++) {
        await page.click(`.column[data-card="${target}"] .column-menu`)
        const open = await page
          .waitForSelector(".menu button", { timeout: 2000 })
          .then(
            () => true,
            () => false,
          )
        if (open) break
        await page.screenshot({ path: "/tmp/s166-menu.png" })
      }
      await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>(".menu button")]
          .find(b => b.textContent?.trim() === "Fold")
          ?.click(),
      )
      await page.waitForSelector(`.folded-column[data-card="${target}"]`)
      await page.waitForTimeout(500)
      await run(`run${i}`, rate, "unfold", target)
      await page.waitForTimeout(800)
    }
  }
  await cdp.send("Page.stopScreencast")
  await throttle(1)
}

await browser.close()
await host.shutdown()
process.exit(0)
