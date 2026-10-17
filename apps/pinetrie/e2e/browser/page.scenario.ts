// e2e/browser/page — one window on a real host: who you are, the first turn,
// branches and their columns, moving them, tabs, the header and the inbox,
// the composer and cards, a second window, and a reload.

import {
  atEntry,
  entryId,
  handleOf,
  isTextCard,
  keyOf,
  projectRail,
  ROOT,
  type ThreadId,
  textCardId,
  writerId,
} from "@pinetrie/core"
import {
  type ButtonWords,
  identityCodec,
  promptParent,
  queueWords,
  readerHeading,
} from "@pinetrie/interface"
import { SCRIPTED_DESCRIPTION } from "@pinetrie/pi"
import {
  readMarks,
  readNames,
  readNoteColumns,
  readParticipantNames,
  readPlaces,
  readQueueHolds,
  readReading,
  readRoots,
  readTasks,
  readThreads,
  readTyping,
  readWorkflow,
} from "@pinetrie/reads"
import { canvasOf, indexTasks, titleOf } from "@pinetrie/rules"
import { COPIED } from "@pinetrie/web/copy"
import { IDENTITY_KEY } from "@pinetrie/web/storage-keys"
import type { Page } from "@playwright/test"
import type { Checks } from "../checks.ts"
import {
  boardStateOf,
  composeAt,
  entriesOf,
  idleNow,
  join,
  lanesOf,
  moveTaskTo,
  queueCard,
  startSuiteHost,
  suiteModel,
  taskHolding,
  threadHolding,
  treeOf,
  waitFor,
} from "../harness.ts"
import type { Scenario } from "../scenario.ts"

import {
  boardSel,
  chooseFromMenu,
  chooseOnCard,
  componentRenders,
  connected,
  itemSel,
  launchBrowser,
  OWN_MENU,
  openBoard,
  openFromBoard,
  openNote,
  openProfile,
  RAIL_MESSAGES,
  seeInMenu,
  shownName,
  stepAway,
  stepBack,
  storedName,
  TO_NOBODY,
  twoFrames,
  waitForListWidth,
  waitForQuiet,
} from "./page.ts"

export const scenario: Scenario = {
  run: ({ check }) => run(check),
}

async function run(check: Checks["check"]): Promise<void> {
  const browser = await launchBrowser()
  try {
    const script = suiteModel()
    const host = await startSuiteHost({
      model: { kind: "scripted", script },
      log: (m: string) => console.log("    [host]", m),
    })
    console.log(`  host              : ${host.httpUrl}\n`)
    /** The task the thread `root` starts is in: what the sidebar and the board name it by. */
    // Read while the host holds the root, and kept: an archived task's
    // root is let go.
    const tasksOf = new Map<string, string>()
    const taskOf = (root: string): string => {
      const known = tasksOf.get(root)
      if (known !== undefined) return known
      try {
        const task = taskHolding(host, entryId(root))
        tasksOf.set(root, task)
        return task
      } catch {
        return "no-task"
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
    /** The main page's person: the email it gives the form below. */
    const ME = writerId("ada@browser.test")
    /**
     * Make `p` a person before it loads: what the identity form would have
     * stored. A page from `browser.newPage()` has a context, and so a device, of
     * its own, which would otherwise ask.
     */
    const asPerson = (p: Page, email: string, name: string) =>
      p.addInitScript(([key, value]) => localStorage.setItem(key, value), [
        IDENTITY_KEY,
        JSON.stringify(identityCodec.encode({ email, name })),
      ] as const)
    const errors: string[] = []
    page.on("pageerror", e => errors.push(String(e.message)))
    page.on("console", m => m.type() === "error" && errors.push(m.text()))

    try {
      await page.goto(host.httpUrl, {
        waitUntil: "domcontentloaded",
        timeout: 20_000,
      })

      // A first visit asks who you are, and connects nothing until it knows: your
      // email is the principal, your name the session's label for you.
      await page.waitForSelector("#identity", { timeout: 20_000 })
      await page.fill('#identity input[name="email"]', "ada")
      await page.fill('#identity input[name="name"]', "Ada")
      await page.click('#identity button[type="submit"]')
      const refusedEmail = await page
        .waitForSelector('.identity-problem[data-problem="email"]', {
          timeout: 5_000,
        })
        .then(
          () => true,
          () => false,
        )
      await page.fill('#identity input[name="email"]', " Ada@Browser.Test ")
      await page.click('#identity button[type="submit"]')
      check(
        "a first visit asks for your email and name, and refuses what is not an email",
        refusedEmail,
      )

      // The bundle must load and connect before anything renders: a module the
      // browser cannot run fails exactly here, which a browser-free check cannot
      // see.
      await connected(page)
      // The render checks count React's development-build measures, and
      // against the production build every count is 0 and passes: refuse it.
      const devReact = await page
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
      check(
        "the page runs React's development build, whose renders the checks count",
        devReact,
      )
      if (!devReact)
        throw new Error(
          "React's production build: the render checks count nothing",
        )
      check(
        "no page errors during load",
        errors.length === 0,
        `${errors[0] === undefined ? "" : ` — ${errors[0].slice(0, 90)}`}`,
      )

      // ── helpers ──────────────────────────────────────────────────────────────
      /** A message for Ada only: it names her, so in agent work it asks no one. */
      const FOR_ADA = "@Ada just a note"
      /** A message whose markdown draws as other text: what copy copies is not what it shows. */
      const STILL_SOURCE = "still **off** it"
      const STILL = "still off it"
      /**
       * `STILL`'s message. `msg` finds none: `:text-is` does not match a
       * paragraph whose text is split by a <strong>.
       */
      const stillMsg = (scope: string) =>
        `${scope} .msg:has(> .text > p:only-child:has-text(${JSON.stringify(STILL)}))`
      const col = (n: number) => `.column[data-position="${n}"]`
      // Plain text is drawn as markdown: one paragraph. `:text-is` matches the
      // smallest element holding the text, which is that paragraph.
      const msg = (text: string) =>
        `.msg:has(> .text > p:only-child:text-is(${JSON.stringify(text)}))`
      const label = async (n: number) =>
        (await page.textContent(`${col(n)} .composer .send`))?.trim() ?? ""
      const send = async (n: number, text: string) => {
        await page.fill(`${col(n)} .composer .input`, text)
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
        page
          .$eval(sel, n => n.getBoundingClientRect().top)
          .catch(() => Number.NaN)

      // ── names, and the promise before the first message ─────────────────────
      await waitFor(
        () => readParticipantNames(host.session).get(ME) === "Ada",
        15_000,
      )
      await page.waitForSelector("#sidebar .add-agent", { timeout: 15_000 })
      await page.click("#sidebar .add-agent")
      await page.waitForSelector(`${col(0)} .composer`, { timeout: 15_000 })
      check(
        "＋ agent's new tab is ready to type in: its box has focus",
        (await caretIn(0)) === 0,
      )
      {
        const surface = await page.evaluate(() => {
          const look = (sel: string) => {
            const n = document.querySelector(sel)
            return n === null
              ? null
              : {
                  fill: getComputedStyle(n).backgroundColor,
                  rect: n.getBoundingClientRect(),
                }
          }
          return {
            item: look("#sidebar .sidebar-item[data-selected]"),
            page: look("#stage"),
            list: look("#sidebar"),
          }
        })
        const { item, page: paper, list } = surface
        check(
          "the root you are on is the page's colour, the sidebar is not, and it meets the page",
          item !== null &&
            paper !== null &&
            list !== null &&
            item.fill === paper.fill &&
            list.fill !== paper.fill &&
            Math.abs(item.rect.right - paper.rect.left) <= 1,
          JSON.stringify({
            item: item && [item.fill, item.rect.right],
            page: paper && [paper.fill, paper.rect.left],
            list: list?.fill,
          }),
        )
      }
      // The board opens over the columns, from the footer's edge, and moves
      // none of them. A click on a column above it closes it.
      {
        const rects = () =>
          page.$$eval(".column", cs =>
            cs.map(c => {
              const r = c.getBoundingClientRect()
              return [r.x, r.y, r.width, r.height].map(Math.round).join()
            }),
          )
        const before = await rects()
        await page.click("#bottom .board-toggle")
        const board = await page
          .waitForSelector("#board", { timeout: 15_000 })
          .then(
            () => true,
            () => false,
          )
        const during = await rects()
        const over = await page
          .$eval("#board", b => {
            const r = b.getBoundingClientRect()
            const c = document.querySelector(".column")?.getBoundingClientRect()
            return c !== undefined && r.top < c.bottom && r.bottom > c.top
          })
          .catch(() => false)
        const above = await page
          .$eval(`${col(0)} .column-head`, h => {
            const r = h.getBoundingClientRect()
            return { x: r.left + 4, y: r.bottom + 4 }
          })
          .catch(() => null)
        if (above !== null) await page.mouse.click(above.x, above.y)
        const closed = await page
          .waitForSelector("#board", { state: "detached", timeout: 5_000 })
          .then(
            () => true,
            () => false,
          )
        if (!closed) await page.click("#bottom .board-toggle")
        check(
          "the board opens over the columns, moves none of them, and a click outside closes it",
          board &&
            over &&
            closed &&
            before.length > 0 &&
            during.join("|") === before.join("|"),
          `${before.join("|")} → ${during.join("|")}; closed: ${closed}`,
        )
      }
      // Its thread is named before anything is typed.
      const nameBefore = await page
        .waitForSelector(`${col(0)} .column-head .agent-name[data-thread]`, {
          timeout: 15_000,
        })
        .then(
          n => n.getAttribute("data-thread"),
          () => null,
        )
      /** Where the columns start: the rail's width, plus its border. */
      const stripLeft = () =>
        page.$eval("#strip", n => Math.round(n.getBoundingClientRect().left))
      const emptyLeft = await stripLeft()

      // ── the first turn: the reply, the agent joining ────────────────────────
      // Whether a reply streams live is checked on the scripted host below, where
      // its pace is set: a live model's one-line reply can open and close its
      // stream between two of the page's renders.
      await send(0, "Say exactly: BROWSER-OK")
      // Structure, not the model's words: a reply appeared, in this column. What
      // the model says is `e2e:live`'s to check.
      await idle()
      {
        const [lane, ...others] = lanesOf(
          host,
          treeOf(host),
          readPlaces(host.places),
        )
        const laneName =
          lane === undefined || others.length > 0
            ? null
            : readNames(host.session).get(lane.name)
        const nameAfter = await page.getAttribute(
          `${col(0)} .column-head .agent-name`,
          "data-thread",
        )
        check(
          "a new agent is named before anything is typed, and its lane keeps that name",
          nameBefore !== null &&
            laneName === nameBefore &&
            nameAfter === nameBefore,
          `${nameBefore}, ${laneName}, ${nameAfter}`,
        )
      }
      const roles = await page.$$eval(`${col(0)} .msg`, ns =>
        ns.map(
          n =>
            `${n.className.replace("msg ", "")}:${n.querySelector(".role")?.textContent}`,
        ),
      )
      check(
        "the column reads Ada's asked message, then the agent",
        roles.join(",") === "chat asked:Ada,assistant:agent",
        `${roles.join(", ")}`,
      )
      const filledLeft = await stripLeft()
      // One track: its dots are centred in the rail, not against its left edge.
      const offCentre = await page.$eval(".rail", rail => {
        const dot = rail.querySelector(".rail-dot")?.getBoundingClientRect()
        const box = rail.getBoundingClientRect()
        return dot === undefined
          ? Number.POSITIVE_INFINITY
          : Math.abs(
              dot.left + dot.width / 2 - (box.left + rail.clientWidth / 2),
            )
      })
      check(
        "the first message takes the new tab's hollow dot, and the columns stay put",
        filledLeft === emptyLeft &&
          (await page.locator(".rail-start").count()) === 0,
        `${emptyLeft}px → ${filledLeft}px`,
      )
      check(
        "one track's dots are centred in the rail",
        offCentre <= 1,
        `${offCentre.toFixed(1)}px off`,
      )

      // ── mentions pick the addressee, and the button says so ────────────────
      // The thread has a lane now, so a message naming no one asks the agent; one
      // naming only a person is for them.
      await page.fill(`${col(0)} .composer .input`, FOR_ADA)
      await page.click(`${col(0)} .composer .send`)
      await shows(FOR_ADA)
      await page.fill(
        `${col(0)} .composer .input`,
        "@agent say exactly: BROWSER-TWO",
      )
      await page.click(`${col(0)} .composer .send`)
      await idle()
      /** Messages the rail draws: one per dot, and each capsule's count. */
      const railCount = (p: Page = page) => p.evaluate(RAIL_MESSAGES)

      // ── a branch opens beside its parent, in its colour ─────────────────────
      // It forks at the agent's reply, the second message, so opening has to
      // bring its first message down to meet the fork point.
      const replyId =
        (await page.$eval(`${col(0)} .msg.assistant`, n =>
          n.getAttribute("data-entry"),
        )) ?? ""
      const atReply = `${col(0)} .msg[data-entry="${replyId}"]`
      const other = await join(host, "other", "browser")
      await other.request({ kind: "name", name: "Bea" })
      // A fork on purpose, at the agent's reply: `branch`. A branch starts as a
      // conversation, so it is appended with no run.
      await other.chat("an aside", atEntry(entryId(replyId)), {
        mode: "branch",
      })
      await page.waitForSelector(`${atReply} .open-branch`, { timeout: 15_000 })
      await texts(0)
      await page.evaluate(() => document.fonts.ready)
      await page.click(`${atReply} .open-branch`)
      const opened = await shows("an aside", col(1))
      check(
        "the branch opened as a second column, to the right of its parent",
        opened && (await page.$$eval(".column", n => n.length)) === 2,
      )
      const drift = Math.abs(
        (await top(`${col(1)} .msg`)) - (await top(atReply)),
      )
      const needed = (await top(atReply)) - (await top(`${col(0)} .msg`))
      check(
        "it opened with its first message level with the fork point",
        drift <= 4 && needed > 20,
        `${needed.toFixed(0)}px down (off by ${drift.toFixed(1)}px)`,
      )
      const colours = await page.evaluate(
        ({ first, branch }) => {
          const column = document.querySelector(branch)
          const track = column?.getAttribute("data-track") ?? ""
          const dot = document.querySelector(
            `${first} .fork-dot[data-track="${track}"]`,
          )
          const railDot = document.querySelector(
            `.rail-dot[data-track="${track}"][data-open="yes"]`,
          )
          const head = column?.querySelector(".column-head") ?? null
          return {
            head:
              head === null ? "none" : getComputedStyle(head).borderTopColor,
            dot: dot === null ? "none" : getComputedStyle(dot).backgroundColor,
            rail:
              railDot === null
                ? "none"
                : getComputedStyle(railDot).backgroundColor,
          }
        },
        { first: col(0), branch: col(1) },
      )
      check(
        "the branch's header, its fork dot and its rail track share a colour",
        colours.head !== "none" &&
          colours.head === colours.dot &&
          colours.dot === colours.rail,
        `${colours.head} · ${colours.dot} · ${colours.rail}`,
      )
      // Hovering the header outlines its fork dot in the branch's colour. The
      // aside is the root's first branch, so its track is 1 (`projectRail`),
      // the slot the mutation names.
      await page.hover(`${col(1)} .column-head .head-row`)
      const outline = await page.evaluate(
        ({ first, branch }) => {
          const track = document
            .querySelector(branch)
            ?.getAttribute("data-track")
          const dot = document.querySelector(
            `${first} .fork-dot[data-track="${track}"]`,
          )
          return dot === null ? "none" : getComputedStyle(dot).outlineColor
        },
        { first: col(0), branch: col(1) },
      )
      await page.mouse.move(0, 0)
      check(
        "hovering a branch's header outlines its fork dot in the branch's colour",
        outline === colours.head,
        `${outline} · ${colours.head}`,
      )
      const beforeScroll = await page.$eval(
        `${col(1)} .column-body`,
        n => n.scrollTop,
      )
      await page.$eval(`${col(0)} .column-body`, n => {
        n.scrollTop += 40
      })
      check(
        "scrolling one column does not scroll another",
        (await page.$eval(`${col(1)} .column-body`, n => n.scrollTop)) ===
          beforeScroll,
      )
      // The header's origin row leads back to the fork point. A short window puts
      // it out of view first, so the row has somewhere to go.
      {
        const size = page.viewportSize()
        if (size !== null) await page.setViewportSize({ ...size, height: 260 })
        await page.$eval(`${col(0)} .column-body`, n => {
          n.scrollTop = n.scrollHeight
        })
        const inView = () =>
          page.$eval(atReply, m => {
            const r = m.getBoundingClientRect()
            const body = m.closest(".column-body")?.getBoundingClientRect()
            return (
              body !== undefined && r.bottom > body.top && r.top < body.bottom
            )
          })
        const hidden = !(await inView())
        await page.click(`${col(1)} .column-head .origin`)
        const back = await waitFor(() => inView(), 5_000)
        if (size !== null) await page.setViewportSize(size)
        check(
          "the origin row leads back to the fork point",
          hidden && back >= 0,
          `hidden first: ${hidden}`,
        )
      }

      // ── → opens a branch beside its parent, and it follows its branch ──────
      // The → sits in the column's right padding, all but a pixel outside its
      // message, and a hidden → takes no hover. A pointer that overshoots into
      // that padding, past the →, must still show it and reach it.
      await page.locator(`${col(0)} ${msg(FOR_ADA)}`).scrollIntoViewIfNeeded()
      const gutter = await page.$eval(`${col(0)} ${msg(FOR_ADA)}`, m => {
        const body = m.closest(".column-body")
        const arrow = m
          .querySelector(":scope > .tools > .branch")
          ?.getBoundingClientRect()
        if (body === null || arrow === undefined) return null
        // Its client area's right edge: a scrollbar, if drawn, lies beyond it.
        const inner =
          body.getBoundingClientRect().left + body.clientLeft + body.clientWidth
        return {
          past: { x: inner - 1, y: arrow.top + arrow.height / 2 },
          on: {
            x: arrow.left + arrow.width / 2,
            y: arrow.top + arrow.height / 2,
          },
        }
      })
      await page.mouse.move(0, 0)
      if (gutter !== null) {
        await page.mouse.move(gutter.past.x, gutter.past.y)
        await page.mouse.move(gutter.on.x, gutter.on.y, { steps: 4 })
      }
      const reached =
        gutter !== null &&
        (await page.evaluate(({ x, y }) => {
          const hit = document.elementFromPoint(x, y)
          return (
            hit?.classList.contains("branch") === true &&
            getComputedStyle(hit).visibility === "visible"
          )
        }, gutter.on))
      check(
        "→ shows from the padding beside its message, and takes the click",
        reached,
      )

      // From the first column while two are open, so "beside its parent"
      // (position 1) and "the far right" (position 2) differ.
      await page.hover(`${col(0)} ${msg(FOR_ADA)}`)
      await page.click(`${col(0)} ${msg(FOR_ADA)} > .tools > .branch`)
      // Where it opens and what it starts with are `planIntent`'s and
      // `startText`'s, proven by their unit tests.
      await page
        .waitForFunction(
          ([c, text]) =>
            document
              .querySelector(`${c} .origin`)
              ?.textContent?.includes(text) === true &&
            document.querySelector(`${c} .msg`) === null,
          [col(1), FOR_ADA] as const,
          { timeout: 15_000 },
        )
        .catch(() => null)
      const caret = await caretIn(1)
      check(
        "→ opens a branch ready to type in: its box has focus, the caret after @agent",
        caret === "@agent ".length,
        `${caret}`,
      )
      // Its header says a new agent starts, for as long as its composer asks one:
      // `new agent`, then its name once reserved.
      {
        const agentName = `${col(1)} .column-head .agent-name`
        const appears = (present: boolean) =>
          page
            .waitForFunction(
              ([sel, want]) => (document.querySelector(sel) !== null) === want,
              [agentName, present] as const,
              { timeout: 5_000 },
            )
            .then(
              () => true,
              () => false,
            )
        const first = await appears(true)
        await page.fill(`${col(1)} .composer .input`, "")
        const gone = await appears(false)
        await page.fill(`${col(1)} .composer .input`, "@agent ")
        const again = await appears(true)
        check(
          "a new column's header says a new agent starts only while its composer asks one",
          first && gone && again,
          `${first}, ${gone}, ${again}`,
        )
      }
      await railCount()
      await send(1, "deeper")
      await idle()
      // Each column's LAST message, found by class: `:last-of-type` would match
      // the last div, and pass on finding nothing.
      await page.$$eval(".column", cs =>
        cs.map(c => {
          const all = c.querySelectorAll(".column-body .msg")
          const last = all[all.length - 1]
          return (
            last
              ?.querySelector(":scope > .tools > .branch")
              ?.getAttribute("title") ?? (last === undefined ? "none" : "no")
          )
        }),
      )

      // ── folding a column: its name turns into its strip ───────────────────
      // The trunk's, whose agent has a name (a chat has none to turn). Each
      // frame until the strip is drawn, the header name's box; then the
      // strip's name. The last frame of the fold is where the strip draws its
      // name, to within a pixel, in the column's colour.
      {
        const card = (await page.getAttribute(col(0), "data-card")) ?? ""
        const turn = page.evaluate(
          ([sel, card]) =>
            new Promise<{
              first: number[] | null
              last: number[] | null
              strip: number[] | null
              frames: number
              colour: string | null
              stripColour: string | null
            } | null>(resolve => {
              const box = (e: Element | null) => {
                const r = e?.getBoundingClientRect()
                return r === undefined
                  ? null
                  : [r.left, r.top, r.width, r.height]
              }
              let first: number[] | null = null
              let last: number[] | null = null
              let colour: string | null = null
              let frames = 0
              const tick = () => {
                frames++
                const strip = document.querySelector(
                  `.folded-column[data-card="${card}"] [data-fold-name]`,
                )
                if (strip !== null) {
                  resolve({
                    first,
                    last,
                    strip: box(strip),
                    frames,
                    colour,
                    stripColour: getComputedStyle(strip).color,
                  })
                  return
                }
                const name = document.querySelector(`${sel} [data-fold-name]`)
                if (name !== null) {
                  last = box(name)
                  first ??= last
                  colour ??= getComputedStyle(name).color
                }
                if (frames < 600) requestAnimationFrame(tick)
                else resolve(null)
              }
              requestAnimationFrame(tick)
            }),
          [col(0), card] as const,
        )
        await chooseFromMenu(page, `${col(0)} .column-menu`, ".column-fold")
        const t = await turn
        const off =
          t?.last == null || t.strip === null
            ? Infinity
            : Math.max(
                ...t.last.map((v, i) => Math.abs(v - (t.strip?.[i] ?? 0))),
              )
        check(
          "a fold turns the column's name onto its strip's, in its colour",
          t !== null &&
            t.first !== null &&
            (t.first[2] ?? 0) > (t.first[3] ?? 0) &&
            off <= 1 &&
            t.colour !== null &&
            t.colour === t.stripColour,
          JSON.stringify({ ...t, off }),
        )
        await page
          .click(`.folded-column[data-card="${card}"] .folded-title`, {
            timeout: 15_000,
          })
          .catch(() => {})
        // Moved back, before the columns are dragged and measured.
        await page
          .waitForFunction(
            c =>
              document.querySelector(`.column[data-card="${c}"]`) !== null &&
              document.getAnimations().every(a => a.id !== "fold"),
            card,
            { timeout: 15_000 },
          )
          .catch(() => {})
      }

      // ── moving a column: drag its header, or Alt+arrows ───────────────────
      const keys = () =>
        page.$$eval(".column", ns => ns.map(n => n.getAttribute("data-key")))
      /** Press column `n`'s header, and move to `dx` px into column `into`. */
      const dragHeader = async (n: number, into: number, dx: number) => {
        const head = await page.locator(`${col(n)} .column-head`).boundingBox()
        const target = await page.locator(col(into)).boundingBox()
        if (head === null || target === null) return false
        const y = head.y + head.height / 2
        await page.mouse.move(head.x + 40, y)
        await page.mouse.down()
        await page.mouse.move(target.x + dx, y, { steps: 12 })
        return true
      }
      const marked = () =>
        page.evaluate(() => ({
          dragging:
            document
              .querySelector(".column[data-dragging]")
              ?.getAttribute("data-position") ?? null,
          // The neighbours slid apart to open the gap it would land in.
          shifted: [
            ...document.querySelectorAll<HTMLElement>(
              ".column:not([data-dragging])",
            ),
          ]
            .filter(n => n.style.transform !== "")
            .map(n => n.getAttribute("data-position"))
            .join(),
        }))
      const unmoved = await keys()
      const pressed = await dragHeader(2, 0, 60)
      const mid = await marked()
      check(
        "a dragged header's column is lifted and its neighbours slide apart where it will land; nothing moves before the drop",
        pressed &&
          mid.dragging === "2" &&
          mid.shifted === "0,1" &&
          (await keys()).join() === unmoved.join(),
        `${JSON.stringify(mid)}`,
      )
      await page.keyboard.press("Escape")
      await page.mouse.up()
      const after = await marked()
      check(
        "Escape cancels a drag: nothing moves, and nothing stays marked",
        (await keys()).join() === unmoved.join() &&
          after.dragging === null &&
          after.shifted === "",
        `${JSON.stringify(after)}`,
      )
      // A cancelled drag springs back: the header is pressed where it rests.
      await page
        .waitForFunction(
          () =>
            [...document.querySelectorAll<HTMLElement>(".column")].every(
              c => c.style.transform === "" && c.style.transition === "",
            ),
          undefined,
          { timeout: 5_000 },
        )
        .catch(() => {})
      await dragHeader(2, 0, 60)
      await page.mouse.up()
      // The canvas's order is the host's: it is drawn once its answer comes.
      await page
        .waitForFunction(
          k =>
            document.querySelector(".column")?.getAttribute("data-key") === k,
          unmoved[2],
          { timeout: 5_000 },
        )
        .catch(() => {})
      const dropped = await keys()
      check(
        "a dropped column moves there, and the others keep their order",
        dropped.join() ===
          [unmoved[2], unmoved[0], unmoved[1], ...unmoved.slice(3)].join(),
        `${unmoved.length} columns`,
      )
      await page.waitForFunction(
        c =>
          document
            .querySelector(`${c} .msg`)
            ?.textContent?.includes("BROWSER-OK"),
        col(0),
        { timeout: 15_000 },
      )
      const main = await texts(0)
      const former = await texts(1)
      check(
        "moved first, a branch shows its whole path, and the old first column now starts after its fork point",
        main.includes("an aside") &&
          former.some(t => t.includes("BROWSER-TWO")) &&
          !former.includes("Say exactly: BROWSER-OK"),
      )
      const leftover = await page.$eval(
        `${col(0)} .spacer`,
        n => n.getBoundingClientRect().height,
      )
      check(
        "the new first column keeps no alignment spacer: it has no fork point",
        leftover === 0,
        `${leftover}px`,
      )
      // Alt+arrows move the column focus is in, outside a text box.
      await page.focus(`${col(0)} .column-head button`)
      await page.keyboard.press("Alt+ArrowRight")
      const stepped = await keys()
      const focused = await page.evaluate(
        () =>
          document.activeElement
            ?.closest(".column")
            ?.getAttribute("data-key") ?? null,
      )
      check(
        "Alt+→ in a column moves it one place right, and focus stays in it",
        stepped.join() ===
          [dropped[1], dropped[0], ...dropped.slice(2)].join() &&
          focused === dropped[0],
        `${focused}`,
      )
      // The strip is wider than the page, so the last column starts cut off.
      for (let i = 1; i < dropped.length - 1; i++)
        await page.keyboard.press("Alt+ArrowRight")
      const shown = await page.evaluate(() => {
        const strip = document.querySelector("#strip")
        const moved = document.activeElement?.closest(".column")
        if (strip === null || moved === null || moved === undefined) return null
        const s = strip.getBoundingClientRect()
        const c = moved.getBoundingClientRect()
        return {
          overflows: strip.scrollWidth > strip.clientWidth,
          last: moved.getAttribute("data-position"),
          inView: c.left >= s.left - 1 && c.right <= s.right + 1,
        }
      })
      check(
        "Alt+→ on to the last place scrolls the strip to show it",
        shown?.overflows === true &&
          shown.last === String(dropped.length - 1) &&
          shown.inView,
        `${JSON.stringify(shown)}`,
      )
      for (let i = 1; i < dropped.length; i++)
        await page.keyboard.press("Alt+ArrowLeft")

      // ── a busy thread: the composer says it will queue, and it does ────────
      // On one host the page sees another writer's run start almost at once, so
      // the composer chooses `queue` itself: that is what a person meets. A true
      // conflict needs two sends to cross in flight; its outcome is checked in
      // e2e, where the commands can be ordered.
      const tipOf0 = () =>
        page.$$eval(
          `${col(0)} .column-body .msg[data-entry]`,
          ns => ns.at(-1)?.getAttribute("data-entry") ?? "",
        )
      await page.fill(`${col(0)} .composer .input`, "@agent after Bea")
      await label(0)
      // Her reply is paused, so her run shows for as long as the checks look.
      const beasTurn = script.hold("Bea's turn")
      await other.chat("@agent Bea's turn", atEntry(entryId(await tipOf0())))
      // The send button once it says `words`: its label and its title.
      const queueButton = (words: ButtonWords) =>
        page
          .waitForFunction(
            ([c, label, title]) => {
              const b = document.querySelector(`${c} .composer .send`)
              return (
                b?.textContent === label && b.getAttribute("title") === title
              )
            },
            [col(0), words.label, words.title] as const,
            { timeout: 15_000 },
          )
          .then(
            () => true,
            () => false,
          )
      // Bea queues a card behind her run, as her client does when she sends.
      await waitFor(
        () => Object.keys(host.live.activeRuns()).length > 0,
        15_000,
      )
      const beaLane = Object.keys(host.live.activeRuns())[0] as
        | ThreadId
        | undefined
      const beaTip = entryId(await tipOf0())
      const again = await composeAt(
        other,
        { entry: beaTip, lane: beaLane ?? null },
        "@agent Bea again",
      )
      if (beaLane !== undefined) void queueCard(other, again, beaLane)
      // Hers is queued first: a mutant that draws no queued card fails at
      // the check below, not here.
      await waitFor(
        () =>
          readPlaces(host.places).some(
            c => c.id === again && c.place.kind === "queued",
          ),
        15_000,
      )
      await page.click(`${col(0)} .composer .send`)
      // Yours is queued after hers, above the line; her edit to it shows.
      const queuedHere = await waitFor(
        () =>
          readPlaces(host.places).some(
            c =>
              c.kind === "text" &&
              c.place.kind === "queued" &&
              host.cardText(c.id) === "@agent after Bea",
          ),
        15_000,
      )
      const yours = readPlaces(host.places)
        .filter(isTextCard)
        .find(
          c =>
            c.place.kind === "queued" &&
            host.cardText(c.id) === "@agent after Bea",
        )
      if (yours !== undefined) {
        const theirs = other.cardText(yours.id)
        await waitFor(() => theirs.text() === "@agent after Bea", 15_000)
        theirs.text.insert(16, ", and Bea's too")
      }
      const drawn = await page
        .waitForFunction(
          ([c, id]) => {
            const dock = document.querySelector(`${c} .dock`)
            const cards = [
              ...(dock?.querySelectorAll(".card-editor.queued") ?? []),
            ]
            const last = cards.at(-1)
            return (
              cards.length === 2 &&
              last?.getAttribute("data-queued") === id &&
              last.querySelector("textarea")?.value ===
                "@agent after Bea, and Bea's too"
            )
          },
          [col(0), yours?.id ?? ""] as const,
          { timeout: 15_000 },
        )
        .then(
          () => true,
          () => false,
        )
      check(
        "your queued card is drawn above the line, last in its queue, and another writer's edit to it shows",
        queuedHere >= 0 && drawn,
        `${queuedHere} ms`,
      )
      // The dock: grown past a third of the column, by a tall
      // message, it scrolls within, its queue header still in view.
      const dockHolds = await page.$eval(col(0), c => {
        const dock = c.querySelector<HTMLElement>(".dock")
        const thread = c.querySelector<HTMLElement>(".column-thread")
        const head = c.querySelector<HTMLElement>(".dock .queue-head")
        const box = c.querySelector<HTMLElement>(".composer .input")
        if (dock === null || thread === null || head === null || box === null)
          return null
        const was = box.style.height
        box.style.height = `${thread.offsetHeight}px`
        dock.scrollTop = dock.scrollHeight
        const d = dock.getBoundingClientRect()
        const h = head.getBoundingClientRect()
        const seen = {
          share: dock.offsetHeight / thread.offsetHeight,
          scrolled: dock.scrollTop > 0,
          headIn: h.top >= d.top - 1 && h.bottom <= d.bottom + 1,
        }
        box.style.height = was
        dock.scrollTop = 0
        return seen
      })
      check(
        "the dock keeps the queue's header in view past a third of the column",
        dockHolds !== null &&
          dockHolds.share <= 0.34 &&
          dockHolds.scrolled &&
          dockHolds.headIn,
        JSON.stringify(dockHolds),
      )
      check(
        "with your own message last in line, it says it will queue after yours",
        await queueButton(queueWords({ kind: "afterYours", ahead: 2 })),
        `"${await label(0)}"`,
      )
      // ── the queue's own controls ────────────────────────
      // Alt+↑ in your queued card moves it above Bea's; its box keeps the
      // focus and the caret, though the list was drawn again.
      const yourBox = `${col(0)} .card-editor.queued textarea[data-card="${yours?.id ?? ""}"]`
      await page.focus(yourBox)
      await page.$eval(yourBox, el => {
        ;(el as HTMLTextAreaElement).setSelectionRange(5, 5)
      })
      await page.keyboard.press("Alt+ArrowUp")
      const firstNow = () =>
        readPlaces(host.places)
          .filter(c => c.place.kind === "queued")
          .sort((a, b) =>
            (a.place as { order: string }).order <
            (b.place as { order: string }).order
              ? -1
              : 1,
          )[0]?.id
      const reordered = await waitFor(() => firstNow() === yours?.id, 15_000)
      const focusKept = await page
        .waitForFunction(
          ([c, id]) => {
            const first = document.querySelector(`${c} .card-editor.queued`)
            const a = document.activeElement as HTMLTextAreaElement | null
            return (
              first?.getAttribute("data-queued") === id &&
              a?.getAttribute("data-card") === id &&
              a.selectionStart === 5
            )
          },
          [col(0), yours?.id ?? ""] as const,
          { timeout: 15_000 },
        )
        .then(
          () => true,
          () => false,
        )
      check(
        "Alt+↑ in a queued card moves it up the queue, and its box keeps the focus and the caret",
        reordered >= 0 && focusKept,
        `${reordered} ms; ${focusKept}`,
      )
      // Hold, then unqueue all: both cards go below the line, the queue held.
      // The undo key puts them back, and a release lets them go when Bea's
      // turn ends.
      await chooseFromMenu(page, `${col(0)} .queue-menu-trigger`, ".hold-queue")
      await waitFor(
        () =>
          beaLane !== undefined && readQueueHolds(host.session).has(beaLane),
        15_000,
      )
      await chooseFromMenu(
        page,
        `${col(0)} .queue-menu-trigger`,
        ".unqueue-all",
      )
      const unqueued = await waitFor(
        () =>
          [again, yours?.id].every(
            id =>
              readPlaces(host.places).find(c => c.id === id)?.place.kind ===
              "note",
          ),
        15_000,
      )
      // Held while Bea's turn runs: the header's ⋯ offers the release.
      const releaseShown =
        (await seeInMenu(
          page,
          `${col(0)} .queue-menu-trigger`,
          ".release-queue",
        ).catch(() => null)) !== null
      await page.keyboard.press("Escape")
      check(
        "hold queue holds the thread's queue, and unqueue all puts every queued card below the line",
        unqueued >= 0 && releaseShown,
        `${unqueued} ms; release shown ${releaseShown}`,
      )
      await page.evaluate(() =>
        (document.activeElement as HTMLElement | null)?.blur(),
      )
      await page.keyboard.press("ControlOrMeta+z")
      await waitFor(
        () =>
          [again, yours?.id].every(
            id =>
              readPlaces(host.places).find(c => c.id === id)?.place.kind ===
              "queued",
          ),
        15_000,
      )
      await chooseFromMenu(
        page,
        `${col(0)} .queue-menu-trigger`,
        ".release-queue",
      )
      await waitFor(
        () =>
          beaLane !== undefined && !readQueueHolds(host.session).has(beaLane),
        15_000,
      )
      beasTurn.finish()
      await waitFor(() => idleNow(host))
      const asked = [
        "@agent Bea's turn",
        "@agent Bea again",
        "@agent after Bea, and Bea's too",
      ]
      await page.$$eval(
        `${col(0)} .msg`,
        (ns, asked) =>
          ns
            .map(n => n.querySelector(":scope > .text")?.textContent ?? "")
            .filter(t => asked.includes(t)),
        asked,
      )
      await page.$$eval(`${col(0)} .msg`, ns =>
        ns.slice(-4).map(n => n.className.replace("msg ", "").split(" ")[0]),
      )

      // ── the agent in a thread no column shows: the rail pulses ──────────────
      // A fold lands once its column has moved into its strip: the second
      // waits for the first.
      const whole = await page.$$eval(".column", cs => cs.length)
      await chooseFromMenu(page, `${col(1)} .column-menu`, ".column-fold")
      await page
        .waitForFunction(
          n => document.querySelectorAll(".column").length === n,
          whole - 1,
          { timeout: 15_000 },
        )
        .catch(() => {})
      await chooseFromMenu(page, `${col(1)} .column-menu`, ".column-fold")
      await page.waitForFunction(
        () => document.querySelectorAll(".column").length === 1,
        undefined,
        { timeout: 15_000 },
      )
      const forAdaId =
        Object.values(entriesOf(host)).find(e =>
          JSON.stringify(e).includes("just a note"),
        )?.id ?? ""
      const pulse = script.hold("say exactly: PULSE")
      await other.chat(
        "@agent say exactly: PULSE",
        atEntry(entryId(forAdaId)),
        {
          mode: "branch",
        },
      )
      const pulsing = await page
        .waitForSelector(".rail-dot.pulse", { timeout: 30_000 })
        .then(el => el.getAttribute("data-entry"))
        .catch(() => null)
      check(
        "the rail pulses where the agent replies, with no column open there",
        pulsing !== null,
      )
      // A pulsing dot scales forever, and Playwright clicks only a still element.
      pulse.finish()
      if (pulsing !== null)
        await page.click(`.rail-dot[data-entry="${pulsing}"]`)
      check(
        "clicking the pulse opens that thread",
        await shows("@agent say exactly: PULSE"),
      )
      await idle()
      // While the agent works, the strip counts its root and the thread's
      // item shows a still ring: nothing in the footer, and nothing in your
      // list, animates.
      const held = script.hold("say exactly: HELD")
      await other.chat("@agent say exactly: HELD", atEntry(entryId(forAdaId)), {
        mode: "branch",
      })
      const working = await page
        .waitForSelector("#bottom .state-working", { timeout: 30_000 })
        .then(
          () => true,
          () => false,
        )
      const tabWorking = await page
        .waitForSelector('#sidebar .signal[data-signal="running"]', {
          timeout: 15_000,
        })
        .then(
          () => true,
          () => false,
        )
      const animated = await page
        .$$eval(
          '#bottom .strip-state, #bottom .strip-state *, #sidebar .signal:not([data-signal="unsent"])',
          ns =>
            ns.flatMap(n => {
              const name = getComputedStyle(n).animationName
              return name === "none" ? [] : [name]
            }),
        )
        .catch(() => ["no strip"])
      check(
        "the strip's working count and the thread's item are still while the agent works",
        working && tabWorking && animated.length === 0,
        !working
          ? "no working count"
          : !tabWorking
            ? "no working mark on the tab"
            : animated.join(", "),
      )
      held.finish()
      await idle()
      await other.close()

      // ── a page over the stage: the browser's Back leaves it,
      // and the columns under it kept their place. ──
      const body = `${col(0)} .column-body`
      const scrolled = await page
        .$eval(body, n => {
          const room = n.scrollHeight - n.clientHeight
          n.scrollTop = Math.floor(room / 2)
          return room > 100 ? n.scrollTop : null
        })
        .catch(() => null)
      await waitFor(() => false, 300)
      const covered = await openProfile(page)
      await page.goBack()
      const left = await page
        .waitForFunction(
          () => document.querySelector(".page") === null,
          undefined,
          {
            timeout: 10_000,
          },
        )
        .then(
          () => true,
          () => false,
        )
      const stayed = await page.$eval(body, n => n.scrollTop).catch(() => -1)
      check(
        "the profile page covers the stage, and the browser's Back returns to the columns as they were",
        scrolled !== null && covered && left && stayed === scrolled,
        `scrollTop ${scrolled} → ${stayed}, covered ${covered}, left ${left}`,
      )

      // ── the setup page, from the menu: each config file the host read ──
      const setupText = (await chooseFromMenu(
        page,
        "#bottom .me-trigger",
        ".account-setup",
      ))
        ? await page
            .waitForSelector('.page[data-page="setup"] .setup-files', {
              timeout: 15_000,
            })
            .then(n => n.textContent())
            .catch(() => null)
        : null
      check(
        "the setup page names each config file the host read",
        setupText !== null &&
          host.config.files.length > 0 &&
          host.config.files.every(f => setupText.includes(f.file)),
        setupText ?? "no setup page",
      )
      await page.goBack()
      await page
        .waitForFunction(
          () => document.querySelector(".page") === null,
          undefined,
          {
            timeout: 10_000,
          },
        )
        .catch(() => {})

      // ── your profile: a rename shows, and the name each message was sent ──
      // under stays; this device keeps the name you go by.
      const profileSeen = await openProfile(page)
      const profile = '.page[data-page="profile"]'
      const nameField = `${profile} input[name="name"]`
      await page.fill(nameField, "agent")
      await page.press(nameField, "Enter")
      const refusedName = await page
        .waitForSelector(`${profile} .name-problem[data-problem="name"]`, {
          timeout: 5_000,
        })
        .then(
          () => true,
          () => false,
        )
      check(
        "your profile refuses a name no mention could reach, before sending it",
        profileSeen && refusedName,
      )
      await page.fill(nameField, "Ada Lovelace")
      const hint = await page
        .textContent(`${profile} .name-handle`, { timeout: 5_000 })
        .catch(() => null)
      check(
        "your profile shows the handle the name you type gives you",
        hint === "others mention you as @adalovelace",
        `${hint}`,
      )
      await page.press(nameField, "Enter")
      const renamed = await page
        .waitForFunction(
          () =>
            [...document.querySelectorAll(".msg.chat .role")].some(
              n => n.textContent === "Ada Lovelace (Ada)",
            ),
          undefined,
          { timeout: 15_000 },
        )
        .then(
          () => true,
          () => false,
        )
      check(
        "after a rename, Ada's earlier messages show her current name, then the one she sent under",
        renamed,
      )
      check(
        "a rename is kept on this device",
        (await waitFor(
          async () => (await storedName(page)) === "Ada Lovelace",
          10_000,
        )) >= 0,
      )
      // The page's person, from another device: its rename reaches this one's
      // storage too. Set back, so the checks below see "Ada Lovelace".
      const adaElsewhere = await join(host, "ada", "browser")
      await adaElsewhere.request({ kind: "name", name: "Ada L" })
      const followed = await waitFor(
        async () =>
          (await shownName(page)) === "Ada L" &&
          (await storedName(page)) === "Ada L",
        15_000,
      )
      await adaElsewhere.request({ kind: "name", name: "Ada Lovelace" })
      await waitFor(
        async () => (await shownName(page)) === "Ada Lovelace",
        15_000,
      )
      await adaElsewhere.close()
      check("a rename on another device is kept on this one", followed >= 0)

      // ── ＋ agent: a new tab, an agent thread at the root, and stepping down ──
      const firstRoot = treeOf(host).roots[0] ?? ""
      // A new tab holds one column, so the thread's columns count from 0.
      const before = 0
      await page.click("#sidebar .add-agent")
      const agentCol = col(before)
      await page.waitForSelector(`${agentCol} .composer`, { timeout: 15_000 })
      await send(before, "say exactly: DOWN-ONE")
      await page.waitForSelector(`${agentCol} .msg.assistant`, {
        timeout: 60_000,
      })
      await idle()
      // → at the agent thread's end opens a branch with @agent typed; deleting
      // it steps down to a conversation continuing from there.
      const end = `${agentCol} .msg.assistant`
      await page.hover(end)
      await page.click(`${end} > .tools > .branch`)
      const downCol = col(before + 1)
      await page.waitForSelector(`${downCol} .composer`, { timeout: 15_000 })
      await page.inputValue(`${downCol} .composer .input`)
      await page.fill(`${downCol} .composer .input`, "")
      await send(before + 1, "off the record")
      await shows("off the record", downCol)
      // The agent thread goes on through its lane; the newer conversation at its
      // old end must not take its column, nor its reply.
      await send(before, "say exactly: DOWN-TWO")
      await page
        .waitForFunction(
          c => document.querySelectorAll(`${c} .msg.assistant`).length === 2,
          agentCol,
          { timeout: 60_000 },
        )
        .catch(() => null)
      await idle()
      await texts(before)
      await texts(before + 1)
      // A branch from a conversation opens with nothing typed. The message's
      // markdown draws as other text, for copy below.
      await send(before + 1, STILL_SOURCE)
      await page.waitForSelector(stillMsg(downCol), { timeout: 60_000 })
      await page.hover(`${downCol} ${msg("off the record")}`)
      await page.click(`${downCol} ${msg("off the record")} > .tools > .branch`)
      const asideCol = col(before + 2)
      await page.waitForSelector(`${asideCol} .composer`, { timeout: 15_000 })
      await page.inputValue(`${asideCol} .composer .input`)
      await page.click(`${asideCol} .close`)
      const asideClosed = await page
        .waitForFunction(
          () => document.querySelectorAll(".column").length === 2,
          undefined,
          { timeout: 15_000 },
        )
        .then(
          () => true,
          () => false,
        )
      check("× on a branch's column takes it off the canvas", asideClosed)
      // ＋ past the last column: its ▾'s conversation makes a column at the
      // canvas's end, a new root's thread in this task, ready to type in.
      await page.focus("#strip > .canvas-end .add-menu")
      await page.keyboard.press("ArrowDown")
      await page
        .waitForFunction(
          () => document.activeElement?.classList.contains("add-conversation"),
          undefined,
          { timeout: 5_000 },
        )
        .catch(() => null)
      await page.keyboard.press("Enter")
      const madeCol = col(before + 2)
      await page.waitForSelector(`${madeCol} .composer`, { timeout: 15_000 })
      const made = (await page.getAttribute(madeCol, "data-card")) ?? ""
      const agentCard = (await page.getAttribute(agentCol, "data-card")) ?? ""
      await waitFor(
        () => readPlaces(host.places).some(c => c.id === made),
        5_000,
      )
      const agentPlace = readPlaces(host.places).find(
        c => c.id === agentCard,
      )?.place
      const madeLast =
        agentPlace?.kind === "canvas" &&
        canvasOf(readPlaces(host.places), agentPlace.task).at(-1)?.id === made
      const recordOf = (card: string) =>
        [...readThreads(host.session).values()].find(r => r.thread === card)
      const madeRecord = recordOf(made)
      const agentRecord = recordOf(agentCard)
      const madeLabel = await label(before + 2)
      const madeCaret = await caretIn(before + 2)
      check(
        "＋ past the last column makes a conversation at the canvas's end: a new root's thread in this task, its box focused",
        madeLast &&
          madeRecord?.origin.kind === "root" &&
          agentRecord !== undefined &&
          madeRecord.root !== agentRecord.root &&
          madeLabel === TO_NOBODY &&
          madeCaret === 0,
        `last ${madeLast}; ${JSON.stringify(madeRecord?.origin)}; "${madeLabel}", caret ${madeCaret}`,
      )
      // Taken off again: what follows counts the two columns it made.
      await page.click(`${madeCol} .close`)
      await page
        .waitForFunction(
          () => document.querySelectorAll(".column").length === 2,
          undefined,
          { timeout: 15_000 },
        )
        .catch(() => null)

      // ── a message's tools: one row; edit is a sibling; a first message's new tab.
      // A person's message in agent work has all three tools.
      const person = `${agentCol} ${msg("say exactly: DOWN-TWO")}`
      await page.hover(person)
      const row = await page.$$eval(`${person} > .tools > button`, bs =>
        bs.map(b => ({
          name: b.className,
          top: Math.round(b.getBoundingClientRect().top * 10) / 10,
        })),
      )
      const tops = row.map(b => b.top)
      check(
        "a message's tools are one row: copy, comment, edit, →",
        row.map(b => b.name).join(" ") === "copy comment edit branch" &&
          Math.max(...tops) - Math.min(...tops) <= 1,
        `${JSON.stringify(row)}`,
      )
      // ── a comment: a note in the message's margin, which opens
      // under it with its box focused; shut, the message shows its count.
      await page.click(`${person} > .tools > .comment`)
      const commentBox = `${agentCol} .margin textarea`
      await page
        .waitForSelector(`${commentBox}:focus`, { timeout: 10_000 })
        .catch(() => null)
      await page.keyboard.type("a comment on this")
      const commented = await waitFor(
        () =>
          readPlaces(host.places).some(
            c =>
              c.place.kind === "margin" &&
              c.kind === "text" &&
              host.cardText(c.id) === "a comment on this",
          ),
        10_000,
      )
      await page.click(`${agentCol} .margin .shut-margin`)
      const counted = await page
        .waitForSelector(`${agentCol} .margin-face:text-is("💬 1")`, {
          timeout: 10_000,
        })
        .then(
          () => true,
          () => false,
        )
      check(
        "a comment is a note in its message's margin, written where it opens; shut, the message shows how many it holds",
        commented >= 0 && counted,
        `written ${commented} ms; count shown ${counted}`,
      )
      // Copy puts the message's markdown on the clipboard, not what it draws.
      const still = stillMsg(downCol)
      await page.hover(still)
      await page.click(`${still} > .tools > .copy`)
      const copied = await page
        .waitForFunction(
          async () => (await navigator.clipboard.readText()) !== "",
          undefined,
          { timeout: 5_000 },
        )
        .then(
          () => page.evaluate(() => navigator.clipboard.readText()),
          () => "",
        )
      const copiedTitle = await page.getAttribute(
        `${still} > .tools > .copy`,
        "title",
      )
      check(
        "copy puts a message's markdown on the clipboard",
        copied === STILL_SOURCE && copiedTitle === COPIED,
        `"${copied}", "${copiedTitle}"`,
      )
      // Without a clipboard, as over plain http, copy selects the drawn text for
      // you to copy (hiding it stands in for an insecure context).
      await page.evaluate(() => {
        getSelection()?.removeAllRanges()
        Object.defineProperty(navigator, "clipboard", {
          value: undefined,
          configurable: true,
        })
      })
      let selected = ""
      try {
        await page.click(`${still} > .tools > .copy`)
        selected = await page.evaluate(() => getSelection()?.toString() ?? "")
      } finally {
        await page.evaluate(() => {
          Reflect.deleteProperty(navigator, "clipboard")
          getSelection()?.removeAllRanges()
        })
      }
      check(
        "with no clipboard, copy selects the message's text",
        selected.trim() === STILL,
        `"${selected}"`,
      )
      // Cmd+C on a selection copies what you selected, as text, across
      // formatting or within plain text, and takes nothing into the
      // inventory, which stays closed.
      const copySelection = async (end: number | null) => {
        await page.evaluate(() => navigator.clipboard.writeText(""))
        await page.locator(`${still} > .text > p`).evaluate((p, end) => {
          const selection = getSelection()
          const text = p.firstChild
          if (selection === null || text === null) return
          if (end === null) selection.selectAllChildren(p)
          else selection.setBaseAndExtent(text, 0, text, end)
          document.execCommand("copy")
          selection.removeAllRanges()
        }, end)
        return page
          .waitForFunction(
            async () => (await navigator.clipboard.readText()) !== "",
            undefined,
            { timeout: 5_000 },
          )
          .then(
            () => page.evaluate(() => navigator.clipboard.readText()),
            () => "",
          )
      }
      const across = await copySelection(null)
      const plain = await copySelection("still".length)
      const references = readPlaces(host.places).filter(
        c => c.kind === "reference",
      ).length
      const shut = !(await page.locator(".inventory").isVisible())
      check(
        "Cmd+C on a selection in a message copies the text selected and takes nothing into the inventory",
        across.trim() === STILL &&
          plain === "still" &&
          references === 0 &&
          shut,
        `across "${across}", plain "${plain}", ${references} references, inventory shut ${shut}`,
      )
      // Pasted on the thread's column, it lands in the thread's notes as a
      // text card holding it, keeping the range it came from. With no note
      // column on the task yet, one is made for it, beside the columns.
      const columnsBeforePaste = await page.locator(".column").count()
      await page.click(`${still} > .text`, { position: { x: 2, y: 2 } })
      await page.keyboard.press("ControlOrMeta+v")
      const pasted = await waitFor(
        () =>
          readPlaces(host.places).some(
            c =>
              c.kind === "text" &&
              c.place.kind === "note" &&
              c.content.origin?.kind === "range" &&
              host.cardText(c.id) === "still",
          ),
        10_000,
      )
      check(
        "a selection pasted on a thread's column lands in its notes as a text card holding it, keeping where it came from",
        pasted >= 0,
        `pasted in ${pasted} ms`,
      )
      // A paste is one step of your history: the undo key takes it back,
      // so no note of yours is left to mark the task.
      await page.keyboard.press("ControlOrMeta+z")
      await waitFor(
        () =>
          !readPlaces(host.places).some(
            c => c.kind === "text" && host.cardText(c.id) === "still",
          ),
        10_000,
      )
      // The column made for it goes with it: later checks count columns.
      await page
        .waitForFunction(
          n => document.querySelectorAll(".column").length === n,
          columnsBeforePaste,
          { timeout: 10_000 },
        )
        .catch(() => {})
      // A branch opens after the column you were last in: back to the
      // agent's, as before the paste.
      await page.click(`${person} > .text`, { position: { x: 2, y: 2 } })
      // Edit opens a branch at the message's parent, holding its text as sent,
      // with @agent in front: its thread's default person the agent, and a branch
      // asks only through a mention.
      const askedId = entryId(
        (await page.getAttribute(person, "data-entry")) ?? "",
      )
      // Past the context its run wrote above it: a canvas list.
      const parentId = promptParent(treeOf(host), askedId) ?? ""
      await page.hover(person)
      await page.click(`${person} > .tools > .edit`)
      const editCol = col(before + 1)
      await page.waitForSelector(`${editCol} .composer`, { timeout: 15_000 })
      // Its text is filled in a moment after the composer is drawn.
      await page
        .waitForFunction(
          sel =>
            (document.querySelector<HTMLTextAreaElement>(sel)?.value ?? "") !==
            "",
          `${editCol} .composer .input`,
          { timeout: 10_000 },
        )
        .catch(() => {})
      const editStart = await page.inputValue(`${editCol} .composer .input`)
      const editTrack = await page.getAttribute(editCol, "data-track")
      const forkOnParent = await page
        .locator(
          `${agentCol} .msg[data-entry="${parentId}"] .fork-dot[data-track="${editTrack}"]`,
        )
        .count()
      // Sent without @agent, it is a plain message: no run.
      await page.fill(`${editCol} .composer .input`, "say exactly: DOWN-2B")
      await page.click(`${editCol} .composer .send`)
      await shows("say exactly: DOWN-2B", editCol)
      const edited = [...treeOf(host).bySend.values()]
        .map(id => treeOf(host).entries[id])
        .find(e => e?.message?.content === "say exactly: DOWN-2B")
      check(
        "edit sends again beside the original: a branch at its parent, starting with its text",
        editStart === "@agent say exactly: DOWN-TWO" &&
          forkOnParent === 1 &&
          edited?.parentId === parentId &&
          (await texts(before)).includes("say exactly: DOWN-TWO"),
        `"${editStart}", its fork dot on the parent: ${forkOnParent}`,
      )
      await chooseFromMenu(page, `${editCol} .column-menu`, ".column-fold")
      await page.waitForFunction(
        () => document.querySelectorAll(".column").length === 2,
        undefined,
        { timeout: 15_000 },
      )
      // A task dragged over another in the sidebar only reorders. Held over
      // the other's middle past the hold that opens a task for a card's drag,
      // it shows no ring and opens nothing; released past that middle, it
      // lands on the other side. The other is never the task you are on, so
      // opening it would show. It is pressed off its centre, on the side away
      // from where it goes: the dragged row's own box follows the pointer,
      // and measured among the places it would shift its landing by one.
      {
        const order = await page.$$eval("#sidebar .open-root", ts =>
          ts.map(t => t.getAttribute("data-task") ?? ""),
        )
        const current = () =>
          page
            .$eval('#sidebar .open-root[aria-current="true"]', n =>
              n.getAttribute("data-task"),
            )
            .catch(() => null)
        const here = await current()
        // From the first to below the second, or from the second to above
        // the first: either way the first two swap.
        const down = here === order[0]
        const rows = page.locator("#sidebar .open-root")
        const from = await rows.nth(down ? 0 : 1).boundingBox()
        const over = await rows.nth(down ? 1 : 0).boundingBox()
        let ringed = true
        let stayed = false
        if (from !== null && over !== null) {
          const x = over.x + over.width / 3
          await page.mouse.move(
            from.x + from.width / 3,
            from.y + from.height * (down ? 0.2 : 0.8),
          )
          await page.mouse.down()
          await page.mouse.move(x, over.y + over.height / 2, { steps: 8 })
          // A hold that will open anything rings its target in the same move,
          // and only the ring's timer opens it: no ring now, nothing opens
          // later. That a task's drag opens nothing is `drawPlan`'s, proven
          // by its unit test.
          await twoFrames(page)
          ringed = (await page.$("[data-hover-open]")) !== null
          stayed = (await current()) === here
          await page.mouse.move(
            x,
            down ? over.y + over.height - 2 : over.y + 2,
            { steps: 4 },
          )
          await page.mouse.up()
        }
        const swapped = [order[1], order[0], ...order.slice(2)].join()
        const after = await page
          .waitForFunction(
            o =>
              [...document.querySelectorAll("#sidebar .open-root")]
                .map(n => n.getAttribute("data-task"))
                .join() === o,
            swapped,
            { timeout: 10_000 },
          )
          .then(
            () => true,
            () => false,
          )
        check(
          "a task dragged over another's middle in the sidebar opens nothing, and drops above or below it",
          order.length >= 2 && !ringed && stayed && after,
          `ringed ${ringed}, stayed ${stayed}, swapped ${after}`,
        )
      }
      // The sidebar is your own document: another device of yours,
      // a browser context of its own, has it, in your order. A reload reads
      // it the same way.
      {
        const listOf = (p: Page) =>
          p.$$eval("#sidebar .open-root", ts =>
            ts.map(t => t.getAttribute("data-task") ?? ""),
          )
        const mine = await listOf(page)
        const device = await browser.newPage()
        let theirs: string[] = []
        try {
          await asPerson(device, "ada@browser.test", await shownName(page))
          await device.goto(host.httpUrl, { waitUntil: "domcontentloaded" })
          await connected(device).catch(() => null)
          await device
            .waitForFunction(
              order =>
                [...document.querySelectorAll("#sidebar .open-root")]
                  .map(n => n.getAttribute("data-task"))
                  .join() === order,
              mine.join(),
              { timeout: 15_000 },
            )
            .catch(() => null)
          theirs = await listOf(device)
        } finally {
          await device.close().catch(() => {})
        }
        check(
          "the sidebar is your own: another device of yours has it, in your order",
          mine.length >= 2 && theirs.join() === mine.join(),
          `${theirs.length} of ${mine.length}`,
        )
      }
      // A root's first message has no parent: its edit is a new tab, an agent's
      // since the message asked the agent.
      const first = `${agentCol} ${msg("say exactly: DOWN-ONE")}`
      await page.hover(first)
      await page.click(`${first} > .tools > .edit-new-tab`)
      // A new tab is a task of its own from the start.
      await page.waitForSelector(`${col(0)}[data-card] .composer`, {
        timeout: 15_000,
      })
      await page.click(`${col(0)} .close`)
      const agentRoot = treeOf(host).roots.at(-1) ?? ""
      await page.click(itemSel(taskOf(agentRoot)))
      await page.waitForFunction(
        () => document.querySelectorAll(".column").length === 2,
        undefined,
        { timeout: 15_000 },
      )

      // ── the sidebar, the board and the inbox ───────────
      const downRoot = treeOf(host).roots.at(-1) ?? ""
      const selectedRoot = (p: Page) =>
        p
          .$eval('#sidebar [aria-current="true"]', n =>
            n.getAttribute("data-task"),
          )
          .catch(() => null)
      const messagesIn = (root: string) =>
        projectRail(treeOf(host), entryId(root)).length
      // 1. Which tree a root's rail draws is `hereRail`'s, proven by its unit test.
      await page.click(itemSel(taskOf(firstRoot)))
      await page
        .waitForFunction(
          `(${RAIL_MESSAGES})() === ${messagesIn(firstRoot)}`,
          null,
          {
            timeout: 15_000,
          },
        )
        .catch(() => null)

      // 2. A root someone else starts is not added to the sidebar.
      const api = await join(host, "tabs", "browser")
      await api.request({ kind: "name", name: "Bea" })
      const third = await api.chat("a third thread", ROOT, { mode: "branch" })
      const thirdRoot = third.kind === "appended" ? third.id : entryId("")
      await countIsHosts(page)
      check(
        "a root another writer starts is not added to the sidebar, and the page stays where it is",
        thirdRoot !== "" &&
          (await page.locator(itemSel(taskOf(thirdRoot))).count()) === 0 &&
          (await selectedRoot(page)) === taskOf(firstRoot),
      )
      // Any root can be moved on the board: another item's ⋯ shows while it is hovered.
      const otherMenu = page.locator(
        `${itemSel(taskOf(downRoot))} ~ .open-more .open-menu`,
      )
      const hiddenAtRest = !(await otherMenu.isVisible())
      await page.hover(itemSel(taskOf(downRoot)))
      const shownOnHover = await otherMenu.isVisible()
      await page.mouse.move(0, 0)
      check(
        "another root in the sidebar shows its ⋯ on hover, and not at rest",
        hiddenAtRest && shownOnHover,
        `${hiddenAtRest}, ${shownOnHover}`,
      )

      // Renders. Your typing writes only presence once your card
      // exists, and `App` reads none, so it redraws nothing outside the
      // composer. Typed for over a second: `typing` is written at most once a
      // second. A render is named by the function that rendered: a message's is
      // `MessageView`, the function `memo` wraps, and a list's
      // `MessageListView`, so a count of `Message` would be 0 whatever renders.
      await page.click(`${col(0)} .composer .input`)
      await page.keyboard.type("t")
      await waitForQuiet(page)
      await page.keyboard.type("yped while only presence changes", {
        delay: 80,
      })
      const typed = await componentRenders(page)
      // The host has your `typing`: the write the check is about happened.
      const typedHere = readTyping(host.presence).some(([w]) => w === ME)
      const rendersOf = (name: string) => typed.filter(r => r.name === name)
      const outside = [
        "Footer",
        "Sidebar",
        "Column",
        "MessageListView",
        "MessageView",
      ]
        .map(name => [name, rendersOf(name).length] as const)
        .filter(([, n]) => n > 0)
      check(
        "your typing redraws nothing outside your composer",
        outside.length === 0 && typedHere,
        `${JSON.stringify(outside)}, typing written ${typedHere}`,
      )
      await page.fill(`${col(0)} .composer .input`, "")
      // Someone else following this thread changes only `reading`: the column's
      // header shows them, and no column redraws.
      const onPath = await page.$$eval(`${col(0)} .msg[data-entry]`, ms =>
        ms.at(-1)?.getAttribute("data-entry"),
      )
      await componentRenders(page)
      if (onPath != null) api.setReading("presence-check", onPath, null)
      const beaHere = `${col(0)} .column-head .avatar[data-writer="${api.writer}"]`
      const beaShown = await page
        .waitForSelector(beaHere, { timeout: 15_000 })
        .then(
          () => true,
          () => false,
        )
      const readRenders = await componentRenders(page)
      const readColumns = readRenders.filter(r =>
        ["Column", "Footer", "Sidebar"].includes(r.name),
      )
      check(
        "another person following this thread shows in its header and redraws no column",
        beaShown && readColumns.length === 0,
        `${readColumns.map(r => r.name).join(", ")}`,
      )
      api.clearReading("presence-check")
      await page
        .waitForSelector(beaHere, { state: "detached", timeout: 15_000 })
        .catch(() => null)
      // A message in a thread this tab does not show redraws none of its
      // messages. It is in a root of the sidebar, which this tab holds, so the
      // tree changes and every column's list draws again: only the messages'
      // own memo keeps them.
      await componentRenders(page)
      await api.chat("meanwhile, elsewhere", atEntry(entryId(downRoot)), {
        mode: "branch",
      })
      await countIsHosts(page)
      await waitFor(() => false, 500)
      const elsewhere = (await componentRenders(page)).filter(
        r => r.name === "MessageView",
      )
      check(
        "a message in another thread redraws none of this tab's messages",
        elsewhere.length === 0,
        `${elsewhere.length}`,
      )

      // 3. Closing a root is yours: × writes nothing shared, and reopening brings its columns back.
      await page.click(itemSel(taskOf(downRoot)))
      await page.waitForFunction(
        () => document.querySelectorAll(".column").length >= 2,
        undefined,
        { timeout: 15_000 },
      )
      const downKeys = await page.$$eval(".column", cs =>
        cs.map(c => c.getAttribute("data-key") ?? ""),
      )
      // × closes the root for you and writes nothing shared (`planIntent`'s unit test).
      // × shows while its item is hovered or focused.
      await page.hover(itemSel(taskOf(downRoot)))
      await page.click(`${itemSel(taskOf(downRoot))} ~ .open-close`)
      await page
        .waitForFunction(
          r =>
            document.querySelector(`#sidebar .open-root[data-task="${r}"]`) ===
            null,
          taskOf(downRoot),
          { timeout: 15_000 },
        )
        .catch(() => null)
      await openFromBoard(page, taskOf(downRoot))
      await page
        .waitForFunction(
          n => document.querySelectorAll(".column").length === n,
          downKeys.length,
          { timeout: 15_000 },
        )
        .catch(() => null)
      await page.$$eval(".column", cs =>
        cs.map(c => c.getAttribute("data-key") ?? ""),
      )
      await page.click(itemSel(taskOf(firstRoot)))

      // 4. Another window, another person: the board shows them on the root
      // they read, never yourself, and takes you to them.
      const myWriter = ME
      const tb = await browser.newPage()
      await asPerson(tb, "tabs-b@browser.test", "Tabby")
      try {
        await tb.goto(host.httpUrl, { waitUntil: "domcontentloaded" })
        const knownHere = await connected(tb).then(
          () => true,
          () => false,
        )
        check(
          "a browser that knows who you are connects without asking",
          knownHere && (await tb.locator("#identity").count()) === 0,
        )
        // A window with nothing in its list opens on the board.
        await tb.waitForSelector("#board", { timeout: 20_000 }).then(
          () => true,
          () => false,
        )
        await openFromBoard(tb, taskOf(thirdRoot))
        await openBoard(page)
        const reader = `#board ${boardSel(taskOf(thirdRoot))} .reader-trigger`
        const avatar = await page
          .waitForSelector(reader, { timeout: 15_000 })
          .then(
            () => true,
            () => false,
          )
        check(
          "another window shows on its root's thread card, and you never do",
          avatar &&
            (await page
              .locator(
                `#board .avatar[data-writer="${myWriter}"], #bottom .avatar[data-writer="${myWriter}"]`,
              )
              .count()) === 0,
        )
        const toThem = await chooseFromMenu(page, reader, ".here-thread")
        const followed = await page
          .waitForSelector(
            `${itemSel(taskOf(thirdRoot))}[aria-current="true"]`,
            {
              timeout: 15_000,
            },
          )
          .then(
            () => true,
            () => false,
          )
        check(
          "choosing a reader's thread on a thread card opens it in the sidebar",
          toThem && followed && (await shows("a third thread")),
        )
        const onThird = await page
          .waitForSelector(`${itemSel(taskOf(thirdRoot))} .avatar`, {
            timeout: 15_000,
          })
          .then(
            () => true,
            () => false,
          )
        // A reader's menu, open as they leave the root, stays and says so:
        // only you close it, by Escape though the row that held focus has
        // gone, and then their avatar leaves the item. The board stays.
        await openBoard(page)
        const tabby = `#board ${boardSel(taskOf(thirdRoot))} .reader-trigger`
        const heldOpen = await page
          .click(tabby, { timeout: 15_000 })
          .then(() =>
            page.waitForSelector("#board .reader.open .here-thread", {
              timeout: 15_000,
            }),
          )
          .then(
            () => true,
            () => false,
          )
        await openFromBoard(tb, taskOf(firstRoot))
        const saysLeft = await page
          .waitForFunction(
            text =>
              [
                ...document.querySelectorAll("#board .reader .menu-heading"),
              ].some(h => h.textContent === text),
            readerHeading("Tabby", true),
            { timeout: 15_000 },
          )
          .then(
            () => true,
            () => false,
          )
        await page.keyboard.press("Escape")
        const avatarLeft = await page
          .waitForFunction(
            sel =>
              document.querySelector("#board") !== null &&
              document.querySelector(sel) === null,
            tabby,
            { timeout: 15_000 },
          )
          .then(
            () => true,
            () => false,
          )
        check(
          "a reader's menu open when they leave stays open and says so, and their avatar leaves once you close it",
          heldOpen && saysLeft && avatarLeft,
          `opened ${heldOpen}, stayed ${saysLeft}, left ${avatarLeft}`,
        )
        if ((await page.$("#board")) !== null)
          await page.click("#bottom .board-toggle")
        const moved = await page
          .waitForFunction(
            ([from, to]) =>
              document.querySelector(
                `#sidebar .open-root[data-task="${from}"] .avatar`,
              ) === null &&
              document.querySelector(
                `#sidebar .open-root[data-task="${to}"] .avatar`,
              ) !== null,
            [taskOf(thirdRoot), taskOf(firstRoot)] as const,
            { timeout: 15_000 },
          )
          .then(
            () => true,
            () => false,
          )
        check(
          "another window shows on the root it is on in the sidebar, and leaves it when it switches",
          onThird && moved,
        )

        // 4b. Rename: a title is the root's label for everyone, the
        // board shows it, Escape keeps the old one, and clearing it brings
        // back the first line. The page is on the third root.
        const tabLabel = (p: Page, r: string) =>
          p.textContent(`${itemSel(taskOf(r))} .open-label`).catch(() => null)
        const labelIs = (p: Page, r: string, want: string) =>
          p
            .waitForFunction(
              ([sel, text]) =>
                document.querySelector(sel)?.textContent === text,
              [`${itemSel(taskOf(r))} .open-label`, want] as const,
              { timeout: 15_000 },
            )
            .then(
              () => true,
              () => false,
            )
        const rename = async (text: string, key: "Enter" | "Escape") => {
          const chosen = await chooseFromMenu(page, OWN_MENU, ".rename-root")
          if (!chosen) return false
          await page.waitForSelector(".open-title-input", { timeout: 15_000 })
          await page.fill(".open-title-input", text)
          await page.press(".open-title-input", key)
          return chosen
        }
        const TITLE = "Palette of tabs"
        const firstLine = await tabLabel(page, thirdRoot)
        const renamed = await rename(TITLE, "Enter")
        const mine = await labelIs(page, thirdRoot, TITLE)
        const refocused = await page.evaluate(
          r => document.activeElement?.getAttribute("data-task") === r,
          taskOf(thirdRoot),
        )
        const theirs = await labelIs(tb, thirdRoot, TITLE)
        check(
          "Rename in a root's ⋯ titles it, for everyone, and gives its item focus back",
          renamed && mine && theirs && refocused,
          `"${firstLine}" → "${await tabLabel(tb, thirdRoot)}"`,
        )
        await openBoard(tb)
        await tb
          .waitForFunction(
            ([sel, text]) => document.querySelector(sel)?.textContent === text,
            [
              `#board ${boardSel(taskOf(thirdRoot))} .board-label`,
              TITLE,
            ] as const,
            { timeout: 15_000 },
          )
          .catch(() => null)
        await tb.click(itemSel(taskOf(firstRoot)))
        const thirdTask = taskHolding(host, thirdRoot)
        const setAt = readMarks(host.session).get(thirdTask)?.at
        await rename("not this", "Escape")
        // Long enough for a rename sent by mistake to come back.
        await waitFor(() => false, 1_000)
        check(
          "Escape leaves a root's title as it was, and sends nothing",
          (await labelIs(page, thirdRoot, TITLE)) &&
            (await page.locator(".open-title-input").count()) === 0 &&
            readMarks(host.session).get(thirdTask)?.at === setAt,
        )
        await rename("", "Enter")

        // 4c. Auto-update title: the model's title arrives as the
        // label. The suites' scripted model answers every request outside a
        // thread with `SCRIPTED_DESCRIPTION`.
        const auto = titleOf(SCRIPTED_DESCRIPTION) ?? ""
        const retitled =
          (await chooseFromMenu(page, OWN_MENU, ".retitle-root")) &&
          (await labelIs(page, thirdRoot, auto))
        check(
          "Auto-update title in a root's ⋯ titles it from the model",
          retitled,
          `"${await tabLabel(page, thirdRoot)}"`,
        )
        await rename("", "Enter")

        // 4d. The board: a root dragged to another state moves
        // there for everyone, and the other window's board shows it.
        {
          const workflow = readWorkflow(host.session)
          const doing = workflow?.open[1]?.id ?? ""
          const column = `#board .board-column[data-state="${doing}"]`
          await openBoard(page)
          await openBoard(tb)
          await page
            .dragAndDrop(
              `#board ${boardSel(taskOf(firstRoot))} .board-open`,
              column,
            )
            .catch(() => null)
          const theirs = await tb
            .waitForSelector(`${column} ${boardSel(taskOf(firstRoot))}`, {
              timeout: 15_000,
            })
            .then(
              () => true,
              () => false,
            )
          const id = firstRoot === "" ? undefined : taskHolding(host, firstRoot)
          check(
            "dragging a thread card to another state moves it for the other window",
            theirs &&
              id !== undefined &&
              boardStateOf(readPlaces(host.places), id) === doing,
            `${theirs}`,
          )
          await page.click("#bottom .board-toggle")
          await tb.click("#bottom .board-toggle")
        }

        // 4e. The board's search: opened with ▦, its field in the
        // footer takes focus, and a filter shows a banner at the board's
        // foot without moving the field. A word no label holds hides every
        // root, so the board shrinks as far as it can. Clear lifts the
        // words and mine.
        {
          const field = "#bottom .board-search"
          await page.click("#bottom .board-toggle")
          await page.waitForSelector("#board", { timeout: 15_000 })
          const focused = await page
            .waitForFunction(
              sel => document.activeElement === document.querySelector(sel),
              field,
              { timeout: 5_000 },
            )
            .then(
              () => true,
              () => false,
            )
          const box = () =>
            page
              .$eval(field, n => {
                const r = n.getBoundingClientRect()
                return [r.x, r.y, r.width, r.height].map(Math.round).join()
              })
              .catch(() => "")
          const before = await box()
          await page.fill(field, "zzqx")
          const banner = await page
            .waitForSelector("#board .board-filter", { timeout: 5_000 })
            .then(
              () => true,
              () => false,
            )
          const after = await box()
          await page.check("#bottom .board-mine input").catch(() => null)
          await page.click("#board .board-filter-clear").catch(() => null)
          const cleared = await page
            .waitForSelector("#board .board-filter", {
              state: "detached",
              timeout: 5_000,
            })
            .then(
              () => true,
              () => false,
            )
          const mineOff = await page
            .isChecked("#bottom .board-mine input")
            .then(
              on => !on,
              () => false,
            )
          check(
            "▦ opens the board with its search focused in the footer, and a filter shows a banner without moving the field",
            focused && banner && cleared && before !== "" && before === after,
            `${before} → ${after}; focused ${focused}, banner ${banner}, cleared ${cleared}`,
          )
          check(
            "the banner's Clear lifts the filter's words and mine",
            cleared && mineOff,
            `cleared ${cleared}, mine off ${mineOff}`,
          )
          if ((await page.$("#board")) !== null)
            await page.click("#bottom .board-toggle")
        }

        // 5. ＋'s menu, by keyboard; an unsent new tab closes without a trace.

        await page.focus("#sidebar .add-menu")
        await page.keyboard.press("ArrowDown")
        const focused = await page
          .waitForFunction(
            () =>
              document.activeElement?.classList.contains("add-conversation"),
            undefined,
            { timeout: 5_000 },
          )
          .then(
            () => true,
            () => false,
          )
        const tasksBefore = readTasks(host.places).size
        await page.keyboard.press("Enter")
        await page.waitForSelector(`${col(0)}[data-card] .composer`, {
          timeout: 15_000,
        })
        const convo = await label(0)
        const opened = await waitFor(
          () => readTasks(host.places).size === tasksBefore + 1,
          5_000,
        )
        const tab = (await page.getAttribute(col(0), "data-card")) ?? ""
        check(
          "＋'s conversation, chosen by keyboard, opens a new tab that only sends",
          focused &&
            convo === TO_NOBODY &&
            opened >= 0 &&
            (await page.$('#sidebar .open-root[aria-current="true"]')) !==
              null &&
            readPlaces(host.places).find(c => c.id === tab)?.place.kind ===
              "canvas",
          `"${convo}", ${opened}`,
        )
        // Closed unsent, by ×, asking nothing: its task goes too.
        await page.fill(`${col(0)} .composer .input`, "never sent")
        await page.click(`${col(0)} .close`)
        const gone = await waitFor(
          () => readTasks(host.places).size === tasksBefore,
          10_000,
        )
        check(
          "an unsent new tab closed with × takes its task away, and its thread's card to the trash, asking nothing",
          gone >= 0 &&
            readPlaces(host.places).find(c => c.id === tab)?.place.kind ===
              "trash",
          `${gone}, ${readPlaces(host.places).find(c => c.id === tab)?.place.kind}`,
        )

        // 6. Mentions: the inbox badge counts what you have not seen, and
        // the inbox takes you there. With no lanes of their own here there are
        // no proposed changes, so the badge is the unseen mentions alone.
        const unseen = () =>
          page
            .$eval("#bottom .inbox-badge", n =>
              Number(n.getAttribute("data-needs-you")),
            )
            .catch(() => 0)
        // The page's handle, from its name as it is now (it was renamed above).
        const handle = `@${handleOf(await shownName(page))}`
        const before = await unseen()
        const mention = await api.chat(
          `${handle} a look at this?`,
          atEntry(entryId(downRoot)),
        )
        const mentionId = mention.kind === "appended" ? mention.id : ""
        const counted = await page
          .waitForFunction(
            n =>
              Number(
                document
                  .querySelector("#bottom .inbox-badge")
                  ?.getAttribute("data-needs-you") ?? 0,
              ) === n,
            before + 1,
            { timeout: 15_000 },
          )
          .then(
            () => true,
            () => false,
          )
        // The corner at 11.5rem: your name gives way, so it, your
        // inbox with a two-digit badge and your inventory sit side by side.
        const viewport = page.viewportSize()
        const wasFolded = (await page.$(':root[data-list="icons"]')) !== null
        await page.setViewportSize({
          width: 860,
          height: viewport?.height ?? 720,
        })
        // Folded by the small window (nobody here has chosen its width) or
        // by a choice, the sidebar shows icons; unfolding chooses full.
        const folds = await waitForListWidth(page, "icons")
        if (folds) await page.click("#sidebar .list-fold")
        const unfolded = folds && (await waitForListWidth(page, "full"))
        const corner = await page
          .evaluate(() => {
            const badge = document.querySelector(
              "#bottom .footer-tools .inbox-badge",
            )
            const said = badge?.textContent ?? null
            if (badge !== null) badge.textContent = "88"
            const box = (sel: string) =>
              document.querySelector(`#bottom ${sel}`)?.getBoundingClientRect()
            const you = box(".footer-you")
            const parts = [
              ".me-name",
              ".inbox-trigger",
              ".inventory-toggle",
            ].map(box)
            if (badge !== null) badge.textContent = said
            if (you === undefined || badge === null) return null
            const inside = parts.every(
              r =>
                r !== undefined && r.left >= you.left && r.right <= you.right,
            )
            const apart = parts.every(
              (r, i) =>
                i === 0 ||
                (r !== undefined &&
                  (parts[i - 1]?.right ?? Infinity) <= r.left),
            )
            return { inside, apart, width: you.width }
          })
          .catch(() => null)
        if (viewport !== null) await page.setViewportSize(viewport)
        // Full is now chosen, at any width; fold it back if it was folded.
        if (wasFolded) {
          await page.click("#sidebar .list-fold")
          await waitForListWidth(page, "icons")
        }
        check(
          "the corner holds you, your inbox and your inventory side by side at 11.5rem with a two-digit badge",
          unfolded &&
            corner?.inside === true &&
            corner.apart &&
            corner.width < 200,
          `unfolded ${unfolded}, ${JSON.stringify(corner)}`,
        )
        const picked = await chooseFromMenu(
          page,
          "#bottom .inbox-trigger",
          `.inbox-row[data-entry="${mentionId}"]`,
        )
        const drawn = await page
          .waitForSelector(`.column .msg[data-entry="${mentionId}"]`, {
            timeout: 15_000,
          })
          .then(
            () => true,
            () => false,
          )
        await page
          .waitForFunction(
            () => document.querySelector("#bottom .inbox-badge") === null,
            undefined,
            { timeout: 15_000 },
          )
          .catch(() => null)
        check(
          "a mention counts on the inbox badge, and choosing it opens its thread with the message drawn",
          counted && picked && drawn && (await unseen()) === 0,
          `${before} → ${before + 1} → ${await unseen()}`,
        )
        // A mention on screen is seen at once (`seenNow`, proven by its unit
        // test). The menu check below starts from this message.
        await api.chat(`${handle} and here`, atEntry(entryId(mentionId)))
        await shows(`${handle} and here`)
        // A menu stays open while an entry arrives: the column following its end
        // scrolls, and only a scroll that moves the trigger closes a popover.
        const hereId =
          (await page.$eval(msg(`${handle} and here`), n =>
            n.getAttribute("data-entry"),
          )) ?? ""
        await page.click("#bottom .inbox-trigger")
        await page.waitForSelector("#bottom .inbox .menu", {
          timeout: 15_000,
        })
        await page.evaluate(() => {
          const w = window as { columnScrolls?: number }
          w.columnScrolls = 0
          window.addEventListener(
            "scroll",
            e => {
              if (
                e.target instanceof Element &&
                e.target.matches(".column-body")
              )
                w.columnScrolls = (w.columnScrolls ?? 0) + 1
            },
            true,
          )
        })
        const arriving = "arriving while a menu is open"
        await api.chat(
          `${arriving}\n\n${"a paragraph to fill the column\n\n".repeat(12)}`,
          atEntry(entryId(hereId)),
        )
        await page.waitForSelector(
          `.msg:has-text(${JSON.stringify(arriving)})`,
          {
            timeout: 15_000,
          },
        )
        await waitFor(() => false, 500)
        const columnScrolls = await page.evaluate(
          () => (window as { columnScrolls?: number }).columnScrolls ?? 0,
        )
        check(
          "an open menu stays open while an entry arrives and its column scrolls to follow it",
          columnScrolls > 0 && (await page.$("#bottom .inbox .menu")) !== null,
          `${columnScrolls} scrolls`,
        )
        await page.keyboard.press("Escape")
        // Seen is kept per device: across a reload, and a mention made meanwhile counts.
        // The reload keeps the root you were on and its columns.
        await page.click(itemSel(taskOf(firstRoot)))
        const keysOf = () =>
          page.$$eval(".column", cs => cs.map(c => c.getAttribute("data-key")))
        const columnsBefore = await keysOf()
        const reloading = page.reload({ waitUntil: "domcontentloaded" })
        await api.chat(
          `${handle} while you were away`,
          atEntry(entryId(mentionId)),
        )
        await reloading
        const afterReload = await page
          .waitForFunction(
            () =>
              document
                .querySelector("#bottom .inbox-badge")
                ?.getAttribute("data-needs-you") === "1",
            undefined,
            { timeout: 20_000 },
          )
          .then(
            () => true,
            () => false,
          )
        check(
          "after a reload, what was seen stays seen, and a mention made meanwhile counts",
          afterReload,
        )
        const columnsBack = await page
          .waitForFunction(
            keys =>
              [...document.querySelectorAll(".column")]
                .map(c => c.getAttribute("data-key"))
                .join() === keys,
            columnsBefore.join(),
            { timeout: 15_000 },
          )
          .then(
            () => true,
            () => false,
          )
        check(
          "a reload keeps the root you were on, and its open columns, in order",
          columnsBefore.length >= 1 &&
            columnsBack &&
            (await selectedRoot(page)) === taskOf(firstRoot),
          `${(await keysOf()).length} of ${columnsBefore.length}`,
        )
        // Two tabs of one device share it: mark all seen in one clears the other.
        const sibling = await page.context().newPage()
        try {
          await sibling.goto(host.httpUrl, { waitUntil: "domcontentloaded" })
          // A second tab of the device is the same person, so its
          // mentions are the page's.
          await sibling.waitForSelector("#bottom .inbox-badge", {
            timeout: 20_000,
          })
          await chooseFromMenu(
            sibling,
            "#bottom .inbox-trigger",
            ".inbox-all-seen",
          )
          const cleared = await page
            .waitForFunction(
              () => document.querySelector("#bottom .inbox-badge") === null,
              undefined,
              { timeout: 15_000 },
            )
            .then(
              () => true,
              () => false,
            )
          check(
            "two tabs of one device share the inbox: mark all seen in one clears the other",
            cleared,
          )
        } finally {
          await sibling.close().catch(() => {})
        }

        // 7. Moved to Done, a root is archived and leaves every list: the
        // window that moved it closes it, and the page someone else is on
        // reads it.
        await page.click(itemSel(taskOf(thirdRoot)))
        await page.waitForSelector(`${col(0)} .composer .send`, {
          timeout: 15_000,
        })
        // tb opens the third root again, so it has an item there to lose, and
        // moves it to Done from there.
        await openFromBoard(tb, taskOf(thirdRoot))
        await page.fill(`${col(0)} .composer .input`, "typed, not sent")
        const menuSeen =
          (await seeInMenu(page, OWN_MENU, ".move-to.closes")) !== null
        await page.keyboard.press("Escape")
        check("a root's ⋯ in the sidebar opens a menu drawn in full", menuSeen)
        await chooseFromMenu(tb, OWN_MENU, ".move-to.closes")
        await page
          .waitForSelector(`${col(0)} .read-only`, { timeout: 15_000 })
          .catch(() => null)
        const banner =
          (await page
            .textContent(`${col(0)} .read-only-label`)
            .catch(() => "")) ?? ""
        const input = `${col(0)} .composer .input`
        const kept = await page.inputValue(input).catch(() => "")
        const frozen = await page
          .$eval(input, n => (n as HTMLTextAreaElement).readOnly)
          .catch(() => false)
        await page.hover(`${col(0)} .msg`)
        // Copy only reads, so it stays.
        const tools = await page
          .locator(`${col(0)} .msg .tools button:not(.copy)`)
          .count()
        const copyStays = await page
          .locator(`${col(0)} .msg`)
          .first()
          .locator(":scope > .tools > .copy")
          .count()
        const leftTb = await tb
          .waitForFunction(
            r =>
              document.querySelector(
                `#sidebar .open-root[data-task="${r}"]`,
              ) === null,
            taskOf(thirdRoot),
            { timeout: 15_000 },
          )
          .then(
            () => true,
            () => false,
          )
        check(
          "moving a root to Done closes it for the window that moved it, and the page someone else is on reads it",
          banner.startsWith("archived by Tabby") &&
            kept === "typed, not sent" &&
            frozen &&
            tools === 0 &&
            copyStays === 1 &&
            leftTb,
          `"${banner}", its typed text kept, no tools that write, and copy (${tools}, ${copyStays})`,
        )
        check(
          "an archived task's canvas offers no ＋ to make a column",
          (await page.$("#strip .column")) !== null &&
            (await page.$("#strip > .canvas-end")) === null,
        )
        await page.click(`${col(0)} .read-only-action`)
        await page
          .waitForSelector(`${col(0)} .composer .send`, { timeout: 15_000 })
          .catch(() => null)
        await waitFor(() => false, 1_000)
        check(
          "restoring it in place brings back the composer with its text, and adds it to no other window's list",
          (await page.inputValue(input)) === "typed, not sent" &&
            (await tb.locator(itemSel(taskOf(thirdRoot))).count()) === 0,
        )

        // Moved to Done again, here, it leaves the sidebar; the board brings it back.
        await page.fill(input, "")
        await chooseFromMenu(page, OWN_MENU, ".move-to.closes")
        await page
          .waitForFunction(
            r =>
              document.querySelector(
                `#sidebar .open-root[data-task="${r}"]`,
              ) === null,
            taskOf(thirdRoot),
            { timeout: 15_000 },
          )
          .then(
            () => true,
            () => false,
          )
        await openBoard(page)
        await page.waitForSelector(
          `#board .board-archive ${boardSel(taskOf(thirdRoot))}`,
          { timeout: 15_000 },
        )
        await openFromBoard(page, taskOf(thirdRoot))
        await page.waitForSelector(`${col(0)} .msg`, { timeout: 15_000 })
        await page.hover(`${col(0)} .msg`)
        const openedWrites = await page
          .locator(
            `${col(0)} .composer .send, ${col(0)} .msg .tools button:not(.copy)`,
          )
          .count()
        const openedCopy = await page
          .locator(`${col(0)} .msg`)
          .first()
          .locator(":scope > .tools > .copy")
          .count()
        check(
          "an archived root opened from the board draws its rail and column, with nothing that writes, and copy",
          openedWrites === 0 &&
            openedCopy === 1 &&
            (await page.locator(".rail .rail-dot").count()) >= 1,
          `${openedWrites}, ${openedCopy}`,
        )
        await page.click(`${col(0)} .read-only-action`)
        const restored = await page
          .waitForSelector(`${col(0)} .composer .send`, { timeout: 15_000 })
          .then(
            () => true,
            () => false,
          )
        await waitFor(() => false, 1_000)
        check(
          "Restore on an archived root you opened keeps it in the sidebar, and not in the other window's",
          restored &&
            (await page.locator(itemSel(taskOf(thirdRoot))).count()) === 1 &&
            (await tb.locator(itemSel(taskOf(thirdRoot))).count()) === 0,
        )
        // The other window, on nothing, reports no thread: it leaves nothing
        // behind, once its deletions have reached this page.
        await tb.$$eval("#sidebar .open-close", bs => {
          for (const b of bs) (b as HTMLButtonElement).click()
        })
        await page
          .waitForFunction(
            () =>
              document.querySelector(".avatar") === null &&
              document.querySelector(".rail-dot[data-here]") === null,
            undefined,
            { timeout: 15_000 },
          )
          .catch(() => null)
      } finally {
        await tb.close().catch(() => {})
      }

      // Not you: the profile shows the email this device gave, and signing in as
      // someone else forgets it and asks again. A device of its own, filling the
      // form itself: `asPerson` would store the identity again on the reload.
      const nv = await browser.newPage()
      try {
        await nv.goto(host.httpUrl, { waitUntil: "domcontentloaded" })
        await nv.waitForSelector("#identity", { timeout: 20_000 })
        await nv.fill('#identity input[name="email"]', "nobody@browser.test")
        await nv.fill('#identity input[name="name"]', "Nobody")
        await nv.click('#identity button[type="submit"]')
        // The menu's lead shows the email this device gave, above the item.
        const notYou = await seeInMenu(nv, "#bottom .me-trigger", ".not-you")
        const nvEmail = await nv
          .textContent(".account .profile-email")
          .catch(() => null)
        const nvSeen = notYou !== null
        await notYou?.click()
        const askedAgain = await nv
          .waitForSelector("#identity", { timeout: 20_000 })
          .then(
            () => true,
            () => false,
          )
        check(
          "Not you? asks who you are again",
          nvSeen && nvEmail === "nobody@browser.test" && askedAgain,
          `${nvEmail}`,
        )
      } finally {
        await nv.close().catch(() => {})
      }

      // ── a branch shown again after a return to its tab ──────────────────────
      // Every column of a tab shown again mounts at the top. A branch from far
      // down a long column must be aligned against where its parent ends up, not
      // where it mounted. A person of their own, so `page`'s tabs are untouched.
      {
        const writer = await join(host, "long", "browser")
        const lp = await browser.newPage()
        await asPerson(lp, "lee@browser.test", "Lee")
        try {
          const ids: string[] = []
          for (let n = 0; n < 30; n++) {
            const at = ids.at(-1)
            const r = await writer.chat(
              `Message ${n} of a long thread.\nIts second line.\nIts third line.`,
              at === undefined ? ROOT : atEntry(entryId(at)),
              at === undefined ? { mode: "branch" } : {},
            )
            if (r.kind === "appended") ids.push(r.id)
          }
          const longRoot = ids[0] ?? ""
          const forkId = ids.at(-2) ?? ""
          await lp.goto(host.httpUrl, { waitUntil: "domcontentloaded" })
          await openFromBoard(lp, taskOf(longRoot))
          await lp.waitForSelector(
            `${col(0)} .msg[data-entry="${ids.at(-1)}"]`,
            {
              timeout: 15_000,
            },
          )
          // Below its last message, so the branch does not move column 0 on.
          const fork = `${col(0)} .msg[data-entry="${forkId}"]`
          const aside = await writer.chat(
            "a late aside",
            atEntry(entryId(forkId)),
            { mode: "branch" },
          )
          await lp.waitForSelector(`${fork} .open-branch`, { timeout: 15_000 })
          await lp.click(`${fork} .open-branch`)
          await lp.waitForSelector(`${col(1)} .msg`, { timeout: 15_000 })
          await stepAway(lp)
          await stepBack(lp, taskOf(longRoot))
          await lp.waitForSelector(`${col(1)} .msg`, { timeout: 15_000 })
          await twoFrames(lp)
          const returned = await lp.evaluate(
            ([parent, branch, forkSel]) => {
              const pBody = document.querySelector(`${parent} .column-body`)
              const bBody = document.querySelector(`${branch} .column-body`)
              const forkMsg = document.querySelector(forkSel)
              const first = document.querySelector(`${branch} .msg`)
              const spacer = document.querySelector(`${branch} .spacer`)
              if (
                !(pBody instanceof HTMLElement) ||
                !(bBody instanceof HTMLElement) ||
                !(forkMsg instanceof HTMLElement) ||
                first === null ||
                spacer === null
              )
                return null
              const shown = bBody.getBoundingClientRect()
              const at = first.getBoundingClientRect().top
              return {
                depth: forkMsg.offsetTop - pBody.offsetTop,
                screen: pBody.clientHeight,
                drift: Math.abs(at - forkMsg.getBoundingClientRect().top),
                inView: at >= shown.top && at < shown.bottom,
                spacer: spacer.getBoundingClientRect().height,
                height: bBody.clientHeight,
              }
            },
            [col(0), col(1), fork] as const,
          )
          check(
            "a fork far down a long column lies below its first screenful",
            ids.length === 30 &&
              aside.kind === "appended" &&
              returned !== null &&
              returned.depth > returned.screen,
            `${returned?.depth ?? "?"}px down, ${returned?.screen ?? "?"}px shown`,
          )
          check(
            "a branch column is level with its fork point after a return to its root",
            returned !== null &&
              returned.drift <= 4 &&
              returned.inView &&
              returned.spacer < returned.height,
            `off by ${returned?.drift.toFixed(1) ?? "?"}px, in view ${returned?.inView ?? "?"}, spacer ${Math.round(returned?.spacer ?? -1)}px of ${returned?.height ?? "?"}px`,
          )
          // ↓ new below, across a switch: column 1 is unmounted while a new
          // tab shows, and its thread grows meanwhile. Shown again, it is
          // placed level with its fork, short of its new end. Which of the two
          // paths column 1 shows is read from the page: column 0 opened at the
          // root, and follows its newest leaf.
          {
            const jump = `${col(1)} .jump-latest`
            const before = await lp.locator(jump).count()
            // Its thread goes on below its own last message.
            const tip = await lp
              .locator(`${col(1)} .msg[data-entry]`)
              .last()
              .getAttribute("data-entry")
            await stepAway(lp)
            let at = tip ?? forkId
            const kinds: string[] = []
            for (let n = 0; n < 10; n++) {
              const r = await writer.chat(
                `Branch message ${n}.\nIts second line.\nIts third line.`,
                atEntry(entryId(at)),
              )
              kinds.push(r.kind)
              if (r.kind === "appended") at = r.id
            }
            await stepBack(lp, taskOf(longRoot))
            const arrived = await lp
              .waitForSelector(`${col(1)} .msg[data-entry="${at}"]`, {
                timeout: 15_000,
              })
              .then(
                () => true,
                () => false,
              )
            const offered = await lp
              .waitForSelector(jump, { timeout: 5_000 })
              .then(
                () => true,
                () => false,
              )
            if (offered) await lp.click(jump)
            await twoFrames(lp)
            const gap = await lp.$eval(
              `${col(1)} .column-body`,
              b => b.scrollHeight - b.scrollTop - b.clientHeight,
            )
            const where = await lp.evaluate(
              id =>
                [...document.querySelectorAll(".column")].map(
                  c =>
                    `${c.getAttribute("data-position")}:${c.querySelectorAll(".msg").length}:${c.querySelector(`.msg[data-entry="${id}"]`) !== null}`,
                ),
              at,
            )
            check(
              "↓ new below shows on a column that moved on while its tab was hidden, and none before",
              before === 0 && arrived && offered && gap <= 2,
              `${before} before, arrived ${arrived}, offered ${offered}, gap after ${Math.round(gap)}px; ${kinds.join(",")}; ${where.join(" ")}`,
            )
          }
          // Where a column was left, and the rail's outline of what it shows.
          // Column 0 is long: 30 messages and more.
          {
            const body0 = `${col(0)} .column-body`
            const key0 = (await lp.getAttribute(col(0), "data-key")) ?? ""
            const tip0 =
              (await lp
                .locator(`${col(0)} .msg[data-entry]`)
                .last()
                .getAttribute("data-entry")) ?? ""
            const scrollTo = (to: "top" | "end" | "middle") =>
              lp.$eval(
                body0,
                (b, at) => {
                  const end = b.scrollHeight - b.clientHeight
                  b.scrollTop = at === "top" ? 0 : at === "end" ? end : end / 2
                },
                to,
              )
            // Whether an outline of column 0 is around a dot's centre: one per
            // track its view is on.
            const around = (entry: string) =>
              lp.evaluate(
                ([key, id]) => {
                  const d = document.querySelector(
                    `.rail-dot[data-entry="${id}"]`,
                  )
                  if (d === null) return false
                  const b = d.getBoundingClientRect()
                  const y = b.top + b.height / 2
                  const x = b.left + b.width / 2
                  return [
                    ...document.querySelectorAll(
                      `.rail-view[data-key="${key}"]`,
                    ),
                  ].some(o => {
                    const a = o.getBoundingClientRect()
                    return (
                      a.top <= y && y <= a.bottom && a.left <= x && x <= a.right
                    )
                  })
                },
                [key0, entry] as const,
              )
            await scrollTo("top")
            await twoFrames(lp)
            const atTop = [await around(ids[0] ?? ""), await around(tip0)]
            await scrollTo("end")
            await twoFrames(lp)
            const atEnd = [await around(ids[0] ?? ""), await around(tip0)]
            check(
              "the rail outlines what a column shows: its first message at its top, its end at its end",
              atTop[0] === true &&
                atTop[1] === false &&
                atEnd[0] === false &&
                atEnd[1] === true,
              `at the top: first ${atTop[0]}, end ${atTop[1]}; at the end: first ${atEnd[0]}, end ${atEnd[1]}`,
            )

            // The rail, shorter than column 0's path, keeps the column's view
            // in view. Column 0 ends on the late aside, one row under the
            // fork, beside the trunk's continuation: its path is
            // about 100 px of the rail, its view at its end about 40 px, from
            // inside the trunk's capsule. The rail is taller than that and
            // its margins.
            const short = await lp.addStyleTag({
              content: ".rail { max-height: 80px }",
            })
            // Where the rail is, and whether the dots at the column's start
            // and its end are in the rail's view: the outline wraps whole
            // capsules, taller than the view, so the dots say where it is.
            const railAt = () =>
              lp.evaluate(
                ([start, end]) => {
                  const rail = document.querySelector(".rail")
                  if (rail === null) return null
                  const r = rail.getBoundingClientRect()
                  const seen = (id: string) => {
                    const d = document.querySelector(
                      `.rail-dot[data-entry="${id}"]`,
                    )
                    if (d === null) return false
                    const b = d.getBoundingClientRect()
                    return b.top >= r.top && b.bottom <= r.bottom
                  }
                  return {
                    scrollTop: rail.scrollTop,
                    scrolls: rail.scrollHeight > rail.clientHeight,
                    start: seen(start),
                    end: seen(end),
                  }
                },
                [ids[0] ?? "", tip0] as const,
              )
            await scrollTo("top")
            await twoFrames(lp)
            await scrollTo("end")
            await twoFrames(lp)
            const followed = await railAt()
            check(
              "the rail scrolls to keep a column's outline in view",
              followed?.scrolls === true &&
                followed.scrollTop > 0 &&
                followed.end &&
                !followed.start,
              JSON.stringify(followed),
            )
            // Under the pointer, the rail is the reader's: it holds still.
            const rail = await lp.$(".rail")
            const box = await rail?.boundingBox()
            if (box !== undefined && box !== null)
              await lp.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
            await scrollTo("top")
            await twoFrames(lp)
            const held = await railAt()
            check(
              "the rail holds still while the pointer is over it",
              followed !== null &&
                held !== null &&
                held.scrollTop === followed.scrollTop &&
                !held.start,
              `${JSON.stringify(held)} after ${JSON.stringify(followed)}`,
            )
            await lp.mouse.move(600, 10)
            await short.evaluate(n => n.parentNode?.removeChild(n))

            // Left halfway up, and shown again: the same message at the same
            // height.
            await scrollTo("middle")
            await twoFrames(lp)
            // Halfway up 30 messages, the view is in a capsule: the outline
            // wraps it whole, and a thin line across it marks each edge of the
            // view that falls inside it, never a block that would read as a
            // fill.
            const cut = await lp.evaluate(key => {
              const ticks = [
                ...document.querySelectorAll(`.rail-tick[data-key="${key}"]`),
              ]
              const outlines = [
                ...document.querySelectorAll(`.rail-view[data-key="${key}"]`),
              ].map(o => o.getBoundingClientRect())
              const capsules = [
                ...document.querySelectorAll(".rail-stretch"),
              ].map(c => c.getBoundingClientRect())
              return {
                lines: ticks.length,
                each: ticks.map(tick => {
                  const t = tick.getBoundingClientRect()
                  const y = t.top + t.height / 2
                  const x = t.left + t.width / 2
                  const c = capsules.find(
                    r =>
                      r.top <= y &&
                      y <= r.bottom &&
                      r.left <= x &&
                      x <= r.right,
                  )
                  return c === undefined
                    ? { capsule: false }
                    : {
                        capsule: true,
                        wraps: outlines.some(
                          r => r.top <= c.top && c.bottom <= r.bottom,
                        ),
                        inside: t.top >= c.top - 1 && t.bottom <= c.bottom + 1,
                        wider: t.width > c.width,
                        thin: t.height <= 4,
                      }
                }),
              }
            }, key0)
            check(
              "a view in part of a capsule outlines the capsule whole, with a thin line at each edge of the view inside it",
              cut.lines >= 1 &&
                cut.lines <= 2 &&
                cut.each.every(
                  e =>
                    e.capsule &&
                    e.wraps === true &&
                    e.inside === true &&
                    e.wider === true &&
                    e.thin === true,
                ),
              JSON.stringify(cut),
            )
            const where = () =>
              lp.$eval(
                body0,
                (b, keep) => {
                  const top = b.getBoundingClientRect().top
                  const msgs = [
                    ...b.querySelectorAll<HTMLElement>(".msg[data-entry]"),
                  ]
                  const m =
                    keep === null
                      ? msgs.find(n => n.getBoundingClientRect().bottom > top)
                      : msgs.find(n => n.dataset.entry === keep)
                  return m === undefined
                    ? null
                    : {
                        id: m.dataset.entry ?? "",
                        offset: m.getBoundingClientRect().top - top,
                        gap: b.scrollHeight - b.scrollTop - b.clientHeight,
                      }
                },
                null as string | null,
              )
            const left = await where()
            await stepAway(lp)
            await stepBack(lp, taskOf(longRoot))
            await lp.waitForSelector(`${col(0)} .msg`, { timeout: 15_000 })
            await twoFrames(lp)
            const back =
              left === null
                ? null
                : await lp.$eval(
                    body0,
                    (b, id) => {
                      const m = b.querySelector(`.msg[data-entry="${id}"]`)
                      return m === null
                        ? null
                        : m.getBoundingClientRect().top -
                            b.getBoundingClientRect().top
                    },
                    left.id,
                  )
            check(
              "a column shown again is where its reader left it",
              left !== null &&
                left.gap > 100 &&
                back !== null &&
                Math.abs(back - left.offset) <= 2,
              `left ${left?.id ?? "?"} at ${Math.round(left?.offset ?? 0)}px, ${Math.round(left?.gap ?? 0)}px above the end; back at ${back === null ? "?" : Math.round(back)}px`,
            )
          }
          // On nothing, Lee reports no thread, and leaves no presence behind.
          await lp.$$eval("#sidebar .open-close", bs => {
            for (const b of bs) (b as HTMLButtonElement).click()
          })
          await page
            .waitForFunction(
              () => document.querySelector(".avatar") === null,
              undefined,
              {
                timeout: 15_000,
              },
            )
            .catch(() => null)
        } finally {
          await lp.close().catch(() => {})
          await writer.close()
        }
      }
      // ── nothing left of the old controls ────────────────────────────────────
      await page.$$eval(
        "#reading, #thread, #threadMode, #followLatest, #switchLane, #offLane, .fork, #streaming, .rule, .rule-marker, .branch-here, .new-thread, .start, .start-agent, .start-chat",
        n => n.length,
      )

      // ── a second window joins and asks ──────────────────────────────────────
      // Alone, nobody else is shown anywhere.
      await page.evaluate(() => ({
        avatars: [...document.querySelectorAll(".avatar")].map(
          a =>
            `${a.closest("[data-task], .column-head")?.className}:${a.getAttribute("data-writer")}`,
        ),
        rings: [...document.querySelectorAll(".rail-dot[data-here]")].map(d =>
          d.getAttribute("title"),
        ),
      }))
      // Ada's other tabs, closed above, read until their presence decays: her
      // avatar's menu would offer their threads too. Wait for this page alone.
      await waitFor(
        () =>
          new Set(
            Object.keys(host.presence.reading())
              .filter(k => k.startsWith(`${ME}:`))
              .map(k => k.split(":")[1]),
          ).size === 1,
        45_000,
      )
      const second = await browser.newPage()
      await asPerson(second, "second@browser.test", "Sam")
      try {
        await second.goto(host.httpUrl, {
          waitUntil: "domcontentloaded",
          timeout: 20_000,
        })
        // It opens on the board, with nothing in its list, and follows Ada from
        // her avatar on the root she reads. Others who joined earlier may still
        // be shown until their presence decays, so the avatar is found by her
        // writer id.
        const adaTrigger = `#board .reader-trigger:has(.avatar[data-writer="${ME}"])`
        await second
          .waitForSelector(adaTrigger, {
            timeout: 20_000,
          })
          .catch(() => null)
        const followedAda = await chooseFromMenu(
          second,
          adaTrigger,
          ".here-thread",
        )
        const rendered = await second
          .waitForSelector(".column .msg", { timeout: 20_000 })
          .then(
            () => true,
            () => false,
          )
        check(
          "a joining window follows Ada's thread from her avatar on the board",
          followedAda && rendered,
        )
        // Presence: the second window's open column rings its thread's end on the
        // first window's rail; opening that thread shows it in the header.
        const ring = await page
          .waitForSelector(".rail-dot[data-here]", { timeout: 15_000 })
          .then(
            el => el,
            () => null,
          )
        const ringTitle = (await ring?.getAttribute("title")) ?? ""
        check(
          "another window following a thread rings its end on the rail",
          ring !== null && ringTitle.startsWith("here: "),
          `${ringTitle}`,
        )
        if (ring !== null) await ring.click()
        const avatar = await page
          .waitForSelector(".column-head .avatar", { timeout: 15_000 })
          .then(
            () => true,
            () => false,
          )
        check(
          "the column following that thread shows the other window in its header",
          avatar,
        )
        // Its typing makes a card, new in `cards`, so the column redraws; its
        // message list does not. What earlier steps set going (a
        // thread's name, a title, a run's end and the facts its drain
        // appends) lands first, so the renders counted are the card's alone.
        await idle()
        await waitForQuiet(page)
        await second.fill(`${col(0)} .composer .input`, "thinking")
        const typing = await page
          .waitForSelector(".composer .typing", { timeout: 15_000 })
          .then(
            () => true,
            () => false,
          )
        check(
          "the other window's typing shows in that thread's composer",
          typing,
        )
        const theirTyping = await componentRenders(page)
        const columnsDrawn = theirTyping.filter(r => r.name === "Column").length
        const listsDrawn = theirTyping.filter(
          r => r.name === "MessageListView" || r.name === "MessageView",
        ).length
        check(
          "another window's card redraws the column and none of its messages",
          columnsDrawn > 0 && listsDrawn === 0,
          `Column ${columnsDrawn}, list ${listsDrawn}`,
        )
        await second.fill(`${col(0)} .composer .input`, "")
        await second.fill(`${col(0)} .composer .input`, "B asks about this")
        await second.click(`${col(0)} .composer .send`)
        await second
          .waitForSelector(msg("B asks about this"), { timeout: 60_000 })
          .catch(() => null)
        await waitFor(() => idleNow(host))
        // A's replica has everything the host has, and has drawn it, before the
        // cards below look for the column's last message in A's window.
        await countIsHosts(page)
        const shownTask = await page
          .$eval('#sidebar [aria-current="true"]', n =>
            n.getAttribute("data-task"),
          )
          .catch(() => null)
        // Its first root's newest message.
        const threads = readThreads(host.session)
        const shownRoot = [...threads.values()].find(
          t =>
            indexTasks(readPlaces(host.places), threads).taskOfThread.get(
              t.thread,
            ) === shownTask,
        )?.root
        const newest =
          shownRoot === undefined
            ? undefined
            : readRoots(host.session).get(shownRoot)?.newest
        await page
          .waitForSelector(`.msg[data-entry="${newest}"]`, { timeout: 15_000 })
          .catch(() => null)

        // Cards: what you type is your message on its
        // thread, which only you see, kept across tab switches; a note is
        // shown to everyone at that end.
        const box = `${col(0)} .composer .input`
        const boxValue = (p: typeof page, sel: string) =>
          p.$eval(sel, el => (el as HTMLTextAreaElement).value).catch(() => "")
        const hasValue = (p: typeof page, sel: string, want: string) =>
          p
            .waitForFunction(
              ([s, v]) =>
                (document.querySelector(s ?? "") as HTMLTextAreaElement | null)
                  ?.value === v,
              [sel, want],
              { timeout: 15_000 },
            )
            .then(
              () => true,
              () => false,
            )
        await page.click(box)
        // Typed with no pause: the first keystroke creates the card, and the rest
        // must land in it.
        await page.keyboard.type("Together:")
        await page.waitForFunction(
          s => document.querySelector(s)?.getAttribute("data-card") != null,
          box,
          { timeout: 10_000 },
        )
        const together = (await page.getAttribute(box, "data-card")) ?? ""
        const cardEnd = await page
          .locator(`${col(0)} .msg[data-entry]`)
          .last()
          .getAttribute("data-entry")
        await second.click(`.rail-dot[data-entry="${cardEnd}"]`)
        // Nowhere in the other window: not in a composer, not as a note.
        const messageHidden = await second
          .waitForSelector(`[data-card="${together}"]`, { timeout: 2_000 })
          .then(
            () => false,
            () => true,
          )
        await chooseOnCard(
          page,
          `${col(0)} .composer`,
          '.move-to[data-to="note"]',
        )
        const theirs = `${await openNote(second, together)} textarea`
        const shownThere = await hasValue(second, theirs, "Together:")
        check(
          "your message shows only in your window; moved to the notes, it shows in the other's note column",
          messageHidden && shownThere,
          `hidden ${messageHidden}, a note there ${shownThere}`,
        )
        await second.focus(theirs)
        await second.keyboard.press("End")
        await second.keyboard.type(" from B")
        const ourFrame = await openNote(page, together)
        const mergedHere = await hasValue(
          page,
          `${ourFrame} textarea`,
          "Together: from B",
        )
        const heading = await second
          .textContent(`${theirs.replace(/ textarea$/, "")} .card-by`)
          .catch(() => "")
        check(
          "the other window's edit reaches the note's owner, and the note names who wrote in it",
          mergedHere && /'s note · with /.test(heading ?? ""),
          `${heading}`,
        )
        // The note discarded, and a message again, for what follows.
        await page.click(`${ourFrame} .discard-card`)
        await page.click(box)
        await page.keyboard.type("Together: from B")
        await hasValue(page, box, "Together: from B")
        const here =
          (await page.getAttribute(
            '#sidebar [aria-current="true"]',
            "data-task",
          )) ?? ""
        await page.click(itemSel(taskOf(downRoot)))
        await page.click(itemSel(here))
        check(
          "what you type is still there after switching tabs",
          await hasValue(page, box, "Together: from B"),
          `${await boxValue(page, box)}`,
        )
        // A card in another root, typed before this one's last word.
        await page.click(itemSel(taskOf(downRoot)))
        await page.click(box)
        await page.keyboard.press("End")
        await page.keyboard.type(" elsewhere")
        const elsewhere = await boxValue(page, box)
        await page.click(itemSel(here))
        // Undo is the card's (Kyneta's stack): your typing, never the other's.
        // A word typed after a space starts a step, so Cmd+Z takes back "more",
        // a run of four keystrokes, which redo puts back in order.
        await page.focus(box)
        await page.keyboard.press("End")
        await page.keyboard.type(" and more")
        await page.keyboard.press("ControlOrMeta+z")
        const undone = await hasValue(page, box, "Together: from B and ")
        await page.keyboard.press("ControlOrMeta+Shift+z")
        const redone = await hasValue(page, box, "Together: from B and more")
        check(
          "Cmd+Z undoes your last run of typing, and Cmd+Shift+Z redoes it",
          undone && redone,
          `${await boxValue(page, box)}`,
        )
        // Cmd+Z in the other root's box undoes its card, though this root's
        // typing is newer.
        await page.click(itemSel(taskOf(downRoot)))
        await page.focus(box)
        await page.keyboard.press("ControlOrMeta+z")
        const thereUndone = await page
          .waitForFunction(
            sel =>
              !(
                document.querySelector(sel) as HTMLTextAreaElement | null
              )?.value.endsWith("elsewhere"),
            box,
            { timeout: 5_000 },
          )
          .then(
            () => true,
            () => false,
          )
        const thereNow = await boxValue(page, box)
        // And its first keystroke, so its card is gone.
        await page.keyboard.press("ControlOrMeta+z")
        await page.click(itemSel(here))
        check(
          "Cmd+Z in a card undoes only that card, never a newer step in another root",
          elsewhere.endsWith(" elsewhere") &&
            thereUndone &&
            (await hasValue(page, box, "Together: from B and more")),
          `${JSON.stringify(thereNow)}`,
        )
        await page.focus(box)
        await page.keyboard.press("Enter")
        const sentCard = msg("Together: from B and more")
        await page.waitForSelector(sentCard, { timeout: 60_000 }).then(
          () => true,
          () => false,
        )
        await page
          .$eval(`${sentCard} .role`, n => n.textContent ?? "")
          .catch(() => "")
        const emptied = await hasValue(page, box, "")
        await page.click(itemSel(taskOf(downRoot)))
        await page.click(itemSel(here))
        check(
          "a sent card leaves the box empty, and a tab switch does not bring it back",
          emptied && (await hasValue(page, box, "")),
        )
        // After a send, Cmd+Z in the emptied box changes nothing, here or in
        // the other root.
        const cardsAfterSend = readPlaces(host.places).length
        await page.focus(box)
        await page.keyboard.press("ControlOrMeta+z")
        await waitFor(() => false, 300)
        check(
          "Cmd+Z after a send changes nothing",
          (await hasValue(page, box, "")) &&
            readPlaces(host.places).length === cardsAfterSend,
          `${readPlaces(host.places).length} cards, ${cardsAfterSend} before`,
        )
        // Undo past a card's creation empties the box and keeps the card,
        // whose record only the host writes; Cmd+Shift+Z in the
        // same box brings its text back.
        await page.keyboard.type("x")
        await waitFor(
          () => readPlaces(host.places).length > cardsAfterSend,
          5_000,
        )
        await page.keyboard.press("ControlOrMeta+z")
        await waitFor(() => false, 300)
        const unmade =
          (await hasValue(page, box, "")) &&
          readPlaces(host.places).length === cardsAfterSend + 1
        await page.keyboard.press("ControlOrMeta+Shift+z")
        const remade = await hasValue(page, box, "x")
        check(
          "Cmd+Z past a card's creation empties it and keeps its record, and Cmd+Shift+Z in its box brings its text back",
          unmade && remade,
          `${unmade}, ${remade}`,
        )
        // Gone again, so the rest starts from an empty box.
        await page.keyboard.press("ControlOrMeta+z")
        await hasValue(page, box, "")
        await idle()
        // A branch's message is kept at its thread; closing it asks, and discards.
        // A message's tools show on hover.
        const branchable = page
          .locator(`${col(0)} .msg[data-entry]:has(> .tools > .branch)`)
          .first()
        await branchable.hover()
        await branchable.locator(":scope > .tools > .branch").click()
        const unstartedBox = `${col(1)} .composer .input`
        await page.waitForSelector(unstartedBox, { timeout: 15_000 })
        await page.focus(unstartedBox)
        await page.keyboard.press("End")
        await page.keyboard.type("a fresh thought")
        const unstartedText = await boxValue(page, unstartedBox)
        await page.click(itemSel(taskOf(downRoot)))
        await page.click(itemSel(here))
        const unstartedKept = await hasValue(page, unstartedBox, unstartedText)
        check(
          "a new branch's text is kept across a tab switch",
          unstartedKept && unstartedText.endsWith("a fresh thought"),
          `${await boxValue(page, unstartedBox)}`,
        )
        const cardsBefore = readPlaces(host.places).filter(
          c => c.place.kind !== "trash",
        ).length
        await page.click(`${col(1)} .close`)
        const closed = await page
          .waitForFunction(
            () => document.querySelectorAll(".column").length === 1,
            undefined,
            { timeout: 5_000 },
          )
          .then(
            () => true,
            () => false,
          )
        const shown = () =>
          readPlaces(host.places).filter(c => c.place.kind !== "trash").length
        await waitFor(() => shown() < cardsBefore, 5_000)
        // Its thread's card to the trash; its message stays on it.
        check(
          "× on a new branch that holds text trashes its card at once, asking nothing",
          closed && shown() === cardsBefore - 1,
        )
        // Marks: a pip where a card of yours holds text.
        const pipIn = (p: typeof page, sel: string) =>
          p
            .waitForSelector(`${sel} .signal[data-signal="unsent"]`, {
              timeout: 5_000,
            })
            .then(
              () => true,
              () => false,
            )
        const pipGone = (p: typeof page, sel: string) =>
          p
            .waitForFunction(
              s =>
                document.querySelector(`${s} .signal[data-signal="unsent"]`) ===
                null,
              sel,
              { timeout: 5_000 },
            )
            .then(
              () => true,
              () => false,
            )
        await page.click(box)
        await page.keyboard.type("where was I")
        await page.click(itemSel(taskOf(downRoot)))
        const tabMarked = await pipIn(page, itemSel(here))
        const otherBare =
          (await page
            .locator(
              `${itemSel(taskOf(downRoot))} .signal[data-signal="unsent"]`,
            )
            .count()) === 0
        await page.click(itemSel(here))
        const markedEnd = await page
          .locator(`${col(0)} .msg[data-entry]`)
          .last()
          .getAttribute("data-entry")
        const railDot = `.rail-dot[data-entry="${markedEnd}"]`
        const railMarked = await pipIn(page, railDot)
        check(
          "a card of yours with text marks its root's item in the sidebar and its thread's end on the rail",
          tabMarked && otherBare && railMarked,
          `tab ${tabMarked}, other tab bare ${otherBare}, rail ${railMarked}`,
        )
        // Emptied, the card's record stays, and the marks go: they read its text.
        const records = readPlaces(host.places).length
        await page.focus(box)
        await page.keyboard.press("ControlOrMeta+a")
        await page.keyboard.press("Backspace")
        const unmarked =
          (await pipGone(page, itemSel(here))) && (await pipGone(page, railDot))
        check(
          "a card emptied marks nothing, though its record stays",
          unmarked && readPlaces(host.places).length === records,
          `${unmarked}; ${readPlaces(host.places).length} records, ${records} before`,
        )
        // A root you closed is marked on ▦ and on its thread card.
        await page.keyboard.type("back tomorrow")
        await pipIn(page, itemSel(here))
        const columnsHere = await page.locator(".column").count()
        await page.hover(itemSel(here))
        await page.click(`${itemSel(here)} ~ .open-close`)
        const archiveMarked = await pipIn(page, "#bottom .board-toggle")
        await openBoard(page)
        const rowMarked = await pipIn(page, `#board ${boardSel(here)}`)
        await openFromBoard(page, here)
        const columnsBack = await page
          .waitForFunction(
            n => document.querySelectorAll(".column").length === n,
            columnsHere,
            { timeout: 15_000 },
          )
          .then(
            () => true,
            () => false,
          )
        check(
          "an archived root holding your card marks ▦ and its thread card, and comes back as it was",
          archiveMarked && rowMarked && columnsBack,
          `▦ ${archiveMarked}, item ${rowMarked}, columns ${columnsBack}`,
        )
        // An archived root's work is done: its card lights its own item on
        // the board, never ▦. Restored after, for what follows.
        await chooseFromMenu(page, OWN_MENU, ".move-to.closes")
        await page.waitForFunction(
          r =>
            document.querySelector(`#sidebar .open-root[data-task="${r}"]`) ===
            null,
          here,
          { timeout: 15_000 },
        )
        // The item leaving and ▦'s pip are one render's facts.
        const archiveBare =
          (await page
            .locator('#bottom .board-toggle .signal[data-signal="unsent"]')
            .count()) === 0
        await openBoard(page)
        const archivedRow = await pipIn(
          page,
          `#board .board-archive ${boardSel(here)}`,
        )
        await openFromBoard(page, here)
        await page.click(`${col(0)} .read-only-action`)
        await page.waitForSelector(`${col(0)} .composer .send`, {
          timeout: 15_000,
        })
        check(
          "an archived root holding your card marks its thread card, not ▦",
          archiveBare && archivedRow,
          `▦ bare ${archiveBare}, item ${archivedRow}`,
        )
        // Empty again, so what follows starts from an empty box.
        await page.focus(box)
        await page.keyboard.press("ControlOrMeta+a")
        await page.keyboard.press("Backspace")
        await pipGone(page, itemSel(here))
      } finally {
        await second.close().catch(() => {})
      }

      // Your inventory, in the DOWN thread's tab: its agent
      // thread and the conversation below it.
      await page.click(itemSel(taskOf(downRoot)))
      await page.waitForFunction(
        () => document.querySelectorAll(".column").length >= 2,
        undefined,
        { timeout: 15_000 },
      )
      const placeOf = (id: string) =>
        readPlaces(host.places).find(c => c.id === id)?.place
      const slotOf = (id: string) => `.inventory .slot[data-card="${id}"]`
      const valueIs = (sel: string, want: string) =>
        page
          .waitForFunction(
            ([s, v]) =>
              (document.querySelector(s ?? "") as HTMLTextAreaElement | null)
                ?.value === v,
            [sel, want],
            { timeout: 10_000 },
          )
          .then(
            () => true,
            () => false,
          )
      const boxText = (sel: string) =>
        page.$eval(sel, el => (el as HTMLTextAreaElement).value).catch(() => "")
      const appears = (sel: string) =>
        page.waitForSelector(sel, { timeout: 10_000 }).then(
          () => true,
          () => false,
        )
      await page.click("#bottom .inventory-toggle")
      await page.waitForSelector(".inventory", { timeout: 5_000 })
      // Take into the inventory: Ctrl+Shift+I in a composer's box takes its card.
      const downBox = `${col(1)} .composer .input`
      await page.click(downBox)
      await page.keyboard.type("for later: a plan")
      await page.waitForFunction(
        s => document.querySelector(s)?.getAttribute("data-card") != null,
        downBox,
        { timeout: 10_000 },
      )
      const parked = (await page.getAttribute(downBox, "data-card")) ?? ""
      await page.keyboard.press("Control+Shift+I")
      const inSlot = await appears(slotOf(parked))
      const lineShown = await page
        .waitForFunction(
          s => document.querySelector(s)?.textContent === "for later: a plan",
          `${slotOf(parked)} .card-face-lines`,
          { timeout: 10_000 },
        )
        .then(
          () => true,
          () => false,
        )
      const firstLine = await page
        .textContent(`${slotOf(parked)} .card-face-lines`)
        .catch(() => "")
      const boxEmptied = await valueIs(downBox, "")
      await waitFor(() => placeOf(parked)?.kind === "inventory", 5_000)
      check(
        "Ctrl+Shift+I takes the composer's card into your inventory, which shows its first line, and the composer empties",
        inSlot &&
          lineShown &&
          boxEmptied &&
          placeOf(parked)?.kind === "inventory",
        `slot ${inSlot}, line ${firstLine}, emptied ${boxEmptied}, ${placeOf(parked)?.kind}`,
      )
      // Swap: dropped on an empty slot, the card moves there; with the panel
      // focused, the undo key swaps it back (this tab's own stack).
      const inventorySlot =
        (await page.getAttribute(slotOf(parked), "data-slot")) ?? ""
      const emptySlot = inventorySlot === "9" ? "10" : "9"
      const slotAt = (n: string) => `.inventory .slot[data-slot="${n}"]`
      await page.dragAndDrop(slotOf(parked), slotAt(emptySlot))
      const swapped = await appears(
        `${slotAt(emptySlot)}[data-card="${parked}"]`,
      )
      await page.focus(slotAt(emptySlot))
      await page.keyboard.press("ControlOrMeta+z")
      const swappedBack = await appears(
        `${slotAt(inventorySlot)}[data-card="${parked}"]`,
      )
      check(
        "with the panel focused, the undo key swaps back",
        swapped && swappedBack,
        `to ${emptySlot}: ${swapped}; back to ${inventorySlot}: ${swappedBack}`,
      )
      // Put: Ctrl+Shift+O puts the selected card in the column last focused.
      const slotIndex = await page.getAttribute(slotOf(parked), "data-slot")
      await page.click(downBox)
      await page.click(slotOf(parked))
      await page.keyboard.press("Control+Shift+O")
      const putNote = `${await openNote(page, parked)} textarea`
      const putBack = await valueIs(putNote, "for later: a plan")
      await waitFor(() => placeOf(parked)?.kind === "note", 5_000)
      check(
        "Ctrl+Shift+O puts the selected card in the column you were in, as a note there",
        putBack && placeOf(parked)?.kind === "note",
        `${await boxText(putNote)}; ${placeOf(parked)?.kind}`,
      )
      // Undo, outside a box: the put is undone, and the card is back in its
      // slot. The host records a move as it applies it, so the key
      // can follow at once.
      await page.evaluate(() =>
        (document.activeElement as HTMLElement | null)?.blur(),
      )
      await page.keyboard.press("ControlOrMeta+z")
      const undone = await appears(
        `.inventory .slot[data-slot="${slotIndex}"][data-card="${parked}"]`,
      )
      await waitFor(() => placeOf(parked)?.kind === "inventory", 5_000)
      check(
        "the undo key outside a box undoes the put: the card is back in its slot",
        undone && placeOf(parked)?.kind === "inventory",
        `slot ${slotIndex}: ${undone}; ${placeOf(parked)?.kind}`,
      )
      // Drag: a slot droppedThere on another column's foot puts its card there.
      const agentBox = `${col(0)} textarea[data-card="${parked}"]`
      await page.dragAndDrop(slotOf(parked), `${col(0)} .composer`)
      const droppedThere = await valueIs(agentBox, "for later: a plan")
      await waitFor(() => placeOf(parked)?.kind === "composing", 5_000)
      check(
        "dragging a slot onto another column's foot puts its card there",
        droppedThere && placeOf(parked)?.kind === "composing",
        `${await boxText(agentBox)}; ${placeOf(parked)?.kind}`,
      )
      // Undone, and removed: what follows starts from no card of this one.
      await page.evaluate(() =>
        (document.activeElement as HTMLElement | null)?.blur(),
      )
      await page.keyboard.press("ControlOrMeta+z")
      // Dropped on the canvas past its last column, a text card lands in a
      // note column made for it there; the undo key takes back
      // both.
      await waitFor(() => placeOf(parked)?.kind === "inventory", 5_000)
      await page.dragAndDrop(slotOf(parked), "#strip > .canvas-end")
      await waitFor(() => placeOf(parked)?.kind === "note", 5_000)
      const wrapPlace = placeOf(parked)
      const wrapColumn =
        wrapPlace?.kind === "note" ? wrapPlace.column : undefined
      const columnPlace =
        wrapColumn === undefined ? undefined : placeOf(wrapColumn)
      // Last on its canvas: ranked after every other card there.
      const wrapped =
        columnPlace?.kind === "canvas" &&
        readPlaces(host.places).every(
          c =>
            c.id === wrapColumn ||
            c.place.kind !== "canvas" ||
            c.place.task !== columnPlace.task ||
            c.place.order < columnPlace.order,
        )
      await page.evaluate(() =>
        (document.activeElement as HTMLElement | null)?.blur(),
      )
      await page.keyboard.press("ControlOrMeta+z")
      const unwrapped = await waitFor(
        () =>
          placeOf(parked)?.kind === "inventory" &&
          wrapColumn !== undefined &&
          placeOf(wrapColumn) === undefined,
        5_000,
      )
      check(
        "a card dropped on the canvas past its last column lands in a note column made for it there, and the undo key takes back both",
        wrapped && unwrapped >= 0,
        `${wrapped}, ${wrapPlace?.kind}; undone ${unwrapped} ms, ${placeOf(parked)?.kind}`,
      )
      // Discarded with its ×, and back in its slot with the undo key: a
      // discard is a move the host's history holds.
      await page.click(slotOf(parked))
      await page.keyboard.press("Enter")
      await page.click(".inventory .discard-card")
      await waitFor(() => placeOf(parked)?.kind === "trash", 5_000)
      await page.evaluate(() =>
        (document.activeElement as HTMLElement | null)?.blur(),
      )
      await page.keyboard.press("ControlOrMeta+z")
      const discardUndone = await waitFor(
        () => placeOf(parked)?.kind === "inventory",
        5_000,
      )
      check(
        "a card's × discards it, and the undo key outside a box brings it back",
        discardUndone >= 0,
        `${discardUndone} ms; ${placeOf(parked)?.kind}`,
      )
      // Dropped on a state in the footer's strip, a card becomes a thread
      // there, its first message the card's text; the undo key lifts it back
      // into the card while it holds that message alone.
      const stateEl = "#bottom .strip-state[data-put-state]"
      const target = await page
        .getAttribute(stateEl, "data-put-state")
        .catch(() => null)
      const rootsBefore = new Set(readRoots(host.session).keys())
      const spunInto = () =>
        [...readRoots(host.session).values()].find(
          r => !rootsBefore.has(r.root) && r.firstLine === "for later: a plan",
        )
      await page.dragAndDrop(slotOf(parked), stateEl).catch(() => undefined)
      const spun = await waitFor(
        () => spunInto() !== undefined && placeOf(parked)?.kind === "trash",
        15_000,
      )
      const into = spunInto()
      const thread =
        into?.entry == null ? undefined : taskHolding(host, into.entry)
      const landed =
        thread === undefined
          ? undefined
          : boardStateOf(readPlaces(host.places), thread)
      await page.evaluate(() =>
        (document.activeElement as HTMLElement | null)?.blur(),
      )
      await page.keyboard.press("ControlOrMeta+z")
      const lifted = await waitFor(
        () =>
          placeOf(parked)?.kind === "inventory" &&
          into !== undefined &&
          !readRoots(host.session).has(into.root),
        15_000,
      )
      check(
        "a card dropped on a state in the footer's strip becomes a thread there, and the undo key lifts it back into the card",
        spun >= 0 && landed === target && lifted >= 0,
        `spun ${spun} ms into ${thread} in ${landed}, not ${target}; lifted ${lifted} ms, ${placeOf(parked)?.kind}`,
      )
      // Selected, a card is previewed beside the grid, read only;
      // Enter opens it whole in place, over its neighbours, its box
      // focusable, and the preview hides; Escape there folds it, and focus
      // is back on its slot. An empty slot first, since a click on
      // the card already selected opens it.
      await page.click(slotAt(emptySlot))
      await page.click(slotOf(parked))
      const previewed = await page
        .waitForFunction(
          id => {
            const preview = document.querySelector(
              `.inventory .preview .card-normal[data-card="${id}"]`,
            )
            return (
              preview?.textContent?.includes("for later: a plan") === true &&
              preview.querySelector("textarea, [contenteditable]") === null
            )
          },
          parked,
          { timeout: 10_000 },
        )
        .then(
          () => true,
          () => false,
        )
      await page.keyboard.press("Enter")
      const previewHidden = await page
        .waitForFunction(
          () =>
            document.querySelector(".inventory .card-grid-open") !== null &&
            document.querySelector(".inventory .preview") === null,
          undefined,
          { timeout: 10_000 },
        )
        .then(
          () => true,
          () => false,
        )
      check(
        "selecting a slot previews its card beside the grid, read only, and Enter opens it in place instead",
        previewed && previewHidden,
        `previewed ${previewed}, hidden once open ${previewHidden}`,
      )
      const openInPlace = await page
        .$eval(slotOf(parked), slot => {
          const open = slot.parentElement?.querySelector(".card-grid-open")
          const s = slot.getBoundingClientRect()
          const o = open?.getBoundingClientRect()
          return (
            o !== undefined &&
            Math.abs(o.top - s.top) < 2 &&
            o.width > s.width * 1.5 &&
            open?.querySelector("textarea") !== null
          )
        })
        .catch(() => false)
      await page.focus(".inventory .card-grid-open textarea")
      await page.keyboard.press("Escape")
      const foldedBack = await page
        .waitForFunction(
          sel =>
            document.querySelector(".inventory .card-grid-open") === null &&
            document.activeElement === document.querySelector(sel),
          slotOf(parked),
          { timeout: 5_000 },
        )
        .then(
          () => true,
          () => false,
        )
      check(
        "a card selected in the inventory opens in place, and Escape folds it",
        openInPlace && foldedBack,
        `opened ${openInPlace}, folded ${foldedBack}`,
      )
      await page.click(slotOf(parked))
      await page.keyboard.press("Enter")
      await page.click(".inventory .discard-card")
      await waitFor(() => placeOf(parked)?.kind === "trash", 5_000)
      const columnsBefore = await page.locator(".column").count()
      // × on an unstarted branch with text trashes it; the task column's
      // trash lists it, and restore brings it back, its text with it.
      const branchable = page
        .locator(
          `${col(columnsBefore - 1)} .msg[data-entry]:has(> .tools > .branch)`,
        )
        .first()
      await branchable.hover()
      await branchable.locator(":scope > .tools > .branch").click()
      const branch = col(columnsBefore)
      const unstartedBox = `${branch} .composer .input`
      await page.waitForSelector(unstartedBox, { timeout: 15_000 })
      await page.click(unstartedBox)
      await page.keyboard.type("half a thought")
      await page.waitForFunction(
        s => document.querySelector(s)?.getAttribute("data-card") != null,
        unstartedBox,
        { timeout: 10_000 },
      )
      const thought = (await page.getAttribute(unstartedBox, "data-card")) ?? ""
      const branchCard = (await page.getAttribute(branch, "data-card")) ?? ""
      await page.click(`${branch} .close`)
      const columnsAre = (n: number) =>
        page
          .waitForFunction(
            n => document.querySelectorAll(".column").length === n,
            n,
            { timeout: 10_000 },
          )
          .then(
            () => true,
            () => false,
          )
      const closedFresh = await columnsAre(columnsBefore)
      // The inventory, docked in the middle, covers the task column: its
      // controls are pressed from the keyboard.
      const press = async (sel: string) => {
        await page.focus(sel, { timeout: 10_000 })
        await page.keyboard.press("Enter")
      }
      if ((await page.$(".task-column.folded-column")) !== null)
        await press(".task-column.folded-column .folded-title")
      const trashRow = `.task-trash .trash-row[data-card="${branchCard}"]`
      await press(".task-trash summary").catch(() => {})
      const listed = await appears(trashRow)
      await press(`${trashRow} .trash-restore`).catch(() => {})
      const restored = await columnsAre(columnsBefore + 1)
      check(
        "× on an unstarted branch trashes it, the task's trash lists it, and restore brings it back with its text",
        closedFresh &&
          listed &&
          restored &&
          placeOf(branchCard)?.kind === "canvas" &&
          placeOf(thought)?.kind === "composing",
        `closed ${closedFresh}, listed ${listed}, restored ${restored}, ${placeOf(branchCard)?.kind}`,
      )
      // Its text taken into slot 5, which a reload below keeps.
      await page.click('.inventory .slot[data-slot="5"]')
      await page.focus(unstartedBox)
      await page.keyboard.press("Control+Shift+I")
      await appears(`.inventory .slot[data-slot="5"][data-card="${thought}"]`)
      await page.click(`${branch} .close`)
      await columnsAre(columnsBefore)

      // Pinned cards, in the DOWN thread's agent column:
      // pin moves the composer's card to the strip at the column's top, above
      // its scrolling messages, and the composer is empty again.
      const composerBox = `${col(0)} .composer .input`
      await page.click(composerBox)
      await page.keyboard.type("keep the tests green")
      await page.waitForFunction(
        s => document.querySelector(s)?.getAttribute("data-card") != null,
        composerBox,
        { timeout: 10_000 },
      )
      const pinnedCard =
        (await page.getAttribute(composerBox, "data-card")) ?? ""
      // The inventory, left open in the middle of the screen, would cover it.
      if ((await page.locator(".inventory").count()) > 0)
        await page.click("#bottom .inventory-toggle")
      await chooseOnCard(
        page,
        `${col(0)} .composer`,
        '.move-to[data-to="pinned"]',
      )
      const inStrip = await appears(
        `${col(0)} .pinned-strip textarea[data-card="${pinnedCard}"]`,
      )
      const pinEmptied = await valueIs(composerBox, "")
      const stripAbove = await page
        .$eval(col(0), c => {
          const strip = c
            .querySelector(".pinned-strip")
            ?.getBoundingClientRect()
          const body = c.querySelector(".column-body")?.getBoundingClientRect()
          return (
            strip !== undefined &&
            body !== undefined &&
            strip.bottom <= body.top + 1
          )
        })
        .catch(() => false)
      await waitFor(() => placeOf(pinnedCard)?.kind === "pinned", 5_000)
      check(
        "pin draws the card in the strip at the top of its column, above the messages, and empties the composer",
        inStrip &&
          pinEmptied &&
          stripAbove &&
          placeOf(pinnedCard)?.kind === "pinned",
        `strip ${inStrip}, emptied ${pinEmptied}, above ${stripAbove}, ${placeOf(pinnedCard)?.kind}`,
      )
      // The next run reads it: a marker is drawn just above its prompt.
      await send(0, "@agent with the pinned card")
      await idle()
      const readMarked = await page
        .waitForFunction(
          sel => {
            const marker = document.querySelector(sel)
            return (
              marker?.nextElementSibling?.matches(".msg.chat") === true &&
              (marker.nextElementSibling.textContent ?? "").includes(
                "with the pinned card",
              )
            )
          },
          `${col(0)} details.pinned-read`,
          { timeout: 15_000 },
        )
        .then(
          () => true,
          () => false,
        )
      check(
        "after a run, the marker of the pinned cards it read is drawn above its prompt",
        readMarked,
      )

      // Notes: your message's ⋯ moves it to the note column
      // nearest its thread.
      // The inventory, left open in the middle of the screen, would cover it.
      if ((await page.locator(".inventory").count()) > 0)
        await page.click("#bottom .inventory-toggle")
      await page.click(composerBox)
      await page.keyboard.type("one thought")
      await page.waitForFunction(
        s => document.querySelector(s)?.getAttribute("data-card") != null,
        composerBox,
        { timeout: 10_000 },
      )
      const noted = (await page.getAttribute(composerBox, "data-card")) ?? ""
      await chooseOnCard(
        page,
        `${col(0)} .composer`,
        '.move-to[data-to="note"]',
      )
      await valueIs(composerBox, "")
      await appears(await openNote(page, noted))
      // Written in the box under the notes, a note is made at the first
      // keystroke and that same box goes on writing it, so nothing typed is
      // lost. Alt+↑ there moves it up the column, for everyone, and hands it
      // to the list, focused there; Alt+↓ in the list moves it back down.
      const newNote = ".note-column .new-card textarea"
      await page.click(newNote)
      await page.keyboard.type("jot")
      const jotted = await waitFor(
        () =>
          readPlaces(host.places).some(
            c => c.place.kind === "note" && host.cardText(c.id) === "jot",
          ),
        10_000,
      )
      const inBox = await page
        .$eval(
          newNote,
          el =>
            el === document.activeElement &&
            el.getAttribute("data-card") != null,
        )
        .catch(() => false)
      check(
        "a note written in the box at its note column's end is made at the first keystroke, in that box",
        jotted >= 0 && inBox,
        `jotted ${jotted} ms; in its box ${inBox}`,
      )
      const orderOf = (text: string) => {
        const c = readPlaces(host.places).find(
          x => x.place.kind === "note" && host.cardText(x.id) === text,
        )
        return c?.place.kind === "note" ? c.place.order : ""
      }
      await page.keyboard.press("Alt+ArrowUp")
      const raised = await waitFor(
        () => orderOf("jot") < orderOf("one thought"),
        10_000,
      )
      const handed = await page
        .waitForFunction(
          () =>
            document.activeElement instanceof HTMLTextAreaElement &&
            document.activeElement.closest(".note-column-notes") != null &&
            document.activeElement.value === "jot",
          undefined,
          { timeout: 10_000 },
        )
        .then(
          () => true,
          () => false,
        )
      await page.keyboard.press("Alt+ArrowDown")
      const lowered = await waitFor(
        () => orderOf("jot") > orderOf("one thought"),
        10_000,
      )
      check(
        "Alt+↑ in a new note's box moves it up its note column, for everyone, and Alt+↓ in the list moves it back",
        raised >= 0 && handed && lowered >= 0,
        `raised ${raised} ms, handed ${handed}, lowered ${lowered} ms; jot ${orderOf("jot")}, one thought ${orderOf("one thought")}`,
      )
      // A card's header takes focus: Cmd+X there cuts the note
      // to your trash, and Cmd+V with another note's header focused moves
      // that same card out of your trash, back into the note column.
      const noteOf = (text: string) =>
        readPlaces(host.places).find(
          c => c.kind === "text" && host.cardText(c.id) === text,
        )
      const jot = noteOf("jot")?.id ?? ""
      await page.click(`.card-head[data-card="${jot}"]`, {
        position: { x: 4, y: 4 },
      })
      await page.keyboard.press("ControlOrMeta+x")
      const cut = await waitFor(
        () => noteOf("jot")?.place.kind === "trash",
        10_000,
      )
      const neighbour = noteOf("one thought")?.id ?? ""
      await page.click(`.card-head[data-card="${neighbour}"]`, {
        position: { x: 4, y: 4 },
      })
      await page.keyboard.press("ControlOrMeta+v")
      const back = await waitFor(
        () => noteOf("jot")?.place.kind === "note",
        10_000,
      )
      check(
        "a note's header focused, Cmd+X cuts it to your trash, and Cmd+V on another note's header moves that same card back",
        cut >= 0 && back >= 0,
        `cut ${cut} ms, back ${back} ms`,
      )
      // Its title, renamed from its header, for everyone.
      const notesColumn = `.note-column:has(textarea[data-card="${noted}"])`
      await page.click(`${notesColumn} .note-column-title`)
      const titleBox = `${notesColumn} .open-title-input`
      await page.waitForSelector(titleBox, { timeout: 10_000 })
      await page.fill(titleBox, "Ideas")
      await page.press(titleBox, "Enter")
      const columnRenamed = await waitFor(
        () =>
          [...readNoteColumns(host.session).values()].some(
            r => r.title === "Ideas",
          ),
        10_000,
      )
      // The record reaches the page apart from the reply.
      await page
        .waitForFunction(
          s => document.querySelector(s)?.textContent === "Ideas",
          `${notesColumn} .note-column-title`,
          { timeout: 10_000 },
        )
        .catch(() => {})
      const shownTitle = await page
        .textContent(`${notesColumn} .note-column-title`)
        .catch(() => null)
      check(
        "a note column is renamed from its header, for everyone",
        columnRenamed >= 0 && shownTitle === "Ideas",
        `${columnRenamed} ms; ${[...readNoteColumns(host.session).values()].map(r => r.title).join()}; shown ${shownTitle}`,
      )

      // "+ pin", in the conversation below, which has no pinned
      // card: the header offers it, and the box it opens in the strip makes a
      // pinned card. Enter there is a new line; Alt+↑ hands the card to the
      // strip, focused there, and closes the box; the card stays pinned, and
      // "+ pin" moves into the strip. It is the strip's only card, so
      // nothing moves.
      await page.click(`${col(1)} .column-head .new-pin`)
      const pinningBox = `${col(1)} .pinned-strip .new-card .input`
      const pinFocused = await page
        .waitForFunction(
          s => document.querySelector(s) === document.activeElement,
          pinningBox,
          { timeout: 10_000 },
        )
        .then(
          () => true,
          () => false,
        )
      await page.keyboard.type("line one")
      await page.keyboard.press("Enter")
      await page.keyboard.type("line two")
      const twoLines = await valueIs(pinningBox, "line one\nline two")
      const newPinned = (await page.getAttribute(pinningBox, "data-card")) ?? ""
      await page.keyboard.press("Alt+ArrowUp")
      const pinnedBox = `${col(1)} .pinned-strip > .card-editor.pinned textarea[data-card="${newPinned}"]`
      const drawnPinned = await valueIs(pinnedBox, "line one\nline two")
      const pinHanded = await page
        .waitForFunction(
          s => document.querySelector(s) === document.activeElement,
          pinnedBox,
          { timeout: 10_000 },
        )
        .then(
          () => true,
          () => false,
        )
      await waitFor(() => placeOf(newPinned)?.kind === "pinned", 5_000)
      const pinMoved =
        (await page.locator(`${col(1)} .column-head .new-pin`).count()) === 0 &&
        (await page.locator(`${col(1)} .pinned-strip .new-pin`).count()) === 1
      check(
        '"+ pin" in a header opens a box in the strip where Enter is a new line; Alt+↑ there hands the card it makes to the strip, focused, and it stays pinned',
        pinFocused &&
          twoLines &&
          drawnPinned &&
          pinHanded &&
          placeOf(newPinned)?.kind === "pinned" &&
          pinMoved,
        `focused ${pinFocused}, lines ${twoLines}, drawn ${drawnPinned}, handed ${pinHanded}, ${placeOf(newPinned)?.kind}, moved ${pinMoved}`,
      )

      // A trace: Ada pins her card in the conversation
      // below, and someone else pins it on the thread above while she is on
      // a new tab, which reports no column. Back on her tab, a trace says so
      // where the card was, leads to it, and the card's history names who
      // pinned it.
      const traceBox = `${col(1)} .composer .input`
      await page.click(traceBox)
      await page.keyboard.type("pinned while away")
      await page.waitForFunction(
        s => document.querySelector(s)?.getAttribute("data-card") != null,
        traceBox,
        { timeout: 10_000 },
      )
      const traced = textCardId(
        (await page.getAttribute(traceBox, "data-card")) ?? "",
      )
      // Pinned: your message is yours alone, and nobody else moves it.
      await chooseOnCard(
        page,
        `${col(1)} .composer`,
        '.move-to[data-to="pinned"]',
      )
      await waitFor(() => placeOf(traced)?.kind === "pinned", 5_000)
      const tracedFrom = placeOf(traced)
      const aboveEnd = await page
        .locator(`${col(0)} .msg[data-entry]`)
        .last()
        .getAttribute("data-entry")
      await stepAway(page)
      await waitFor(
        () => !readReading(host.presence).some(([w]) => w === ME),
        5_000,
      )
      const pinTo =
        aboveEnd === null
          ? null
          : ({
              kind: "pinned",
              thread: threadHolding(host, entryId(aboveEnd)),
            } as const)
      if (tracedFrom?.kind === "pinned" && pinTo !== null)
        await api.moveCard(
          { card: traced, from: keyOf(tracedFrom), to: pinTo },
          { actedAt: { kind: "column", key: "k-api" }, slot: null },
        )
      await stepBack(page, taskOf(downRoot))
      const traceRow = `${col(1)} .trace`
      const drawnTrace = await appears(traceRow)
      const traceText = (await page.textContent(traceRow).catch(() => "")) ?? ""
      await page.click(traceRow).catch(() => {})
      const leads = await appears(
        `${col(0)} .pinned-strip textarea[data-card="${traced}"]`,
      )
      // The inventory, left open in the middle of the screen, would cover it.
      if ((await page.locator(".inventory").count()) > 0)
        await page.click("#bottom .inventory-toggle")
      const tracedFrame = `${col(0)} .pinned-strip .card-editor:has(textarea[data-card="${traced}"])`
      const historyOpened = await chooseOnCard(
        page,
        tracedFrame,
        ".card-history-item",
      )
      // Who pinned it, as the trace names them.
      const pinner = traceText.replace(" pinned this", "")
      const historyNames = await page
        .waitForFunction(
          words =>
            (
              document.querySelector(".card-history-box")?.textContent ?? ""
            ).includes(words),
          `pinned by ${pinner}`,
          { timeout: 5_000 },
        )
        .then(
          () => true,
          () => false,
        )
      await page.keyboard.press("Escape")
      check(
        "a card someone else pins while you are away leaves a trace where it was, which leads to it, and its history names them",
        drawnTrace &&
          traceText.includes("pinned this") &&
          leads &&
          historyNames,
        `trace ${drawnTrace} (${traceText}), leads ${leads}, history ${historyNames}${historyOpened ? "" : ": not opened"}`,
      )

      // What a new tab of this device opens is the layout last saved.
      const columnKeys = (p: typeof page) =>
        p.$$eval(".column", cs => cs.map(c => c.getAttribute("data-key") ?? ""))
      const openKeys = await columnKeys(page)
      // What you type is kept across a reload too.
      await page.fill(`${col(0)} .composer .input`, "survives a reload")
      await waitFor(() => false, 300)

      // A reload is the same person: the device keeps your email, so your name
      // stays and you are not shown to yourself as someone else.
      const myName = await shownName(page)
      const me = ME
      await page.reload({ waitUntil: "domcontentloaded" })
      // Not asked again: a page that asks never connects, which the check says.
      await connected(page).catch(() => null)
      const kept = await page
        .waitForFunction(
          n =>
            document
              .querySelector("#bottom .me-trigger")
              ?.getAttribute("title") === n,
          myName,
          { timeout: 10_000 },
        )
        .then(
          () => true,
          () => false,
        )
      // Another window's entries may not have expired yet; none may be mine.
      const ghosts = await page.locator(`.avatar[data-writer="${me}"]`).count()
      check(
        "a reload keeps who you are: your name",
        myName === "Ada Lovelace" && kept && ghosts === 0,
        `${myName}), and no ghost of yourself`,
      )
      // The document has arrived (the name shows); give the prune after settling
      // time to run before comparing.
      await waitFor(() => false, 1_000)
      const focusedBox = await page.evaluate(
        () => document.activeElement?.closest(".composer") != null,
      )
      check(
        "a reload focuses no box: only a column you open takes focus",
        !focusedBox,
      )
      const typedBack = await page
        .waitForFunction(
          s =>
            (document.querySelector(s) as HTMLTextAreaElement | null)?.value ===
            "survives a reload",
          `${col(0)} .composer .input`,
          { timeout: 10_000 },
        )
        .then(
          () => true,
          () => false,
        )
      check("what you type is still there after a reload", typedBack)
      // Your inventory is kept as you left it: the kept card in slot 5.
      await page.click("#bottom .inventory-toggle")
      const stillInSlot = await appears(
        `.inventory .slot[data-slot="5"][data-card="${thought}"]`,
      )
      check("a reload keeps your inventory's cards in their slots", stillInSlot)
      await page.click(`.inventory .slot[data-card="${thought}"]`)
      await page.keyboard.press("Enter")
      await page.click(".inventory .discard-card")
      await page.click("#bottom .inventory-toggle")
      await page.fill(`${col(0)} .composer .input`, "")
      // A new tab shares the device's storage (same context; every
      // `browser.newPage()` makes a new one) and opens the layout last saved.
      const newTab = await page.context().newPage()
      try {
        await newTab.goto(host.httpUrl, { waitUntil: "domcontentloaded" })
        await connected(newTab)
        await waitFor(() => false, 1_000)
        const inNewTab = await columnKeys(newTab)
        check(
          "a new tab opens the device's last layout",
          inNewTab.join() === openKeys.join(),
          `${inNewTab.length} of ${openKeys.length}`,
        )
        // It is you, from another seat: your name, and no avatar of yourself.
        const asYou =
          (await shownName(newTab)) === myName &&
          (await page.locator(`.avatar[data-writer="${me}"]`).count()) === 0 &&
          (await newTab.locator(`.avatar[data-writer="${me}"]`).count()) === 0
        check(
          "a second tab is the same person: your name, and never an avatar of you",
          asYou,
        )
      } finally {
        await newTab.close().catch(() => {})
      }

      // ── threads as cards ───────────────────────────────
      // A thread of another root, moved onto the canvas you are on: the
      // canvas holds two roots, and the rail draws each one's tree.
      const here = taskHolding(host, entryId(downRoot))
      const far = await api.chat("a root of another task", ROOT, {
        mode: "branch",
      })
      const farEntry = far.kind === "appended" ? far.id : entryId("none")
      await waitFor(() => {
        try {
          return taskHolding(host, farEntry) !== undefined
        } catch {
          return false
        }
      }, 10_000)
      const farThread = threadHolding(host, farEntry)
      await api.moveCard(
        {
          card: farThread,
          from: { kind: "canvas", task: taskHolding(host, farEntry) },
          to: { kind: "canvas-at", task: here, after: null },
        },
        { actedAt: { kind: "column", key: "k-api" }, slot: null },
      )
      const twoRoots = await page
        .waitForFunction(
          ([thread, entry, own]) =>
            document.querySelector(`#strip [data-card="${thread}"]`) !== null &&
            document.querySelector(`.rail [data-entry="${entry}"]`) !== null &&
            document.querySelector(`.rail [data-entry="${own}"]`) !== null,
          [farThread, farEntry, downRoot],
          { timeout: 20_000 },
        )
        .then(
          () => true,
          () => false,
        )
      check(
        "a thread moved onto the canvas from another task's makes a canvas of two roots: its column, and its root's tree on the rail",
        twoRoots,
      )
      // A column's ⋯ is in the top layer: `.column-head` isolates for its
      // banner, so a box drawn in the header would be under the messages. The
      // far thread's column has no pinned strip, so its messages start just
      // under its header, where the ⋯ opens. An item must lie over a message
      // the column shows, or the hit test proves nothing. A column following
      // its end closes a menu as it scrolls, so it opens again until it is
      // measured. Moved onto the canvas, the column arrives folded.
      await page
        .click(`.folded-column[data-card="${farThread}"] .folded-title`, {
          timeout: 15_000,
        })
        .catch(() => {})
      const farColumn = `#strip .column[data-card="${farThread}"]`
      let layered: {
        under: boolean
        onTop: boolean
        items: number
      } | null = null
      for (let tries = 0; tries < 3 && layered === null; tries++) {
        const opened = await page
          .click(`${farColumn} .column-menu`, { timeout: 15_000 })
          .then(
            () => true,
            () => false,
          )
        if (!opened) break
        await page
          .waitForSelector(`${farColumn} .column-more .menu`, {
            timeout: 5_000,
          })
          .catch(() => null)
        layered = await page.evaluate(column => {
          const box = document.querySelector(`${column} .column-more .menu`)
          const body = document
            .querySelector(`${column} .column-body`)
            ?.getBoundingClientRect()
          if (box === null || body === undefined) return null
          const within = (r: DOMRect, x: number, y: number) =>
            r.left <= x && x <= r.right && r.top <= y && y <= r.bottom
          const messages = [
            ...document.querySelectorAll(`${column} .msg[data-entry]`),
          ].map(m => m.getBoundingClientRect())
          const centres = [...box.querySelectorAll('[role="menuitem"]')].map(
            item => {
              const r = item.getBoundingClientRect()
              return { item, x: r.left + r.width / 2, y: r.top + r.height / 2 }
            },
          )
          const under = centres.some(
            ({ x, y }) =>
              within(body, x, y) && messages.some(m => within(m, x, y)),
          )
          const onTop =
            centres.length > 0 &&
            centres.every(({ item, x, y }) => {
              const hit = document.elementFromPoint(x, y)
              return hit !== null && item.contains(hit)
            })
          return { under, onTop, items: centres.length }
        }, farColumn)
        await page.keyboard.press("Escape")
      }
      check(
        "a column's ⋯ opens over the column's messages, each item on top where it is drawn",
        layered?.under === true && layered.onTop,
        JSON.stringify(layered),
      )
      // Copy to this task: a new thread forked at its source's end, its
      // card beside its source, its fork row naming where it came from.
      const copiesBefore = new Set(
        [...readThreads(host.session)].flatMap(([t, r]) =>
          r.origin.kind === "fork" && r.origin.how === "copy" ? [t] : [],
        ),
      )
      const chose = await chooseFromMenu(
        page,
        `${col(0)} .column-menu`,
        ".column-copy",
      )
      if (chose)
        await waitFor(
          () =>
            [...readThreads(host.session)].some(
              ([t, r]) =>
                r.origin.kind === "fork" &&
                r.origin.how === "copy" &&
                !copiesBefore.has(t),
            ),
          10_000,
        )
      const copy =
        [...readThreads(host.session)].find(
          ([t, r]) =>
            r.origin.kind === "fork" &&
            r.origin.how === "copy" &&
            !copiesBefore.has(t),
        )?.[0] ?? ""
      if (copy !== "")
        await page
          .click(`.folded-column[data-card="${copy}"] .folded-title`, {
            timeout: 15_000,
          })
          .catch(() => {})
      const copiedRow = await page
        .waitForFunction(
          c =>
            document
              .querySelector(`.column[data-card="${c}"] .origin`)
              ?.textContent?.includes("copied from") === true,
          copy,
          { timeout: 15_000 },
        )
        .then(
          () => true,
          () => false,
        )
      check(
        "Copy to this task makes a copy beside its source, its fork row naming what it was copied from",
        copy !== "" && copiedRow,
        copy,
      )

      // Archived by someone else before a reload, the root you were on gives
      // way to the last of the sidebar.
      check(
        "a reload keeps the root you were on",
        (await selectedRoot(page)) === taskOf(downRoot),
      )
      await moveTaskTo(api, entryId(downRoot), "archive")
      await page.reload({ waitUntil: "domcontentloaded" })
      await page
        .waitForFunction(
          r => {
            const on = document
              .querySelector('#sidebar [aria-current="true"]')
              ?.getAttribute("data-task")
            return on != null && on !== r
          },
          taskOf(downRoot),
          { timeout: 20_000 },
        )
        .then(
          () => true,
          () => false,
        )
      await api.close()

      check(
        "no page errors overall",
        errors.length === 0,
        `${errors[0] === undefined ? "" : ` — ${errors[0].slice(0, 90)}`}`,
      )
    } finally {
      await page.close().catch(() => {})
      await host.shutdown().catch(() => {})
    }
  } finally {
    await browser.close().catch(() => {})
  }
}
