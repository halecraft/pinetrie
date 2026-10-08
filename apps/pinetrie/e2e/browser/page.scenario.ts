// e2e/browser/page — one window on a real host: who you are, the first turn,
// branches and their columns, moving them, tabs, the header and the inbox,
// the composer and cards, a second window, and a reload.

import {
  atEntry,
  cardId,
  entryId,
  handleOf,
  keyOf,
  type LaneName,
  pinnedOf,
  projectRail,
  ROOT,
  writerId,
} from "@pinetrie/core"
import {
  type ButtonWords,
  identityCodec,
  queueWords,
  readerHeading,
} from "@pinetrie/interface"
import { SCRIPTED_DESCRIPTION } from "@pinetrie/pi"
import {
  readBoardPlaces,
  readMarks,
  readNames,
  readParticipantNames,
  readPlaces,
  readQueueHolds,
  readReading,
  readRoots,
  readTyping,
  readWorkflow,
} from "@pinetrie/reads"
import { titleOf } from "@pinetrie/rules"
import { COPIED } from "@pinetrie/web/copy"
import { IDENTITY_KEY } from "@pinetrie/web/storage-keys"
import type { Page } from "@playwright/test"
import type { Checks } from "../checks.ts"
import {
  entriesOf,
  idleNow,
  join,
  lanesOf,
  moveRootTo,
  queueCard,
  rootAt,
  rootRecordsOf,
  startSuiteHost,
  suiteModel,
  treeOf,
  waitFor,
} from "../harness.ts"
import type { Scenario } from "../scenario.ts"

import {
  boardSel,
  chooseFromMenu,
  componentRenders,
  connected,
  itemSel,
  launchBrowser,
  OWN_MENU,
  openBoard,
  openFromBoard,
  openProfile,
  RAIL_MESSAGES,
  seeInMenu,
  shownName,
  stepAway,
  stepBack,
  storedName,
  TO_NOBODY,
  twoFrames,
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
    /**
     * The page's message count, on ▦, reaches the host's directory's: it has
     * every root's record, held or not (ADR-0063, ADR-0112).
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
    // use the clipboard, so a check can read what copy wrote (S68).
    const page = await (
      await browser.newContext({
        permissions: ["clipboard-read", "clipboard-write"],
      })
    ).newPage()
    /** The main page's person: the email it gives the form below (ADR-0037). */
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
      // email is the principal, your name the session's label for you (ADR-0037).
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
      check(
        "page loaded, wasm instantiated, client connected to the host",
        true,
      )
      // The render checks count React's development-build measures (S54), and
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
      // The session is plain JSON (ADR-0023): the page loads no Loro and no wasm.
      // In development Vite pre-bundles loro-crdt with its wasm inside a JS module,
      // so a check for `.wasm` files alone would pass with Loro loaded.
      const heavy = await page.evaluate(() =>
        performance
          .getEntriesByType("resource")
          .map(e => e.name)
          .filter(n => /loro|\.wasm/i.test(n)),
      )
      check(
        "the page loads no Loro and no wasm",
        heavy.length === 0,
        `${heavy[0] === undefined ? "" : ` — ${heavy[0].split("/").at(-1)}`}`,
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
      await page.waitForSelector("#open-list .add-agent", { timeout: 15_000 })
      await page.click("#open-list .add-agent")
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
            item: look("#open-list .open-item[data-selected]"),
            page: look("#workspace"),
            list: look("#open-list"),
          }
        })
        const { item, page: paper, list } = surface
        check(
          "the root you are on is the page's colour, your list is not, and it meets the page",
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
      // none of them (ADR-0112). A click on a column above it closes it.
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
      // Its thread is named before anything is typed (ADR-0057).
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
      // naming only a person is for them (ADR-0021).
      await page.fill(`${col(0)} .composer .input`, FOR_ADA)
      await label(0)
      await page.$$eval(".msg.assistant", n => n.length)
      await page.click(`${col(0)} .composer .send`)
      await shows(FOR_ADA)
      await new Promise(r => setTimeout(r, 1500))
      await page.fill(
        `${col(0)} .composer .input`,
        "@agent say exactly: BROWSER-TWO",
      )
      await label(0)
      await page.$$eval(".msg.assistant", n => n.length)
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
      // `new agent`, then its name once reserved (ADR-0057).
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

      // ── moving a column: drag its header, or its grip's keys ───────────────
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
          drop: [...document.querySelectorAll(".column[data-drop]")]
            .map(
              n =>
                `${n.getAttribute("data-position")}:${n.getAttribute("data-drop")}`,
            )
            .join(),
        }))
      const unmoved = await keys()
      const pressed = await dragHeader(2, 0, 60)
      const mid = await marked()
      check(
        "a dragged header's column is lifted and a bar marks where it will land; nothing moves before the drop",
        pressed &&
          mid.dragging === "2" &&
          mid.drop === "0:before" &&
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
          after.drop === "",
        `${JSON.stringify(after)}`,
      )
      await dragHeader(2, 0, 60)
      await page.mouse.up()
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
      await page.focus(`${col(0)} .grip`)
      await page.keyboard.press("ArrowRight")
      const stepped = await keys()
      const focused = await page.evaluate(() => {
        const a = document.activeElement
        return a?.classList.contains("grip") === true
          ? (a.closest(".column")?.getAttribute("data-key") ?? null)
          : null
      })
      check(
        "→ on a column's grip moves it one place right, and its grip keeps focus",
        stepped.join() ===
          [dropped[1], dropped[0], ...dropped.slice(2)].join() &&
          focused === dropped[0],
        `${focused}`,
      )
      // The strip is wider than the page, so the last column starts cut off.
      await page.keyboard.press("End")
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
        "End on its grip moves it last, and scrolls the strip to show it",
        shown?.overflows === true &&
          shown.last === String(dropped.length - 1) &&
          shown.inView,
        `${JSON.stringify(shown)}`,
      )
      await page.keyboard.press("Home")

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
      const beasTurn = script.pause("Bea's turn")
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
        | LaneName
        | undefined
      const beaEnd = atEntry(entryId(await tipOf0()))
      const again = cardId(crypto.randomUUID())
      other.createCard(
        {
          id: again,
          place: {
            kind: "drafting",
            root: rootAt(other, beaEnd),
            at: beaEnd,
            lane: beaLane ?? null,
          },
          carries: { kind: "message", command: null },
          unsent: null,
        },
        "@agent Bea again",
      )
      if (beaLane !== undefined)
        void queueCard(other, again, { lane: beaLane, at: beaEnd })
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
              c.place.kind === "queued" &&
              host.cardText(c.id) === "@agent after Bea",
          ),
        15_000,
      )
      const yours = readPlaces(host.places).find(
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
            const thread = document.querySelector(`${c} .column-content`)
            const cards = [
              ...(thread?.querySelectorAll(".card-editor.queued") ?? []),
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
      check(
        "with your own message last in line, it says it will queue after yours",
        await queueButton(queueWords({ kind: "afterYours", ahead: 2 })),
        `"${await label(0)}"`,
      )
      // ── the queue's own controls (ADR-0048 step 7) ────────────────────────
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
      await page.click(`${col(0)} .queue-controls .hold-queue`)
      await waitFor(
        () =>
          beaLane !== undefined && readQueueHolds(host.session).has(beaLane),
        15_000,
      )
      await page.click(`${col(0)} .queue-controls .unqueue-all`)
      const unqueued = await waitFor(
        () =>
          [again, yours?.id].every(
            id =>
              readPlaces(host.places).find(c => c.id === id)?.place.kind ===
              "drafting",
          ),
        15_000,
      )
      const releaseShown = await page
        .waitForSelector(`${col(0)} .queue-controls .release-queue`, {
          timeout: 15_000,
        })
        .then(
          () => true,
          () => false,
        )
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
      await page.click(`${col(0)} .queue-controls .release-queue`)
      await waitFor(
        () =>
          beaLane !== undefined && !readQueueHolds(host.session).has(beaLane),
        15_000,
      )
      beasTurn.resume()
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
      await page.click(`${col(1)} .close`)
      await page.click(`${col(1)} .close`)
      await page.waitForFunction(
        () => document.querySelectorAll(".column").length === 1,
        undefined,
        { timeout: 15_000 },
      )
      const forAdaId =
        Object.values(entriesOf(host)).find(e =>
          JSON.stringify(e).includes("just a note"),
        )?.id ?? ""
      const pulse = script.pause("say exactly: PULSE")
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
      pulse.resume()
      if (pulsing !== null)
        await page.click(`.rail-dot[data-entry="${pulsing}"]`)
      check(
        "clicking the pulse opens that thread",
        await shows("@agent say exactly: PULSE"),
      )
      await idle()
      // While the agent works, the strip counts its root and the thread's
      // item shows a still ring: nothing in the footer, and nothing in your
      // list, animates (ADR-0069, ADR-0077, ADR-0091).
      const held = script.pause("say exactly: HELD")
      await other.chat("@agent say exactly: HELD", atEntry(entryId(forAdaId)), {
        mode: "branch",
      })
      const working = await page
        .waitForSelector("#bottom .strip-working", { timeout: 30_000 })
        .then(
          () => true,
          () => false,
        )
      const tabWorking = await page
        .waitForSelector("#open-list .root-status.working", { timeout: 15_000 })
        .then(
          () => true,
          () => false,
        )
      const animated = await page
        .$$eval(
          "#bottom .strip-state, #bottom .strip-state *, #open-list .root-status",
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
      held.resume()
      await idle()
      await other.close()

      // ── a page over the workspace (ADR-0098): the browser's Back leaves it,
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
        "the profile page covers the workspace, and the browser's Back returns to the columns as they were",
        scrolled !== null && covered && left && stayed === scrolled,
        `scrollTop ${scrolled} → ${stayed}, covered ${covered}, left ${left}`,
      )

      // ── your profile: a rename shows, and the name each message was sent ──
      // under stays; this device keeps the name you go by (ADR-0037).
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
      await page.click("#open-list .add-agent")
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
      await page.waitForFunction(
        () => document.querySelectorAll(".column").length === 2,
        undefined,
        { timeout: 15_000 },
      )

      // ── a message's tools: one row; edit is a sibling; a first message's new tab
      // (ADR-0043). A person's message in agent work has all three tools.
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
        "a message's tools are one row: copy, take, edit, →",
        row.map(b => b.name).join(" ") ===
          "copy take-copy-into-inventory edit branch" &&
          Math.max(...tops) - Math.min(...tops) <= 1,
        `${JSON.stringify(row)}`,
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
      // you to copy (S68: hiding it stands in for an insecure context).
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
      // Edit opens a branch at the message's parent, holding its text as sent,
      // with @agent in front: its thread's default person the agent, and a branch
      // asks only through a mention.
      const askedId = entryId(
        (await page.getAttribute(person, "data-entry")) ?? "",
      )
      const parentId = treeOf(host).parentOf(askedId) ?? ""
      await page.hover(person)
      await page.click(`${person} > .tools > .edit`)
      const editCol = col(before + 1)
      await page.waitForSelector(`${editCol} .composer`, { timeout: 15_000 })
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
      await page.click(`${editCol} .close`)
      await page.waitForFunction(
        () => document.querySelectorAll(".column").length === 2,
        undefined,
        { timeout: 15_000 },
      )
      // Your list is your own document (ADR-0112): another device of yours,
      // a browser context of its own, has it, in your order. A reload reads
      // it the same way.
      {
        const listOf = (p: Page) =>
          p.$$eval("#open-list .open-root", ts =>
            ts.map(t => t.getAttribute("data-root") ?? ""),
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
                [...document.querySelectorAll("#open-list .open-root")]
                  .map(n => n.getAttribute("data-root"))
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
          "your list is your own: another device of yours has it, in your order",
          mine.length >= 2 && theirs.join() === mine.join(),
          `${theirs.length} of ${mine.length}`,
        )
      }
      // A root's first message has no parent: its edit is a new tab, an agent's
      // since the message asked the agent.
      const first = `${agentCol} ${msg("say exactly: DOWN-ONE")}`
      await page.hover(first)
      await page.click(`${first} > .tools > .edit-new-tab`)
      await page.waitForSelector('#open-list .open-new[aria-current="true"]', {
        timeout: 15_000,
      })
      await page.click(`${col(0)} .close`)
      const agentRoot = treeOf(host).roots.at(-1) ?? ""
      await page.click(`#open-list .open-root[data-root="${agentRoot}"]`)
      await page.waitForFunction(
        () => document.querySelectorAll(".column").length === 2,
        undefined,
        { timeout: 15_000 },
      )

      // ── your list, the board and the inbox (ADR-0030, ADR-0112) ───────────
      const downRoot = treeOf(host).roots.at(-1) ?? ""
      const selectedRoot = (p: Page) =>
        p
          .$eval('#open-list [aria-current="true"]', n =>
            n.getAttribute("data-root"),
          )
          .catch(() => null)
      const messagesIn = (root: string) =>
        projectRail(treeOf(host), entryId(root)).length
      // 1. Which tree a root's rail draws is `hereRail`'s, proven by its unit test.
      await page.click(itemSel(firstRoot))
      await page
        .waitForFunction(
          `(${RAIL_MESSAGES})() === ${messagesIn(firstRoot)}`,
          null,
          {
            timeout: 15_000,
          },
        )
        .catch(() => null)

      // 2. A root someone else starts is not added to your list (ADR-0030).
      const api = await join(host, "tabs", "browser")
      await api.request({ kind: "name", name: "Bea" })
      const third = await api.chat("a third thread", ROOT, { mode: "branch" })
      const thirdRoot = third.kind === "appended" ? third.id : entryId("")
      await countIsHosts(page)
      check(
        "a root another writer starts is not added to your list, and the page stays where it is",
        thirdRoot !== "" &&
          (await page.locator(itemSel(thirdRoot)).count()) === 0 &&
          (await selectedRoot(page)) === firstRoot,
      )
      // Any root can be moved on the board: another item's ⋯ shows while it is hovered.
      const otherMenu = page.locator(
        `${itemSel(downRoot)} ~ .open-more .open-menu`,
      )
      const hiddenAtRest = !(await otherMenu.isVisible())
      await page.hover(itemSel(downRoot))
      const shownOnHover = await otherMenu.isVisible()
      await page.mouse.move(0, 0)
      check(
        "another root in your list shows its ⋯ on hover, and not at rest",
        hiddenAtRest && shownOnHover,
        `${hiddenAtRest}, ${shownOnHover}`,
      )

      // Renders (S54, S59). Your typing writes only presence once your card
      // exists, and `App` reads none, so it redraws nothing outside the
      // composer. Typed for over a second: `typing` is written at most once a
      // second. A render is named by the function that rendered: a message's is
      // `MessageView`, the function `memo` wraps, and a list's
      // `MessageListView`, so a count of `Message` would be 0 whatever renders.
      await page.click(`${col(0)} .composer .input`)
      await page.keyboard.type("t")
      await page.waitForTimeout(500)
      await componentRenders(page)
      await page.keyboard.type("yped while only presence changes", {
        delay: 80,
      })
      const typed = await componentRenders(page)
      // The host has your `typing`: the write the check is about happened.
      const typedHere = readTyping(host.presence).some(([w]) => w === ME)
      const rendersOf = (name: string) => typed.filter(r => r.name === name)
      const outside = [
        "Footer",
        "OpenList",
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
        ["Column", "Footer", "OpenList"].includes(r.name),
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
      // messages. It is in a root of your list, which this tab holds, so the
      // tree changes and every column's list draws again: only the messages'
      // own memo keeps them (S59).
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
      await page.click(itemSel(downRoot))
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
      await page.hover(itemSel(downRoot))
      await page.click(`${itemSel(downRoot)} ~ .open-close`)
      await page
        .waitForFunction(
          r =>
            document.querySelector(
              `#open-list .open-root[data-root="${r}"]`,
            ) === null,
          downRoot,
          { timeout: 15_000 },
        )
        .catch(() => null)
      await openFromBoard(page, downRoot)
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
      await page.click(itemSel(firstRoot))

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
        await openFromBoard(tb, thirdRoot)
        await openBoard(page)
        const reader = `#board ${boardSel(thirdRoot)} .reader-trigger`
        const avatar = await page
          .waitForSelector(reader, { timeout: 15_000 })
          .then(
            () => true,
            () => false,
          )
        check(
          "another window shows on its root's board item, and you never do",
          avatar &&
            (await page
              .locator(
                `#board .avatar[data-writer="${myWriter}"], #bottom .avatar[data-writer="${myWriter}"]`,
              )
              .count()) === 0,
        )
        const toThem = await chooseFromMenu(page, reader, ".here-thread")
        const followed = await page
          .waitForSelector(`${itemSel(thirdRoot)}[aria-current="true"]`, {
            timeout: 15_000,
          })
          .then(
            () => true,
            () => false,
          )
        check(
          "choosing a reader's thread on a board item opens it in your list",
          toThem && followed && (await shows("a third thread")),
        )
        const onThird = await page
          .waitForSelector(`${itemSel(thirdRoot)} .avatar`, { timeout: 15_000 })
          .then(
            () => true,
            () => false,
          )
        // A reader's menu, open as they leave the root, stays and says so:
        // only you close it, by Escape though the row that held focus has
        // gone, and then their avatar leaves the item. The board stays.
        await openBoard(page)
        const tabby = `#board ${boardSel(thirdRoot)} .reader-trigger`
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
        await openFromBoard(tb, firstRoot)
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
                `#open-list .open-root[data-root="${from}"] .avatar`,
              ) === null &&
              document.querySelector(
                `#open-list .open-root[data-root="${to}"] .avatar`,
              ) !== null,
            [thirdRoot, firstRoot] as const,
            { timeout: 15_000 },
          )
          .then(
            () => true,
            () => false,
          )
        check(
          "another window shows on the root it is on in your list, and leaves it when it switches",
          onThird && moved,
        )

        // 4b. Rename (ADR-0045): a title is the root's label for everyone, the
        // board shows it, Escape keeps the old one, and clearing it brings
        // back the first line. The page is on the third root.
        const tabLabel = (p: Page, r: string) =>
          p.textContent(`${itemSel(r)} .open-label`).catch(() => null)
        const labelIs = (p: Page, r: string, want: string) =>
          p
            .waitForFunction(
              ([sel, text]) =>
                document.querySelector(sel)?.textContent === text,
              [`${itemSel(r)} .open-label`, want] as const,
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
          r => document.activeElement?.getAttribute("data-root") === r,
          thirdRoot,
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
            [`#board ${boardSel(thirdRoot)} .board-label`, TITLE] as const,
            { timeout: 15_000 },
          )
          .catch(() => null)
        await tb.click(itemSel(firstRoot))
        const setAt = rootRecordsOf(host, readMarks).get(thirdRoot)?.at
        await rename("not this", "Escape")
        // Long enough for a rename sent by mistake to come back.
        await waitFor(() => false, 1_000)
        check(
          "Escape leaves a root's title as it was, and sends nothing",
          (await labelIs(page, thirdRoot, TITLE)) &&
            (await page.locator(".open-title-input").count()) === 0 &&
            rootRecordsOf(host, readMarks).get(thirdRoot)?.at === setAt,
        )
        await rename("", "Enter")

        // 4c. Auto-update title (ADR-0074): the model's title arrives as the
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

        // 4d. The board (ADR-0112): a root dragged to another state moves
        // there for everyone, and the other window's board shows it.
        {
          const workflow = readWorkflow(host.session)
          const doing = workflow?.open[1]?.id ?? ""
          const column = `#board .board-column[data-state="${doing}"]`
          await openBoard(page)
          await openBoard(tb)
          await page
            .dragAndDrop(`#board ${boardSel(firstRoot)} .board-open`, column)
            .catch(() => null)
          const theirs = await tb
            .waitForSelector(`${column} ${boardSel(firstRoot)}`, {
              timeout: 15_000,
            })
            .then(
              () => true,
              () => false,
            )
          const id = [...readRoots(host.session).values()].find(
            r => r.entry === firstRoot,
          )?.root
          check(
            "dragging a board item to another state moves it for the other window",
            theirs &&
              id !== undefined &&
              readBoardPlaces(host.session).get(id)?.state === doing,
            `${theirs}`,
          )
          await page.click("#bottom .board-toggle")
          await tb.click("#bottom .board-toggle")
        }

        // 5. ＋'s menu, by keyboard; an unsent new tab closes without a trace.

        await page.focus("#open-list .add-menu")
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
        await page.keyboard.press("Enter")
        await page.waitForSelector(`${col(0)} .composer`, { timeout: 15_000 })
        const convo = await label(0)
        check(
          "＋'s conversation, chosen by keyboard, opens a new tab that only sends",
          focused &&
            convo === TO_NOBODY &&
            (await page.textContent(
              '#open-list .open-new[aria-current="true"]',
            )) === "new conversation",
          `"${convo}"`,
        )
        await page.fill(`${col(0)} .composer .input`, "never sent")
        await page.hover("#open-list .open-new")
        await page.click("#open-list .open-new ~ .open-close")
        await page
          .waitForFunction(
            () => document.querySelector("#open-list .open-new") === null,
          )
          .catch(() => null)

        // 6. Mentions: the inbox badge counts what you have not seen, and
        // the inbox takes you there. With no lanes of their own here there are
        // no offers, so the badge is the unseen mentions alone.
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
        // The corner at 11.5rem (ADR-0098): your name gives way, so it, your
        // inbox with a two-digit badge and your inventory sit side by side.
        const viewport = page.viewportSize()
        const folded = async () =>
          (await page.$(':root[data-list="icons"]')) !== null
        const wasFolded = await folded()
        await page.setViewportSize({
          width: 860,
          height: viewport?.height ?? 720,
        })
        if (await folded()) await page.click("#open-list .list-fold")
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
        if (wasFolded !== (await folded()))
          await page.click("#open-list .list-fold")
        check(
          "the corner holds you, your inbox and your inventory side by side at 11.5rem with a two-digit badge",
          corner?.inside === true && corner.apart && corner.width < 200,
          JSON.stringify(corner),
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
        // The reload keeps the root you were on and its columns (ADR-0027).
        await page.click(itemSel(firstRoot))
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
            (await selectedRoot(page)) === firstRoot,
          `${(await keysOf()).length} of ${columnsBefore.length}`,
        )
        // Two tabs of one device share it: mark all seen in one clears the other.
        const sibling = await page.context().newPage()
        try {
          await sibling.goto(host.httpUrl, { waitUntil: "domcontentloaded" })
          // A second tab of the device is the same person (ADR-0037), so its
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
        // reads it (ADR-0112).
        await page.click(itemSel(thirdRoot))
        await page.waitForSelector(`${col(0)} .composer .send`, {
          timeout: 15_000,
        })
        // tb opens the third root again, so it has an item there to lose, and
        // moves it to Done from there.
        await openFromBoard(tb, thirdRoot)
        await page.fill(`${col(0)} .composer .input`, "typed, not sent")
        const menuSeen =
          (await seeInMenu(page, OWN_MENU, ".move-to.closes")) !== null
        await page.keyboard.press("Escape")
        check("a root's ⋯ in your list opens a menu drawn in full", menuSeen)
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
                `#open-list .open-root[data-root="${r}"]`,
              ) === null,
            thirdRoot,
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
        await page.click(`${col(0)} .read-only-action`)
        await page
          .waitForSelector(`${col(0)} .composer .send`, { timeout: 15_000 })
          .catch(() => null)
        await waitFor(() => false, 1_000)
        check(
          "restoring it in place brings back the composer with its text, and adds it to no other window's list",
          (await page.inputValue(input)) === "typed, not sent" &&
            (await tb.locator(itemSel(thirdRoot)).count()) === 0,
        )

        // Moved to Done again, here, it leaves your list; the board brings it back.
        await page.fill(input, "")
        await chooseFromMenu(page, OWN_MENU, ".move-to.closes")
        await page
          .waitForFunction(
            r =>
              document.querySelector(
                `#open-list .open-root[data-root="${r}"]`,
              ) === null,
            thirdRoot,
            { timeout: 15_000 },
          )
          .then(
            () => true,
            () => false,
          )
        await openBoard(page)
        await page.waitForSelector(
          `#board .board-closed ${boardSel(thirdRoot)}`,
          { timeout: 15_000 },
        )
        await openFromBoard(page, thirdRoot)
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
          "Restore on an archived root you opened keeps it in your list, and not in the other window's",
          restored &&
            (await page.locator(itemSel(thirdRoot)).count()) === 1 &&
            (await tb.locator(itemSel(thirdRoot)).count()) === 0,
        )
        // The other window, on nothing, reports no thread: it leaves nothing
        // behind, once its deletions have reached this page.
        await tb.$$eval("#open-list .open-close", bs => {
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
          await openFromBoard(lp, longRoot)
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
          await stepBack(lp, longRoot)
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
            await stepBack(lp, longRoot)
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
          // Where a column was left, and the rail's outline of what it shows
          // (ADR-0058). Column 0 is long: 30 messages and more.
          {
            const body0 = `${col(0)} .column-body`
            const key0 = (await lp.getAttribute(col(0), "data-key")) ?? ""
            const tip0 =
              (await lp
                .locator(`${col(0)} .msg[data-entry]`)
                .last()
                .getAttribute("data-entry")) ?? ""
            // Away from the rail, which holds still under the pointer.
            await lp.mouse.move(600, 10)
            await lp.waitForTimeout(1_600)
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
            // fork, beside the trunk's continuation (ADR-0068): its path is
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
            await stepBack(lp, longRoot)
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
          await lp.$$eval("#open-list .open-close", bs => {
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
      // Alone, nobody else is shown anywhere (ADR-0024).
      await page.evaluate(() => ({
        avatars: [...document.querySelectorAll(".avatar")].map(
          a =>
            `${a.closest("[data-root], .column-head")?.className}:${a.getAttribute("data-writer")}`,
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
        // message list does not (S59).
        await componentRenders(page)
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
        const shownRoot = await page
          .$eval('#open-list [aria-current="true"]', n =>
            n.getAttribute("data-root"),
          )
          .catch(() => null)
        const newest = [...readRoots(host.session).values()].find(
          r => r.entry === shownRoot,
        )?.newest
        await page
          .waitForSelector(`.msg[data-entry="${newest}"]`, { timeout: 15_000 })
          .catch(() => null)

        // Cards (ADR-0048): what you type is a card on its thread, shown to
        // everyone at that end, and kept across tab switches.
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
        const cardEnd = await page
          .locator(`${col(0)} .msg[data-entry]`)
          .last()
          .getAttribute("data-entry")
        await second.click(`.rail-dot[data-entry="${cardEnd}"]`)
        const theirs = `.cards .card-editor.others .input`
        const shownThere = await hasValue(second, theirs, "Together:")
        check(
          "a card typed in one window shows in the other's column, above its composer",
          shownThere,
        )
        await second.focus(theirs)
        await second.keyboard.press("End")
        await second.keyboard.type(" from B")
        const mergedHere = await hasValue(page, box, "Together: from B")
        const heading = await second
          .textContent(".cards .card-heading")
          .catch(() => "")
        check(
          "the other window's edit reaches the card's owner, and the card names who wrote in it",
          mergedHere && /'s draft · with /.test(heading ?? ""),
          `${heading}`,
        )
        const here =
          (await page.getAttribute(
            '#open-list [aria-current="true"]',
            "data-root",
          )) ?? ""
        await page.click(itemSel(downRoot))
        await page.click(itemSel(here))
        check(
          "what you type is still there after switching tabs",
          await hasValue(page, box, "Together: from B"),
          `${await boxValue(page, box)}`,
        )
        // A card in another root, typed before this one's last word.
        await page.click(itemSel(downRoot))
        await page.click(box)
        await page.keyboard.press("End")
        await page.keyboard.type(" elsewhere")
        const elsewhere = await boxValue(page, box)
        await page.click(itemSel(here))
        // Undo is the card's (Kyneta's stack): your typing, never the other's.
        // A word typed after a space starts a step, so Cmd+Z takes back "more",
        // a run of four keystrokes, which redo puts back in order (S64).
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
        // typing is newer (ADR-0052).
        await page.click(itemSel(downRoot))
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
        await page.click(itemSel(downRoot))
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
        // whose record only the host writes (ADR-0059); Cmd+Shift+Z in the
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
        // A fresh column's card is kept by its key; closing it asks, and discards.
        // A message's tools show on hover.
        const branchable = page
          .locator(`${col(0)} .msg[data-entry]:has(> .tools > .branch)`)
          .first()
        await branchable.hover()
        await branchable.locator(":scope > .tools > .branch").click()
        const freshBox = `${col(1)} .composer .input`
        await page.waitForSelector(freshBox, { timeout: 15_000 })
        await page.focus(freshBox)
        await page.keyboard.press("End")
        await page.keyboard.type("a fresh thought")
        const freshText = await boxValue(page, freshBox)
        await page.click(itemSel(downRoot))
        await page.click(itemSel(here))
        const freshKept = await hasValue(page, freshBox, freshText)
        check(
          "a new branch's text is kept across a tab switch",
          freshKept && freshText.endsWith("a fresh thought"),
          `${await boxValue(page, freshBox)}`,
        )
        const cardsBefore = readPlaces(host.places).length
        await page.click(`${col(1)} .close`)
        const asks = await page
          .waitForSelector(`${col(1)} .close-ask`, { timeout: 5_000 })
          .then(
            () => true,
            () => false,
          )
        await page.click(`${col(1)} .close-discard`).catch(() => {})
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
        await waitFor(() => readPlaces(host.places).length < cardsBefore, 5_000)
        check(
          "closing a new branch that holds text asks first, and discarding removes its card",
          asks && closed && readPlaces(host.places).length === cardsBefore - 1,
        )
        // Marks (ADR-0048, step 2): a pip where a card of yours holds text.
        const pipIn = (p: typeof page, sel: string) =>
          p.waitForSelector(`${sel} .card-pip`, { timeout: 5_000 }).then(
            () => true,
            () => false,
          )
        const pipGone = (p: typeof page, sel: string) =>
          p
            .waitForFunction(
              s => document.querySelector(`${s} .card-pip`) === null,
              sel,
              { timeout: 5_000 },
            )
            .then(
              () => true,
              () => false,
            )
        await page.click(box)
        await page.keyboard.type("where was I")
        await page.click(itemSel(downRoot))
        const tabMarked = await pipIn(page, itemSel(here))
        const otherBare =
          (await page.locator(`${itemSel(downRoot)} .card-pip`).count()) === 0
        await page.click(itemSel(here))
        const markedEnd = await page
          .locator(`${col(0)} .msg[data-entry]`)
          .last()
          .getAttribute("data-entry")
        const railDot = `.rail-dot[data-entry="${markedEnd}"]`
        const railMarked = await pipIn(page, railDot)
        check(
          "a card of yours with text marks its root's item in your list and its thread's end on the rail",
          tabMarked && otherBare && railMarked,
          `tab ${tabMarked}, other tab bare ${otherBare}, rail ${railMarked}`,
        )
        // Sam sees Ada's card above his composer, and no mark: it is not his.
        await hasValue(second, theirs, "where was I")
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
        // A root you closed is marked on ▦ and on its board item (ADR-0112).
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
          "a closed root holding your card marks ▦ and its board item, and comes back as it was",
          archiveMarked && rowMarked && columnsBack,
          `▦ ${archiveMarked}, item ${rowMarked}, columns ${columnsBack}`,
        )
        // An archived root's work is done: its card lights its own item on
        // the board, never ▦. Restored after, for what follows.
        await chooseFromMenu(page, OWN_MENU, ".move-to.closes")
        await page.waitForFunction(
          r =>
            document.querySelector(
              `#open-list .open-root[data-root="${r}"]`,
            ) === null,
          here,
          { timeout: 15_000 },
        )
        // The item leaving and ▦'s pip are one render's facts.
        const archiveBare =
          (await page.locator("#bottom .board-toggle .card-pip").count()) === 0
        await openBoard(page)
        const archivedRow = await pipIn(
          page,
          `#board .board-closed ${boardSel(here)}`,
        )
        await openFromBoard(page, here)
        await page.click(`${col(0)} .read-only-action`)
        await page.waitForSelector(`${col(0)} .composer .send`, {
          timeout: 15_000,
        })
        check(
          "an archived root holding your card marks its board item, not ▦",
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

      // Your inventory (ADR-0048 step 4), in the DOWN thread's tab: its agent
      // thread and the conversation below it.
      await page.click(itemSel(downRoot))
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
          `${slotOf(parked)} .slot-line`,
          { timeout: 10_000 },
        )
        .then(
          () => true,
          () => false,
        )
      const firstLine = await page
        .textContent(`${slotOf(parked)} .slot-line`)
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
      // focused, the undo key swaps it back (ADR-0066, this tab's own stack).
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
      const putBack = await valueIs(downBox, "for later: a plan")
      await waitFor(() => placeOf(parked)?.kind === "drafting", 5_000)
      check(
        "Ctrl+Shift+O puts the selected card below the line in the column you were in, and its composer holds it again",
        putBack && placeOf(parked)?.kind === "drafting",
        `${await boxText(downBox)}; ${placeOf(parked)?.kind}`,
      )
      // Undo, outside a box: the put is undone, and the card is back in its
      // slot. The host records a move as it applies it (ADR-0066), so the key
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
      await waitFor(() => placeOf(parked)?.kind === "drafting", 5_000)
      check(
        "dragging a slot onto another column's foot puts its card there",
        droppedThere && placeOf(parked)?.kind === "drafting",
        `${await boxText(agentBox)}; ${placeOf(parked)?.kind}`,
      )
      // Undone, and removed: what follows starts from no card of this one.
      await page.evaluate(() =>
        (document.activeElement as HTMLElement | null)?.blur(),
      )
      await page.keyboard.press("ControlOrMeta+z")
      await page.click(slotOf(parked))
      await page.click(".inventory .remove")
      await waitFor(() => placeOf(parked) === undefined, 5_000)
      const columnsBefore = await page.locator(".column").count()
      // Closing a fresh column with text keeps its card, in the slot selected.
      const branchable = page
        .locator(
          `${col(columnsBefore - 1)} .msg[data-entry]:has(> .tools > .branch)`,
        )
        .first()
      await branchable.hover()
      await branchable.locator(":scope > .tools > .branch").click()
      const fresh = col(columnsBefore)
      const freshBox = `${fresh} .composer .input`
      await page.waitForSelector(freshBox, { timeout: 15_000 })
      await page.click(freshBox)
      await page.keyboard.type("half a thought")
      await page.waitForFunction(
        s => document.querySelector(s)?.getAttribute("data-card") != null,
        freshBox,
        { timeout: 10_000 },
      )
      const thought = (await page.getAttribute(freshBox, "data-card")) ?? ""
      await page.click('.inventory .slot[data-slot="5"]')
      await page.click(`${fresh} .close`)
      await page.click(`${fresh} .close-keep`)
      const keptOnClose = await appears(
        `.inventory .slot[data-slot="5"][data-card="${thought}"]`,
      )
      const closedFresh = await page
        .waitForFunction(
          n => document.querySelectorAll(".column").length === n,
          columnsBefore,
          { timeout: 10_000 },
        )
        .then(
          () => true,
          () => false,
        )
      check(
        "closing a fresh column with text keeps its card in your inventory",
        keptOnClose && closedFresh && placeOf(thought)?.kind === "inventory",
        `slot ${keptOnClose}, closed ${closedFresh}, ${placeOf(thought)?.kind}`,
      )

      // Pinned cards (ADR-0048 step 5), in the DOWN thread's agent column:
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
      await page.click(`${col(0)} .composer .pin`)
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

      // "+ card" (ADR-0048): the composer empties and keeps focus, the card
      // you were writing is drawn above it, and typing makes another.
      await page.click(composerBox)
      await page.keyboard.type("one thought")
      await page.waitForFunction(
        s => document.querySelector(s)?.getAttribute("data-card") != null,
        composerBox,
        { timeout: 10_000 },
      )
      const setAside = (await page.getAttribute(composerBox, "data-card")) ?? ""
      await page.click(`${col(0)} .composer .new-card`)
      const blanked = await valueIs(composerBox, "")
      const blankFocused = await page
        .$eval(composerBox, el => el === document.activeElement)
        .catch(() => false)
      const drawnAbove = await appears(
        `${col(0)} .cards textarea[data-card="${setAside}"]`,
      )
      await page.keyboard.type("another thought")
      const another = await page
        .waitForFunction(
          ([s, old]) => {
            const id = document
              .querySelector(s ?? "")
              ?.getAttribute("data-card")
            return id != null && id !== old
          },
          [composerBox, setAside],
          { timeout: 10_000 },
        )
        .then(
          () => true,
          () => false,
        )
      check(
        '"+ card" empties the focused composer, draws your card above it, and typing makes another',
        blanked && blankFocused && drawnAbove && another,
        `emptied ${blanked}, focused ${blankFocused}, above ${drawnAbove}, another ${another}`,
      )

      // "+ pin" (ADR-0048), in the conversation below, which has no pinned
      // card: the header offers it, and the box it opens in the strip makes a
      // pinned card. Enter there is a new line; Escape closes the box, the
      // card stays pinned, and "+ pin" moves into the strip.
      await page.click(`${col(1)} .column-head .new-pin`)
      const pinningBox = `${col(1)} .pinned-strip .pinning .input`
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
      await page.keyboard.press("Escape")
      const drawnPinned = await valueIs(
        `${col(1)} .pinned-strip .card-editor.pinned:not(.pinning) textarea[data-card="${newPinned}"]`,
        "line one\nline two",
      )
      await waitFor(() => placeOf(newPinned)?.kind === "pinned", 5_000)
      const pinMoved =
        (await page.locator(`${col(1)} .column-head .new-pin`).count()) === 0 &&
        (await page.locator(`${col(1)} .pinned-strip .new-pin`).count()) === 1
      check(
        '"+ pin" in a header opens a box in the strip where Enter is a new line, and the card it makes stays pinned',
        pinFocused &&
          twoLines &&
          drawnPinned &&
          placeOf(newPinned)?.kind === "pinned" &&
          pinMoved,
        `focused ${pinFocused}, lines ${twoLines}, drawn ${drawnPinned}, ${placeOf(newPinned)?.kind}, moved ${pinMoved}`,
      )

      // A trace (ADR-0048 step 6): someone else pins Ada's card in the
      // conversation below while she is on the Archive tab, which reports no
      // column. Back on her tab, a trace says so where the card was, leads to
      // it, and the card's history names who pinned it.
      const traceBox = `${col(1)} .composer .input`
      await page.click(traceBox)
      await page.keyboard.type("pinned while away")
      await page.waitForFunction(
        s => document.querySelector(s)?.getAttribute("data-card") != null,
        traceBox,
        { timeout: 10_000 },
      )
      const traced = cardId(
        (await page.getAttribute(traceBox, "data-card")) ?? "",
      )
      await waitFor(() => placeOf(traced)?.kind === "drafting", 5_000)
      const tracedFrom = placeOf(traced)
      await stepAway(page)
      await waitFor(
        () => !readReading(host.presence).some(([w]) => w === ME),
        5_000,
      )
      const pinTo = tracedFrom === undefined ? null : pinnedOf(tracedFrom)
      if (tracedFrom !== undefined && pinTo !== null)
        await api.moveCard(
          { card: traced, from: keyOf(tracedFrom), to: pinTo },
          { actedAt: { kind: "column", key: "k-api" }, slot: null },
        )
      await stepBack(page, downRoot)
      const traceRow = `${col(1)} .trace`
      const drawnTrace = await appears(traceRow)
      const traceText = (await page.textContent(traceRow).catch(() => "")) ?? ""
      await page.click(traceRow).catch(() => {})
      const leads = await appears(
        `${col(1)} .pinned-strip textarea[data-card="${traced}"]`,
      )
      // The inventory, left open in the middle of the screen, would cover it.
      if ((await page.locator(".inventory").count()) > 0)
        await page.click("#bottom .inventory-toggle")
      const clickError = await page
        .click(
          `${col(1)} .pinned-strip .card-editor:has(textarea[data-card="${traced}"]) .card-history-trigger`,
          { timeout: 5_000 },
        )
        .then(
          () => "",
          (e: unknown) => String(e).split("\n").slice(-4).join(" | "),
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
        `trace ${drawnTrace} (${traceText}), leads ${leads}, history ${historyNames}${clickError === "" ? "" : `: ${clickError}`}`,
      )

      // What a new tab of this device opens is the layout last saved (ADR-0027).
      const columnKeys = (p: typeof page) =>
        p.$$eval(".column", cs => cs.map(c => c.getAttribute("data-key") ?? ""))
      const openKeys = await columnKeys(page)
      // What you type is kept across a reload too (ADR-0048).
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
      await page.click(".inventory .remove")
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

      // Archived by someone else before a reload, the root you were on gives
      // way to the last of your list.
      check(
        "a reload keeps the root you were on",
        (await selectedRoot(page)) === downRoot,
      )
      await moveRootTo(api, entryId(downRoot), "closed")
      await page.reload({ waitUntil: "domcontentloaded" })
      await page
        .waitForFunction(
          r => {
            const on = document
              .querySelector('#open-list [aria-current="true"]')
              ?.getAttribute("data-root")
            return on != null && on !== r
          },
          downRoot,
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
