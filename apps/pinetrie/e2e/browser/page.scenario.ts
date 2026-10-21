// e2e/browser/page — one window on a real host: who you are, the first turn,
// branches and their columns, moving them, tabs, the header and the inbox,
// the composer and cards, a second window, and a reload.

import { atEntry, entryId, type ThreadId } from "@pinetrie/core"
import { type ButtonWords, promptParent, queueWords } from "@pinetrie/interface"
import {
  readNames,
  readParticipantNames,
  readPlaces,
  readQueueHolds,
  readThreads,
} from "@pinetrie/reads"
import { cardsOnCanvas } from "@pinetrie/rules"
import { isTextCard } from "@pinetrie/threads"
import { COPIED } from "@pinetrie/web/copy"
import type { Page } from "@playwright/test"
import type { Checks } from "../checks.ts"
import {
  composeCard,
  heldEntries,
  heldLanes,
  heldTree,
  idleNow,
  join,
  queueCard,
  waitFor,
} from "../harness.ts"
import type { Scenario } from "../scenario.ts"

import {
  asPerson,
  chooseFromMenu,
  chooseFromMenuOrThrow,
  connected,
  itemSel,
  launchBrowser,
  openProfile,
  RAIL_MESSAGES,
  seeInMenu,
  shownName,
  storedName,
  TO_NOBODY,
  twoFrames,
} from "./page.ts"

import {
  col,
  FOR_ADA,
  ME,
  msg,
  STILL,
  STILL_SOURCE,
  startKit,
  stillMsg,
} from "./page-kit.ts"
export const scenario: Scenario = {
  run: ({ check }) => run(check),
}

async function run(check: Checks["check"]): Promise<void> {
  const browser = await launchBrowser()
  try {
    const kit = await startKit(browser)
    const {
      script,
      host,
      page,
      errors,
      rootCanvas,
      label,
      send,
      sendAfter,
      idle,
      caretIn,
      shows,
      texts,
      top,
    } = kit
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

      // ── names, and the promise before the first message ─────────────────────
      await waitFor(
        () => readParticipantNames(host.session).get(ME) === "Ada",
        15_000,
      )
      await page.waitForSelector("#sidebar .add-canvas", { timeout: 15_000 })
      await page.click("#sidebar .add-canvas")
      await page.waitForSelector(`${col(0)} .composer`, { timeout: 15_000 })
      check(
        "＋ canvas is ready to type in: its box has focus, after @agent",
        (await caretIn(0)) === "@agent ".length,
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
      await sendAfter(0, "Say exactly: BROWSER-OK")
      // Structure, not the model's words: a reply appeared, in this column. What
      // the model says is `e2e:live`'s to check.
      await idle()
      {
        const [lane, ...others] = heldLanes(
          host,
          heldTree(host),
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
        roles.join(",") === "person asked:Ada,assistant:agent",
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
        "the first message takes the new canvas's hollow dot, and the columns stay put",
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
      await other.send("an aside", atEntry(entryId(replyId)), {
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

      // ── a click selects an entry where it is; keys bring theirs into view ──
      // A message whose top alone shows at the column's foot: a click on it
      // must not scroll, as the text under the pointer would move; `j` then
      // selects the message below it, out of view, and must bring it in.
      {
        const size = page.viewportSize()
        if (size !== null) await page.setViewportSize({ ...size, height: 400 })
        const peek = await page.$eval(`${col(0)} ${msg(FOR_ADA)}`, m => {
          const body = m.closest(".column-body")
          if (body === null) return null
          body.scrollTop +=
            m.getBoundingClientRect().top -
            (body.getBoundingClientRect().bottom - 14)
          const r = m.getBoundingClientRect()
          const shown = body.getBoundingClientRect()
          return {
            x: r.left + 20,
            y: r.top + 6,
            peeks: r.top < shown.bottom && r.bottom > shown.bottom,
            scrollTop: body.scrollTop,
          }
        })
        if (peek !== null) await page.mouse.click(peek.x, peek.y)
        const clicked = await page.$eval(`${col(0)} ${msg(FOR_ADA)}`, m => ({
          selected: m.hasAttribute("data-selected"),
          scrollTop: m.closest(".column-body")?.scrollTop ?? -1,
        }))
        check(
          "a click selects the entry under it and scrolls nothing",
          peek?.peeks &&
            clicked.selected &&
            clicked.scrollTop === peek.scrollTop,
          `peeks: ${peek?.peeks}, selected: ${clicked.selected}, scrollTop ${peek?.scrollTop} → ${clicked.scrollTop}`,
        )
        await page.keyboard.press("j")
        const keyed = await page.$eval(`${col(0)} .column-body`, body => {
          const m = body.querySelector<HTMLElement>(".msg[data-selected]")
          if (m === null) return null
          const r = m.getBoundingClientRect()
          const shown = body.getBoundingClientRect()
          return {
            text: m.textContent ?? "",
            inView: r.top >= shown.top && r.top < shown.bottom,
          }
        })
        if (size !== null) await page.setViewportSize(size)
        check(
          "`j` selects the entry below and brings its top into view",
          keyed !== null && !keyed.text.includes(FOR_ADA) && keyed.inView,
          JSON.stringify(keyed),
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
          c =>
            document.querySelector(`${c} .composer`) !== null &&
            document.querySelector(`${c} .msg`) === null,
          col(1),
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
        // Where ⇤ is: ⇥ must be in the same place once folded.
        const toggleAt = async (sel: string) =>
          page
            .locator(sel)
            .boundingBox()
            .then(b =>
              b === null ? null : [b.x + b.width / 2, b.y + b.height / 2],
            )
            .catch(() => null)
        const foldAt = await toggleAt(`${col(0)} .fold`)
        await page.click(`${col(0)} .fold`)
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
          .waitForFunction(
            () => document.getAnimations().every(a => a.id !== "fold"),
            undefined,
            { timeout: 15_000 },
          )
          .catch(() => {})
        const unfoldAt = await toggleAt(
          `.folded-column[data-card="${card}"] .unfold`,
        )
        check(
          "the fold toggle stays under the pointer: ⇥ where ⇤ was",
          foldAt !== null &&
            unfoldAt !== null &&
            Math.abs((foldAt[0] ?? 0) - (unfoldAt[0] ?? 0)) <= 1 &&
            Math.abs((foldAt[1] ?? 0) - (unfoldAt[1] ?? 0)) <= 1,
          JSON.stringify({ foldAt, unfoldAt }),
        )
        // The box, ticked on the strip, is the card's: ticked unfolded too.
        const box = (sel: string) =>
          page
            .locator(sel)
            .isChecked({ timeout: 2_000 })
            .catch(() => null)
        await page
          .click(`.folded-column[data-card="${card}"] .column-box`)
          .catch(() => {})
        await page
          .waitForSelector(
            `.folded-column[data-card="${card}"][data-ticked] .column-box:checked`,
            { timeout: 10_000 },
          )
          .catch(() => {})
        const tickedFolded = await box(
          `.folded-column[data-card="${card}"] .column-box`,
        )
        await page
          .click(`.folded-column[data-card="${card}"] .unfold`, {
            timeout: 15_000,
          })
          .catch(() => {})
        const tickedOpen = await box(`.column[data-card="${card}"] .column-box`)
        check(
          "a column's box ticked on its strip is ticked on its header",
          tickedFolded === true && tickedOpen === true,
          JSON.stringify({ tickedFolded, tickedOpen }),
        )
        // Untick it, so the rest of the scenario sees the column as it was.
        await page
          .click(`.column[data-card="${card}"] .column-box`)
          .catch(() => {})
        await page
          .waitForSelector(
            `.column[data-card="${card}"] .column-box:not(:checked)`,
            {
              timeout: 10_000,
            },
          )
          .catch(() => {})
        // Under the line, with no press: what the thread is doing (its
        // opening line, before a model names a focus).
        const focusShown = await page
          .waitForSelector(
            `.column[data-card="${card}"] .column-head [data-role="focus"]`,
            { timeout: 10_000 },
          )
          .then(
            () => true,
            () => false,
          )
        check(
          "under a column's line, with no press, is what its thread is doing",
          focusShown,
        )
        // Edit title in its ⋯: the title, stored by the host, shows under
        // the line in place of the focus, and an empty save brings the
        // focus back.
        const lineSel = `.column[data-card="${card}"] .column-head [data-role="focus"]`
        const titleSel = `.column[data-card="${card}"] .open-title-input`
        const retitle = async (text: string) => {
          const chosen = await chooseFromMenu(
            page,
            `.column[data-card="${card}"] .column-menu`,
            ".column-rename",
          )
          if (!chosen) return false
          await page.waitForSelector(titleSel, { timeout: 15_000 })
          await page.fill(titleSel, text)
          await page.press(titleSel, "Enter")
          return true
        }
        const lineShows = (title: string | null) =>
          page
            .waitForFunction(
              ([sel, want]) => {
                const line = document.querySelector(sel)
                if (line === null) return false
                return want === null
                  ? line.getAttribute("data-kind") !== "title"
                  : line.getAttribute("data-kind") === "title" &&
                      line.textContent === want
              },
              [lineSel, title] as const,
              { timeout: 15_000 },
            )
            .then(
              () => true,
              () => false,
            )
        const THREAD_TITLE = "Tabs, in order"
        const titled =
          (await retitle(THREAD_TITLE)) && (await lineShows(THREAD_TITLE))
        const cleared = (await retitle("")) && (await lineShows(null))
        check(
          "Edit title in a thread's ⋯ shows its title under the line, and clearing it brings back the focus",
          titled && cleared,
          JSON.stringify({ titled, cleared }),
        )
        // A press on the name, the handle, does nothing but drag: the column
        // stays as it is.
        await page
          .click(`.column[data-card="${card}"] .head-handle`)
          .catch(() => {})
        await page
          .waitForFunction(
            () => document.getAnimations().every(a => a.id !== "fold"),
            undefined,
            { timeout: 5_000 },
          )
          .catch(() => {})
        const stillOpen =
          (await page.locator(`.column[data-card="${card}"]`).count()) === 1
        check(
          "a press on a column's name, its handle, opens nothing",
          stillOpen,
        )
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
      /** Press column `n`'s handle, and move to `dx` px into column `into`. */
      const dragHeader = async (n: number, into: number, dx: number) => {
        const head = await page
          .locator(`${col(n)} .column-head .head-handle`)
          .boundingBox()
        const target = await page.locator(col(into)).boundingBox()
        if (head === null || target === null) return false
        const y = head.y + head.height / 2
        await page.mouse.move(head.x + Math.min(20, head.width / 2), y)
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
      // Wide enough that the third column's handle, after its toggle and
      // box, is in the window: a press outside it presses nothing.
      const narrow = page.viewportSize()
      if (narrow !== null)
        await page.setViewportSize({ ...narrow, width: 1700 })
      const unmoved = await keys()
      const pressed = await dragHeader(2, 0, 60)
      const mid = await marked()
      check(
        "a dragged header's column is lifted and its neighbours slide apart where it will land; nothing moves before the drop",
        pressed &&
          mid.dragging === "2" &&
          mid.shifted === "0,1" &&
          (await keys()).join() === unmoved.join(),
        `${JSON.stringify(mid)}}`,
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
          // The host orders it: a busy host answers late.
          { timeout: 15_000 },
        )
        .catch(() => {})
      const dropped = await keys()
      check(
        "a dropped column moves there, and the others keep their order",
        dropped.join() ===
          [unmoved[2], unmoved[0], unmoved[1], ...unmoved.slice(3)].join(),
        `${unmoved.join()} → ${dropped.join()}`,
      )
      if (narrow !== null) await page.setViewportSize(narrow)
      await page.waitForFunction(
        c =>
          document
            .querySelector(`${c} .msg`)
            ?.textContent?.includes("BROWSER-OK"),
        col(0),
        { timeout: 15_000 },
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
      await other.send("@agent Bea's turn", atEntry(entryId(await tipOf0())))
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
      const again = await composeCard(
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
      const mine = readPlaces(host.places)
        .filter(isTextCard)
        .find(
          c =>
            c.place.kind === "queued" &&
            host.cardText(c.id) === "@agent after Bea",
        )
      if (mine !== undefined) {
        const theirs = other.cardText(mine.id)
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
          [col(0), mine?.id ?? ""] as const,
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
        await queueButton(queueWords({ kind: "after-mine", ahead: 2 })),
        `"${await label(0)}"`,
      )
      // ── the queue's own controls ────────────────────────
      // Alt+↑ in your queued card moves it above Bea's; its box keeps the
      // focus and the caret, though the list was drawn again.
      const yourBox = `${col(0)} .card-editor.queued textarea[data-card="${mine?.id ?? ""}"]`
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
      const reordered = await waitFor(() => firstNow() === mine?.id, 15_000)
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
          [col(0), mine?.id ?? ""] as const,
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
      await chooseFromMenuOrThrow(
        page,
        `${col(0)} .dock-menu-trigger`,
        ".hold-queue",
      )
      await waitFor(
        () =>
          beaLane !== undefined && readQueueHolds(host.session).has(beaLane),
        15_000,
      )
      await chooseFromMenuOrThrow(
        page,
        `${col(0)} .dock-menu-trigger`,
        ".unqueue-all",
      )
      const unqueued = await waitFor(
        () =>
          [again, mine?.id].every(
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
          `${col(0)} .dock-menu-trigger`,
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
          [again, mine?.id].every(
            id =>
              readPlaces(host.places).find(c => c.id === id)?.place.kind ===
              "queued",
          ),
        15_000,
      )
      await chooseFromMenuOrThrow(
        page,
        `${col(0)} .dock-menu-trigger`,
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
      await page.click(`${col(1)} .fold`)
      await page
        .waitForFunction(
          n => document.querySelectorAll(".column").length === n,
          whole - 1,
          { timeout: 15_000 },
        )
        .catch(() => {})
      await page.click(`${col(1)} .fold`)
      await page.waitForFunction(
        () => document.querySelectorAll(".column").length === 1,
        undefined,
        { timeout: 15_000 },
      )
      const forAdaId =
        Object.values(heldEntries(host)).find(e =>
          JSON.stringify(e).includes("just a note"),
        )?.id ?? ""
      const pulse = script.hold("say exactly: PULSE")
      await other.send(
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
      await other.send("@agent say exactly: HELD", atEntry(entryId(forAdaId)), {
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
            [...document.querySelectorAll(".msg.person .role")].some(
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

      // ── ＋ canvas: an agent thread at the root, and stepping down ──
      const _firstRoot = heldTree(host).roots[0] ?? ""
      // A new canvas holds one column, so the thread's columns count from 0.
      const before = 0
      await page.click("#sidebar .add-canvas")
      const agentCol = col(before)
      await page.waitForSelector(`${agentCol} .composer`, { timeout: 15_000 })
      await sendAfter(before, "say exactly: DOWN-ONE")
      await page.waitForSelector(`${agentCol} .msg.assistant`, {
        timeout: 60_000,
      })
      await idle()
      // → at the agent thread's end opens a branch with @agent typed; deleting
      // it steps down to a chat continuing from there.
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
      // A branch from a chat opens with nothing typed. The message's
      // markdown draws as other text, for copy below.
      await send(before + 1, STILL_SOURCE)
      await page.waitForSelector(stillMsg(downCol), { timeout: 60_000 })
      await page.hover(`${downCol} ${msg("off the record")}`)
      await page.click(`${downCol} ${msg("off the record")} > .tools > .branch`)
      const asideCol = col(before + 2)
      await page.waitForSelector(`${asideCol} .composer`, { timeout: 15_000 })
      await page.inputValue(`${asideCol} .composer .input`)
      await page.click(`${asideCol} .trash-column`)
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
      check("the bin on a branch's column takes it off the canvas", asideClosed)
      // The strip, a column narrower, clamps its scroll on the next frame, and
      // a scroll that moves a menu's trigger closes the menu: let it land
      // before ＋'s ▾ opens.
      await twoFrames(page)
      // ＋ past the last column: its ▾'s chat makes a column at the canvas's
      // end, a new root's thread in this canvas, ready to type in.
      // What the page showed, should the column ＋ makes not come.
      const plusState = () =>
        page.evaluate(
          () =>
            `focus on ${document.activeElement?.className ?? "nothing"}; ${document.querySelectorAll(".menu").length} menu(s) open; columns ${[...document.querySelectorAll("#strip > .column")].map(c => c.getAttribute("data-position")).join(",")}`,
        )
      await page.focus("#strip > .canvas-end .add-menu")
      await page.keyboard.press("ArrowDown")
      const chatFocused = await page
        .waitForFunction(
          () => document.activeElement?.classList.contains("add-chat"),
          undefined,
          { timeout: 5_000 },
        )
        .then(
          () => true,
          () => false,
        )
      if (!chatFocused)
        throw new Error(`＋'s ▾ did not focus its chat: ${await plusState()}`)
      await page.keyboard.press("Enter")
      const madeCol = col(before + 2)
      await page
        .waitForSelector(`${madeCol} .composer`, { timeout: 15_000 })
        .catch(async (e: unknown) => {
          throw new Error(
            `the column ＋ made did not come: ${await plusState()}\n${String(e)}`,
          )
        })
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
        cardsOnCanvas(readPlaces(host.places), agentPlace.canvas).at(-1)?.id ===
          made
      const recordOf = (card: string) =>
        [...readThreads(host.session).values()].find(r => r.thread === card)
      const madeRecord = recordOf(made)
      const agentRecord = recordOf(agentCard)
      const madeLabel = await label(before + 2)
      const madeCaret = await caretIn(before + 2)
      check(
        "＋ past the last column makes a chat at the canvas's end: a new root's thread in this canvas, its box focused",
        madeLast &&
          madeRecord?.origin.kind === "root" &&
          agentRecord !== undefined &&
          madeRecord.root !== agentRecord.root &&
          madeLabel === TO_NOBODY &&
          madeCaret === 0,
        `last ${madeLast}; ${JSON.stringify(madeRecord?.origin)}; "${madeLabel}", caret ${madeCaret}`,
      )
      // Taken off again: what follows counts the two columns it made.
      await page.click(`${madeCol} .trash-column`)
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
        .waitForSelector(`${agentCol} .margin-count:text-is("💬 1")`, {
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
      // column on the canvas yet, one is made for it, beside the columns.
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
      // so no note of yours is left to mark the canvas.
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
      const parentId = promptParent(heldTree(host), askedId) ?? ""
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
      const edited = [...heldTree(host).bySend.values()]
        .map(id => heldTree(host).entries[id])
        .find(e => e?.message?.content === "say exactly: DOWN-2B")
      check(
        "edit sends again beside the original: a branch at its parent, starting with its text",
        editStart === "@agent say exactly: DOWN-TWO" &&
          forkOnParent === 1 &&
          edited?.parentId === parentId &&
          (await texts(before)).includes("say exactly: DOWN-TWO"),
        `"${editStart}", its fork dot on the parent: ${forkOnParent}`,
      )
      await page.click(`${editCol} .fold`)
      await page.waitForFunction(
        () => document.querySelectorAll(".column").length === 2,
        undefined,
        { timeout: 15_000 },
      )
      // A canvas dragged over another in the sidebar only reorders. Held over
      // the other's middle past the hold that opens a canvas for a card's drag,
      // it shows no ring and opens nothing; released past that middle, it
      // lands on the other side. The other is never the canvas you are on, so
      // opening it would show. It is pressed off its centre, on the side away
      // from where it goes: the dragged row's own box follows the pointer,
      // and measured among the places it would shift its landing by one.
      {
        const order = await page.$$eval("#sidebar .open-root", ts =>
          ts.map(t => t.getAttribute("data-canvas") ?? ""),
        )
        const current = () =>
          page
            .$eval('#sidebar .open-root[aria-current="true"]', n =>
              n.getAttribute("data-canvas"),
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
          // later. That a canvas's drag opens nothing is `drawPlan`'s, proven
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
                .map(n => n.getAttribute("data-canvas"))
                .join() === o,
            swapped,
            { timeout: 10_000 },
          )
          .then(
            () => true,
            () => false,
          )
        check(
          "a canvas dragged over another's middle in the sidebar opens nothing, and drops above or below it",
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
            ts.map(t => t.getAttribute("data-canvas") ?? ""),
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
                  .map(n => n.getAttribute("data-canvas"))
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
      // A root's first message has no parent: its edit is a new canvas.
      const first = `${agentCol} ${msg("@agent say exactly: DOWN-ONE")}`
      await page.hover(first)
      await page.click(`${first} > .tools > .edit-new-canvas`)
      // A new canvas is one from the start.
      await page.waitForSelector(`${col(0)}[data-card] .composer`, {
        timeout: 15_000,
      })
      await page.click(`${col(0)} .trash-column`)
      const agentRoot = heldTree(host).roots.at(-1) ?? ""
      await page.click(itemSel(rootCanvas(agentRoot)))
      await page.waitForFunction(
        () => document.querySelectorAll(".column").length === 2,
        undefined,
        { timeout: 15_000 },
      )

      check(
        "no page errors overall",
        errors.length === 0,
        `${errors[0] === undefined ? "" : ` — ${errors[0].slice(0, 90)}`}`,
      )
    } finally {
      await kit.close()
    }
  } finally {
    await browser.close().catch(() => {})
  }
}
