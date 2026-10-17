// e2e/browser/tools — a scripted tools host: tool rows, live output and Stop,
// where the agent will work, the column's height while it works, commands,
// widths, the thread's name and proposed changes, the review, markdown,
// following, the header's work, and the rail's capsules; first, each ask's work
// folded and opened from the rail, on a host of its own.

import { existsSync, rmSync } from "node:fs"
import path from "node:path"
import {
  atEntry,
  entryId,
  isThreadId,
  messageText,
  projectRail,
  ROOT,
  type ThreadName,
  threadNameParts,
} from "@pinetrie/core"
import {
  builtInIconUrl,
  matchCountWords,
  toolWord,
  workingWords,
} from "@pinetrie/interface"
import { type Held, scriptedModel } from "@pinetrie/pi"
import { readLaneRecords, readNames, readPlaces } from "@pinetrie/reads"
import type { Page } from "@playwright/test"
import type { Checks } from "../checks.ts"
import { command } from "../command.ts"
import {
  type Gate,
  gateClose,
  gateCommand,
  gateFeed,
  newGate,
} from "../gate.ts"
import {
  canvasHolding,
  committedProject,
  FIXTURE_PACKAGES,
  heldLanes,
  heldTree,
  idleNow,
  idOfText,
  join,
  readJjProposedByLane,
  SUITE_CONFIG,
  setUpAccepted,
  suitePlaces,
  waitFor,
} from "../harness.ts"
import { inLaneQuiet, type LaneHosts } from "../lane-hosts.ts"
import { removeLane } from "../lane-runtime.ts"
import type { Scenario } from "../scenario.ts"

import {
  asPerson,
  boardSel,
  chooseFromMenu,
  col,
  componentRenders,
  launchBrowser,
  msg,
  OWN_MENU,
  oneFrame,
  openBoard,
  openFromBoard,
  PANE_VIEWPORT,
  railCount,
  readRaw,
  recordFrames,
  seeInMenu,
  stepAway,
  stepBack,
  twoFrames,
  typeAfter,
} from "./page.ts"

export const scenario: Scenario = {
  lanes: true,
  run: ({ check }, { lanes }) => run(check, lanes),
}

/** Run a gate's script in the lane of the thread `page` draws first. */
async function inThreadLane(page: Page, script: string): Promise<void> {
  const card = await page.getAttribute(col(0), "data-card")
  if (card !== null && isThreadId(card)) await inLaneQuiet(card, script)
}

async function run(check: Checks["check"], lanes: LaneHosts): Promise<void> {
  const browser = await launchBrowser()
  try {
    // ── asks: each ask's work folds, and the rail opens it ────────────────
    // The column is read in story, as a new one opens. A column is read raw
    // in the blocks below (`readRaw`).
    {
      const script = scriptedModel({ tokensPerSecond: 400 })
      const asks = await lanes.sectionHost({
        files: { "notes.txt": "hello\n" },
        model: { kind: "scripted", script },
      })
      const askHost = asks.host
      const ap = await (await browser.newContext()).newPage()
      await asPerson(ap, "asa@browser.test", "Asa")
      try {
        await ap.goto(askHost.httpUrl, { waitUntil: "domcontentloaded" })
        await ap.click("#sidebar .add-canvas")
        const say = async (text: string) => {
          await typeAfter(ap, `${col(0)} .composer .input`, text)
          await ap.click(`${col(0)} .composer .send`)
        }
        const idle = () => waitFor(() => idleNow(askHost))
        const askId = (text: string) => idOfText(askHost, text) ?? ""
        /**
         * Eight reads, a command held until its gate is closed, then a reply:
         * a run that lasts until the step ends it.
         */
        const longRun = (reply: string): Gate => {
          const held = newGate("long-run")
          script.use([
            ...Array.from({ length: 8 }, () => ({
              tool: "read" as const,
              args: { path: "notes.txt" },
            })),
            { tool: "bash", args: { command: gateCommand(held) } },
            { text: reply },
          ])
          return held
        }
        /** The held command of a long run, live: every read before it is drawn. */
        const heldLive = `${col(0)} .tool.live:has-text("pinetrie-gate")`
        const bodyOf = `${col(0)} .column-body`
        /** The column's scroll: how far from its end, and its content's height. */
        const scroll = () =>
          ap.$eval(bodyOf, b => ({
            gap: Math.round(b.scrollHeight - b.scrollTop - b.clientHeight),
            content:
              b.querySelector<HTMLElement>(".column-content")?.offsetHeight ??
              0,
          }))
        const inView = (sel: string) =>
          ap
            .$eval(
              sel,
              (m, b) => {
                const body = document.querySelector(b)?.getBoundingClientRect()
                const box = m.getBoundingClientRect()
                return (
                  body !== undefined &&
                  box.bottom > body.top &&
                  box.top < body.bottom
                )
              },
              bodyOf,
            )
            .catch(() => false)

        // 1. Running, the ask is open; at its end it folds above the view, and
        // the column stays at its end with the last word in view.
        const firstRun = longRun("Read it eight times.")
        await say("read the notes, slowly")
        // The thread's first run starts its lane, which a loaded machine can
        // take a while to do.
        await ap.waitForSelector(heldLive, { timeout: 60_000 })
        const first = askId("read the notes, slowly")
        const work1 = `${col(0)} .ask-work[data-ask-of="${first}"]`
        const openWhileRunning = (await ap.$(`${work1}[data-open]`)) !== null
        const running = await scroll()
        await inThreadLane(ap, gateClose(firstRun))
        await idle()
        const ended = await ap
          .waitForSelector(`${work1}:not([data-open])`, { timeout: 10_000 })
          .then(
            () => true,
            () => false,
          )
        await twoFrames(ap)
        const after = await scroll()
        check(
          "an ask is open while it runs, and folds at its end above the view, the column at its end and the last word in view",
          openWhileRunning &&
            ended &&
            after.content < running.content &&
            after.gap <= 2 &&
            (await inView(msg("Read it eight times."))) &&
            (await ap.$(`${work1} .ask-fold[data-first]`)) !== null,
          `${JSON.stringify({ openWhileRunning, ended, running, after })}`,
        )

        // 2. Scrolled up into a running ask's work, it stays open under the
        // reader after its run ends, and folds when they come back down. The
        // bar names the ask whose message is above, and takes no room.
        const secondRun = longRun("Read it again.")
        await say("read them once more")
        // The held command, live: every read before it is drawn, so the
        // scroll below lands inside the ask's work, as a lane's start can
        // hold the reads back.
        await ap.waitForSelector(heldLive, { timeout: 15_000 })
        const second = askId("read them once more")
        const work2 = `${col(0)} .ask-work[data-ask-of="${second}"]`
        await ap.$eval(
          bodyOf,
          (b, id) => {
            const m = b.querySelector<HTMLElement>(`.msg[data-entry="${id}"]`)
            if (m !== null) b.scrollTop = m.offsetTop + m.offsetHeight + 40
          },
          second,
        )
        const bar = await ap
          .waitForSelector(`${col(0)} .ask-bar[data-ask="${second}"]`, {
            timeout: 5_000,
          })
          .then(
            b => b.evaluate(n => n.textContent ?? ""),
            () => "",
          )
        const slot = await ap
          .$eval(
            `${col(0)} .ask-bar-slot`,
            n => n.getBoundingClientRect().height,
          )
          .catch(() => -1)
        check(
          "the bar names the ask whose work is at the top, and takes no room",
          bar.includes('Asa: "read them once more"') && slot === 0,
          `${JSON.stringify({ bar, slot })}`,
        )
        await inThreadLane(ap, gateClose(secondRun))
        await idle()
        await twoFrames(ap)
        const stayed = (await ap.$(`${work2}[data-open]`)) !== null
        await ap.$eval(bodyOf, b => {
          b.scrollTop = b.scrollHeight
        })
        const folded = await ap
          .waitForSelector(`${work2}:not([data-open])`, { timeout: 5_000 })
          .then(
            () => true,
            () => false,
          )
        check(
          "an ask that ends under a reader scrolled into it stays open, and folds when they return to the end",
          stayed && folded,
          `${JSON.stringify({ stayed, folded })}`,
        )

        // 3. A pick on the rail inside a long ask's capsule opens its fold and
        // brings the message into view.
        const capsule = `.rail .rail-stretch[data-ask="${first}"]`
        await ap.click(capsule)
        const opened = await ap
          .waitForSelector(`${work1}[data-open]`, { timeout: 5_000 })
          .then(
            () => true,
            () => false,
          )
        await twoFrames(ap)
        const shown = await ap.$$eval(
          `${work1} .msg[data-entry]`,
          (ms, b) => {
            const body = document.querySelector(b)?.getBoundingClientRect()
            return ms.some(m => {
              const box = m.getBoundingClientRect()
              return (
                body !== undefined &&
                box.bottom > body.top &&
                box.top < body.bottom
              )
            })
          },
          bodyOf,
        )
        check(
          "a pick inside a capsule opens its ask's fold and brings its message into view",
          opened && shown,
          `${JSON.stringify({ opened, shown })}`,
        )

        // 4. A fold's toggle redraws its own ask, not the column's list. The
        // column follows its end, and the press is the element's own, so no
        // scroll releases it: a release redraws the list, rightly.
        await ap.$eval(bodyOf, b => {
          b.scrollTop = b.scrollHeight
        })
        await twoFrames(ap)
        await componentRenders(ap)
        await ap.$eval(`${work1} .ask-fold[data-first]`, b =>
          (b as HTMLElement).click(),
        )
        await twoFrames(ap)
        const toggled = await componentRenders(ap)
        check(
          "a fold's toggle redraws no list",
          (await ap.$(`${work1}[data-open]`)) === null &&
            !toggled.some(r => r.name === "MessageListView"),
          `${toggled.map(r => r.name).join(", ")}`,
        )

        // 5. Since you were here: hidden, the page leaves its mark at the end;
        // what arrives meanwhile is below the line when it shows again.
        await ap.$eval(bodyOf, b => {
          b.scrollTop = b.scrollHeight
        })
        await twoFrames(ap)
        const visibility = (state: "hidden" | "visible") =>
          ap.evaluate(v => {
            Object.defineProperty(document, "visibilityState", {
              value: v,
              configurable: true,
            })
            document.dispatchEvent(new Event("visibilitychange"))
          }, state)
        await visibility("hidden")
        const bo = await join(askHost, "bo", "asks")
        script.use([{ text: "Back to you." }])
        const lane = heldLanes(
          askHost,
          heldTree(askHost),
          readPlaces(askHost.places),
        )[0]
        await bo.send(
          "@agent anything new?",
          atEntry(entryId(lane?.tip ?? "")),
          {
            thread: lane?.name,
          },
        )
        await idle()
        await ap.waitForSelector(msg("Back to you."), { timeout: 15_000 })
        await visibility("visible")
        const line = await ap
          // Zero height: Playwright counts it hidden, so wait for it attached.
          .waitForSelector(`${col(0)} .left-line`, {
            state: "attached",
            timeout: 5_000,
          })
          .then(
            l =>
              l.evaluate(n => ({
                height: n.getBoundingClientRect().height,
                next: n.nextElementSibling?.textContent ?? "",
              })),
            () => null,
          )
        check(
          "a thread left while the page was hidden marks what came since, and accepted work takes no room",
          line !== null &&
            line.height === 0 &&
            line.next.includes("anything new?"),
          `${JSON.stringify(line)}`,
        )
        await bo.close()

        // 6. A search: each column shows only its own matches over
        // its thread, the rail lights them, and Escape puts every column back
        // where it was, since the thread stayed under the matches.
        const texts = [
          "read the notes, slowly",
          "Read it eight times.",
          "read them once more",
          "Read it again.",
        ]
        const firstShown = () =>
          ap.$eval(bodyOf, b => {
            const view = b.getBoundingClientRect()
            const m = [
              ...b.querySelectorAll<HTMLElement>(".msg[data-entry]"),
            ].find(m => m.getBoundingClientRect().bottom > view.top)
            return {
              top: Math.round(b.scrollTop),
              first: m?.dataset.entry ?? "",
            }
          })
        await ap.$eval(bodyOf, b => {
          b.scrollTop = Math.round((b.scrollHeight - b.clientHeight) / 2)
        })
        await twoFrames(ap)
        const before = await firstShown()
        await ap.evaluate(() =>
          (document.activeElement as HTMLElement | null)?.blur(),
        )
        await ap.keyboard.press("/")
        const focused = await ap
          .waitForSelector(".search-bar .search-field:focus", {
            timeout: 5_000,
          })
          .then(
            () => true,
            () => false,
          )
        await ap.keyboard.type("read")
        await ap
          .waitForSelector(`${col(0)} .match-list .match-row`, {
            timeout: 5_000,
          })
          .catch(() => null)
        const rows = await ap.$$eval(`${col(0)} .match-list .match-row`, rs =>
          rs.map(r => (r as HTMLElement).dataset.entry ?? ""),
        )
        const lit = await ap.$$eval(".rail[data-searching] [data-match]", ms =>
          ms.reduce((n, m) => n + Number((m as HTMLElement).dataset.match), 0),
        )
        const barLine = await ap
          .$eval(".search-bar .search-line", n => n.textContent ?? "")
          .catch(() => "")
        const header = await ap
          .$eval(`${col(0)} .match-count`, n => n.textContent ?? "")
          .catch(() => "")
        await ap.keyboard.press("Escape")
        const gone = await ap
          .waitForSelector(".search-bar", { state: "detached", timeout: 5_000 })
          .then(
            () => true,
            () => false,
          )
        await twoFrames(ap)
        const back = await firstShown()
        const expected = texts.map(askId)
        check(
          "a search shows each column only its matches and lights them on the rail, and Escape puts every column back where it was",
          focused &&
            rows.join() === expected.join() &&
            lit === expected.length &&
            barLine === matchCountWords(expected.length) &&
            header === matchCountWords(expected.length) &&
            gone &&
            (await ap.$(`${col(0)} .match-list`)) === null &&
            back.top === before.top &&
            back.first === before.first,
          `${JSON.stringify({ focused, rows, expected, lit, barLine, header, gone, before, back })}`,
        )

        // 7. A match in an ask's work leaves the search at its message, its
        // fold open, and outlines where it landed.
        const word = askId("Read it eight times.")
        await ap.click("#stage .search-toggle")
        await ap.waitForSelector(".search-bar .search-field:focus", {
          timeout: 5_000,
        })
        await ap.keyboard.type("eight")
        await ap.click(`${col(0)} .match-row[data-entry="${word}"]`)
        const landed = await ap
          .waitForSelector(
            `${col(0)} .msg[data-entry="${word}"][data-landed]`,
            {
              state: "attached",
              timeout: 5_000,
            },
          )
          .then(
            () => true,
            () => false,
          )
        const left = (await ap.$(".search-bar")) === null
        const foldOpen = (await ap.$(`${work1}[data-open]`)) !== null
        await twoFrames(ap)
        check(
          "a match in an ask's work leaves the search at its message, its fold open, and outlined",
          landed &&
            left &&
            foldOpen &&
            (await inView(msg("Read it eight times."))),
          `${JSON.stringify({ landed, left, foldOpen })}`,
        )

        // 8. A column's density is kept with it across a reload.
        await ap.click(`${col(0)} .density-choice[data-density="outline"]`)
        await ap.reload({ waitUntil: "domcontentloaded" })
        const kept = await ap
          .waitForSelector(`${col(0)}[data-density="outline"]`, {
            timeout: 15_000,
          })
          .then(
            () => true,
            () => false,
          )
        // The root's document arrives after the stored layout is drawn.
        await ap
          .waitForSelector(`${col(0)} .ask-line`, { timeout: 15_000 })
          .catch(() => null)
        const lines = await ap.locator(`${col(0)} .ask-line`).count()
        check(
          "a column's density is kept across a reload, and outline draws each ask as a line",
          kept && lines >= 2,
          `${JSON.stringify({ kept, lines })}`,
        )
        // Outline keeps the last ended ask's last word, and only that one.
        const words = await Promise.all(
          ["Read it eight times.", "Read it again.", "Back to you."].map(t =>
            ap.locator(`${col(0)} ${msg(t)}`).count(),
          ),
        )
        check(
          "outline shows the last word of the column's last ended ask, and no other",
          words.join() === "0,0,1",
          `${JSON.stringify(words)}`,
        )
      } finally {
        await ap.context().close()
        await asks.close()
      }
    }

    // ── a proposal: its card after the ask's work, Open, then Send ────────
    {
      const script = scriptedModel()
      const proposing = await lanes.sectionHost({
        files: { "notes.txt": "hello\n" },
        model: { kind: "scripted", script },
      })
      const proposeHost = proposing.host
      const pp = await (await browser.newContext()).newPage()
      await asPerson(pp, "pia@browser.test", "Pia")
      try {
        await pp.goto(proposeHost.httpUrl, { waitUntil: "domcontentloaded" })
        await pp.click("#sidebar .add-canvas")
        script.use([
          {
            tool: "propose_branches",
            args: {
              branches: [
                { title: "one", brief: "do one" },
                { title: "two", brief: "do two" },
                { title: "three", brief: "do three" },
              ],
            },
          },
          { text: "three things" },
        ])
        await typeAfter(pp, `${col(0)} .composer .input`, "split it")
        await pp.click(`${col(0)} .composer .send`)
        await waitFor(() => idleNow(proposeHost))
        const card = `${col(0)} .proposal`
        // A card never drawn fails the check below, rather than the scenario.
        const drawn = await pp
          .waitForSelector(`${card} .proposal-open:not([disabled])`, {
            timeout: 15_000,
          })
          .then(
            () => true,
            () => false,
          )
        // Drawn after the ask's last word, and in no ask's work.
        const after = await pp.evaluate(
          ([cardSel, last]) => {
            const c = document.querySelector(cardSel)
            const word = [...document.querySelectorAll(".msg")].find(m =>
              m.textContent?.includes(last),
            )
            return (
              c !== null &&
              word !== undefined &&
              (word.compareDocumentPosition(c) &
                Node.DOCUMENT_POSITION_FOLLOWING) !==
                0 &&
              c.closest(".ask-work") === null
            )
          },
          [card, "three things"] as const,
        )
        const boxes = drawn
          ? await pp
              .click(`${card} .proposal-open`)
              .then(() => pp.waitForSelector(`${col(3)} .composer .input`))
              .then(() =>
                Promise.all(
                  [1, 2, 3].map(n =>
                    pp.inputValue(`${col(n)} .composer .input`),
                  ),
                ),
              )
          : []
        const sendLabel = drawn
          ? await pp
              .waitForSelector(`${card} .proposal-send`, { timeout: 15_000 })
              .then(() => pp.textContent(`${card} .proposal-send`))
              .catch(() => null)
          : null
        check(
          "a proposal's card is drawn after its ask's work, and Open unfolds a column for each branch, its composer holding the brief",
          drawn &&
            after &&
            boxes.join("|") === "@agent do one|@agent do two|@agent do three" &&
            sendLabel === "Send 3",
          `drawn ${drawn}; after ${after}; boxes ${JSON.stringify(boxes)}; ${sendLabel}`,
        )
        // One edited in its column; Send starts all three, that one as edited.
        // Focus puts the caret after the brief, as a person goes on typing it.
        await pp.focus(`${col(2)} .composer .input`)
        await pp.keyboard.type(", my way")
        await waitFor(() =>
          readPlaces(proposeHost.places).some(
            c => c.kind === "text" && c.place.kind === "composing",
          ),
        )
        await pp.click(`${card} .proposal-send`)
        const started = () => {
          const index = heldTree(proposeHost)
          return Object.values(index.entries)
            .filter(e => e.message?.role === "person")
            .map(e => messageText(e.message))
            .filter(t => t.startsWith("@agent do"))
            .sort()
        }
        await waitFor(() => started().length === 3, 30_000).catch(() => {})
        check(
          "Send starts each opened branch from its composer, an edited one with its edit",
          started().join("|") ===
            "@agent do one|@agent do three|@agent do two, my way",
          started().join(" | "),
        )
      } finally {
        await pp.context().close()
        await proposing.close()
      }
    }

    {
      const work = await committedProject("pinetrie-browser-tools-", {
        "notes.txt": "the secret word is MANGO\n",
      })
      // Slow enough that a reply is seen while it is still being written.
      const script = scriptedModel({ tokensPerSecond: 60 })
      const toolHost = await lanes.startHost({
        model: { kind: "scripted", script },
        project: { dir: work, tools: true },
        // Fixture pi packages, for commands.
        places: suitePlaces({
          user: { ...SUITE_CONFIG, packages: FIXTURE_PACKAGES },
        }),
        log: () => {},
      })
      // A new thread of its own starts at accepted work.
      {
        const owner = await join(toolHost, "owner", "tools")
        await setUpAccepted(toolHost.session, owner)
        await owner.close()
      }
      const tp = await browser.newPage({ viewport: PANE_VIEWPORT })
      await asPerson(tp, "tools@browser.test", "Tess")
      try {
        await tp.goto(toolHost.httpUrl, { waitUntil: "domcontentloaded" })
        await tp.click("#sidebar .add-canvas")
        const say = async (text: string) => {
          await typeAfter(tp, `${col(0)} .composer .input`, text)
          await tp.click(`${col(0)} .composer .send`)
          await readRaw(tp)
        }
        const toolIdle = () => waitFor(() => idleNow(toolHost))
        const appears = (sel: string, timeout = 20_000) =>
          tp.waitForSelector(sel, { timeout }).then(
            () => true,
            () => false,
          )
        // ── what a new thread starts from, said before sending ──────────────
        // With no WIP there is nothing to choose, and no line. A WIP above
        // accepted work offers one; it goes again before the thread starts.
        const startLine = `${col(0)} .start-line`
        const trigger = `${col(0)} .start-trigger`
        const startSaid = async () =>
          (
            (await tp
              .locator(`${trigger} .start-words`)
              .textContent({ timeout: 5_000 })
              .catch(() => "")) ?? ""
          ).trim()
        const inWork = (...args: string[]) =>
          command("jj", ["--no-pager", "-R", work, ...args])
        await typeAfter(tp, `${col(0)} .composer .input`, "what is in notes?")
        {
          const noLine = (await tp.$(startLine)) === null
          await inWork("new", "--no-edit", "pinetrie-accepted", "-m", "wip e2e")
          await inWork(
            "bookmark",
            "create",
            "wip/e2e",
            "-r",
            'latest(description(exact:"wip e2e\n"))',
          )
          const offered = await appears(trigger)
          const atAccepted = await startSaid()
          // A menu that is not there is not opened: its click would wait out
          // Playwright's timeout, and fail the scenario, not the check.
          const chose =
            offered &&
            (await chooseFromMenu(
              tp,
              trigger,
              '.start-base[data-base="wip/e2e"]',
            ))
          const onWip = await startSaid()
          if (offered)
            await chooseFromMenu(tp, trigger, '.start-base[data-base=""]')
          const back = await startSaid()
          await inWork("abandon", "wip/e2e")
          await inWork("bookmark", "delete", "wip/e2e")
          const gone =
            (await tp
              .waitForSelector(startLine, {
                state: "detached",
                timeout: 20_000,
              })
              .then(
                () => true,
                () => false,
              )) === true
          check(
            "with a WIP above accepted work, the line says what the new thread starts from, and its menu changes it; with none, there is no line",
            noLine &&
              offered &&
              atAccepted === "starts from accepted work" &&
              chose &&
              onWip === "starts from your unfinished work: wip/e2e" &&
              back === atAccepted &&
              gone,
            `${noLine}; ${atAccepted}; ${onWip}; ${back}; gone ${gone}`,
          )
        }

        script.use([
          { text: "Let me look.", tool: "read", args: { path: "notes.txt" } },
          { text: "It says MANGO. The file holds one line, and nothing else." },
        ])
        // Sent as typed above, after the new canvas's `@agent `.
        await tp.click(`${col(0)} .composer .send`)
        await readRaw(tp)
        const streamed = await tp
          .waitForFunction(
            c => {
              const s = document.querySelector(`${c} .streaming .text`)
              return s !== null && (s.textContent ?? "").length > 0
            },
            col(0),
            { timeout: 20_000 },
          )
          .then(
            () => true,
            () => false,
          )
        check(
          "the agent's reply shows in its column while it is written",
          streamed,
        )
        await appears(`${col(0)} .tool[data-tool="read"][data-status="ok"]`)
        await toolIdle()

        // A command short enough to hide nothing: the summary/detail check
        // below finds it has no toggle.
        script.use([
          { tool: "bash", args: { command: "echo quick" } },
          { text: "quick" },
        ])
        await say("quick")
        await toolIdle()

        // Eight ticks, each four lines after it, fed as the steps read them.
        const ticking = newGate("tick")
        const ticks = (from: number, to: number) =>
          Array.from({ length: to - from + 1 }, (_, k) => [
            `tick ${from + k}`,
            "1",
            "2",
            "3",
            "4",
          ]).flat()
        script.use([
          { tool: "bash", args: { command: gateCommand(ticking) } },
          { text: "ticked" },
        ])
        await say("tick")
        await tp
          .waitForSelector(`${col(0)} .tool.live`, { timeout: 15_000 })
          .catch(() => null)
        await inThreadLane(tp, gateFeed(ticking, ticks(1, 2)))
        const live = await tp
          .waitForFunction(
            c =>
              document
                .querySelector(`${c} .tool.live .tool-output`)
                ?.textContent?.includes("tick 2") === true,
            col(0),
            { timeout: 20_000 },
          )
          .then(
            () => true,
            () => false,
          )
        check("a running command's output shows live in its column", live)
        // The live output's last five lines, then the result's in their place:
        // pi's result is the live text, so the row keeps its height.
        await inThreadLane(tp, gateFeed(ticking, ticks(3, 6)))
        await tp
          .waitForFunction(
            c =>
              document
                .querySelector(`${c} .tool.live .tool-output`)
                ?.textContent?.includes("tick 6") === true,
            col(0),
            { timeout: 20_000 },
          )
          .catch(() => null)
        const liveHeight = await tp
          .$eval(`${col(0)} .tool.live`, r => r.getBoundingClientRect().height)
          .catch(() => 0)
        await inThreadLane(tp, gateFeed(ticking, ticks(7, 8)))
        await inThreadLane(tp, gateClose(ticking))
        await toolIdle()
        const ticked = tp.locator(`${col(0)} .tool[data-tool="bash"]`).last()
        await ticked
          .locator(".tool-output")
          .waitFor({ timeout: 10_000 })
          .catch(() => null)
        const kept = await ticked.evaluate(d => {
          const out = d.querySelector(".tool-output")
          return {
            live: d.classList.contains("live"),
            open: d.hasAttribute("data-open"),
            status: d.getAttribute("data-status"),
            lines: ((out as HTMLElement | null)?.innerText ?? "").split("\n")
              .length,
            result: out?.textContent?.includes("tick 8") === true,
            height: d.getBoundingClientRect().height,
          }
        })
        check(
          "a running command shows its output's last five lines live, and its result takes their place, the row no shorter",
          liveHeight > 0 &&
            !kept.live &&
            !kept.open &&
            kept.status === "ok" &&
            kept.result &&
            kept.lines === 5 &&
            kept.height >= liveHeight - 0.5,
          `${JSON.stringify({ liveHeight, kept })}`,
        )

        // A row's summary is its command's first five lines and its output's
        // last five, its toggle saying what they leave out; the toggle shows
        // both whole, then folds them. A short command hides nothing, and has
        // no toggle.
        {
          const LONG = [
            "seq 1 300 | sed 's/^/line /'",
            ...Array.from({ length: 8 }, (_, i) => `echo ${i} >/dev/null`),
          ].join("\n")
          script.use([
            { tool: "bash", args: { command: LONG } },
            { text: "listed" },
          ])
          await say("list them")
          await toolIdle()
          const row = tp
            .locator(`${col(0)} .tool[data-tool="bash"][data-status="ok"]`)
            .filter({ hasText: "seq 1 300" })
            .last()
          await row
            .locator(".tool-output")
            .waitFor({ timeout: 10_000 })
            .catch(() => null)
          const measure = () =>
            row.evaluate(d => {
              const lines = (sel: string) => {
                const el = d.querySelector(sel)
                // A final line break ends a line and starts none.
                return el instanceof HTMLElement
                  ? el.innerText.replace(/\n$/, "").split("\n")
                  : []
              }
              const more = d.querySelector(".tool-more")
              return {
                open: d.hasAttribute("data-open"),
                command: lines(".tool-command").length,
                output: lines(".tool-output"),
                more: more?.textContent ?? null,
                expanded: more?.getAttribute("aria-expanded") ?? null,
              }
            })
          const toggle = () =>
            row
              .locator(".tool-more")
              .click({ timeout: 5_000 })
              .catch(() => {})
          const summary = await measure()
          await toggle()
          const detail = await measure()
          await toggle()
          const folded = await measure()
          const quick = tp
            .locator(`${col(0)} .tool[data-tool="bash"]`)
            .filter({ hasText: "echo quick" })
          const quicks = await quick.count()
          const quickToggles = await quick.locator(".tool-more").count()
          const shown = (m: typeof summary) =>
            m.open === false &&
            m.command === 5 &&
            m.output.join() ===
              "line 296,line 297,line 298,line 299,line 300" &&
            m.more === "+4 lines · +295 lines of output" &&
            m.expanded === "false"
          check(
            "a row shows its command's first five lines and its output's last five, its toggle saying what they leave out, and the toggle shows both whole, then folds them; a short one has no toggle",
            shown(summary) &&
              detail.open &&
              detail.command === 9 &&
              detail.output.length === 300 &&
              detail.more === "less" &&
              detail.expanded === "true" &&
              shown(folded) &&
              quicks > 0 &&
              quickToggles === 0,
            `${JSON.stringify({ summary: { ...summary, output: summary.output.length }, detail: { ...detail, output: detail.output.length }, folded: folded.more, quicks, quickToggles })}`,
          )
        }

        // A row its reader folds while the agent works: the floor takes up
        // what it gave back, so a column at its end keeps its height. Its
        // output is two lines past its summary's, so the floor needs less
        // than its cap (FLOOR_MAX).
        {
          const stepping = newGate("step")
          script.use([
            { tool: "bash", args: { command: gateCommand(stepping) } },
            { text: "stepped" },
          ])
          await say("step through")
          await tp
            .waitForSelector(`${col(0)} .tool.live`, { timeout: 15_000 })
            .catch(() => null)
          await inThreadLane(
            tp,
            gateFeed(
              stepping,
              ["a", "b", "c", "d", "e", "f", "g"].map(s => `step ${s}`),
            ),
          )
          const toggle = `${col(0)} .tool.live .tool-more`
          const opened = await appears(toggle, 10_000)
          const column = () =>
            tp.$eval(`${col(0)} .column-body`, b => ({
              height: b.scrollHeight,
              gap: b.scrollHeight - b.scrollTop - b.clientHeight,
              floor:
                b.querySelector(".column-floor")?.getBoundingClientRect()
                  .height ?? 0,
            }))
          if (opened) await tp.click(toggle)
          await twoFrames(tp)
          const full = await column()
          if (opened) await tp.click(toggle)
          await twoFrames(tp)
          const folded = await column()
          const detail = await tp
            .$eval(`${col(0)} .tool.live`, r => r.hasAttribute("data-open"))
            .catch(() => null)
          await inThreadLane(tp, gateClose(stepping))
          await toolIdle()
          check(
            "a row its reader folds while its agent works leaves the column at its end, no shorter",
            opened &&
              detail === false &&
              folded.floor > 0 &&
              folded.height >= full.height &&
              folded.gap <= 2,
            `${JSON.stringify({ detail, full, folded })}`,
          )
        }

        // A tab shown again mounts its columns anew: each row starts as it was
        // left, so a running one is ringed from its first frame and
        // a finished one keeps its reader's choice.
        {
          // Held until the tab has been left and shown again.
          const running = newGate("again")
          script.use([
            { tool: "bash", args: { command: gateCommand(running) } },
            { text: "again done" },
          ])
          // Each gated row is known by its gate's label, in its command.
          const ticked = tp
            .locator(`${col(0)} .tool[data-tool="bash"]`)
            .filter({ hasText: "pinetrie-gate-tick" })
          const stepped = tp
            .locator(`${col(0)} .tool[data-tool="bash"]`)
            .filter({ hasText: "pinetrie-gate-step" })
          // The reader opens the tick command's detail. The floor check
          // above folded the step command's.
          await ticked.locator(".tool-more").click()
          await say("again")
          const opened = await appears(
            `${col(0)} .tool.live[data-revealed]`,
            10_000,
          )
          const root =
            (await tp.getAttribute(
              '#sidebar .open-root[aria-current="true"]',
              "data-canvas",
            )) ?? ""
          /** Away to a new tab and back, recording every bash row's state as it mounts and changes. */
          const away = async () => {
            await stepAway(tp)
            await tp.evaluate(() => {
              const w = window as unknown as {
                __rows: string[]
                __rowsWatch: MutationObserver
              }
              w.__rows = []
              const state = (row: Element, how: string) =>
                `${how}:${row.textContent?.includes("pinetrie-gate-again") ? "again" : "other"}:${row.classList.contains("live") ? "live" : "done"}:${row.hasAttribute("data-open") ? "detail" : "summary"}:${row.hasAttribute("data-revealed") ? "revealed" : "-"}`
              w.__rowsWatch = new MutationObserver(records => {
                for (const r of records) {
                  if (
                    r.type === "attributes" &&
                    r.target instanceof Element &&
                    r.target.matches('.tool[data-tool="bash"]')
                  )
                    w.__rows.push(state(r.target, "changed"))
                  for (const n of r.addedNodes)
                    if (n instanceof Element)
                      for (const row of n.querySelectorAll(
                        '.tool[data-tool="bash"]',
                      ))
                        w.__rows.push(state(row, "added"))
                }
              })
              w.__rowsWatch.observe(document.body, {
                subtree: true,
                childList: true,
                attributes: true,
                attributeFilter: ["data-open", "data-revealed"],
              })
            })
            await stepBack(tp, root)
            await tp.waitForSelector(`${col(0)} .tool[data-tool="bash"]`, {
              timeout: 15_000,
            })
          }
          const recorded = () =>
            tp.evaluate(() => {
              const w = window as unknown as {
                __rows: string[]
                __rowsWatch: MutationObserver
              }
              w.__rowsWatch.disconnect()
              return w.__rows
            })
          await away()
          const line = await tp
            .$eval(
              `${col(0)} .working-line`,
              l => getComputedStyle(l).visibility,
            )
            .catch(() => "none")
          // Nothing unsets a ring, so the again row's first record is the
          // claim: read once it is drawn.
          await tp
            .waitForSelector(
              `${col(0)} .tool.live:has-text("pinetrie-gate-again")`,
              { timeout: 15_000 },
            )
            .catch(() => null)
          const mounted = await recorded()
          const sizeOf = async (row: typeof ticked) =>
            (await row.count()) === 1
              ? (await row.getAttribute("data-open")) === null
                ? "summary"
                : "detail"
              : "missing"
          await inThreadLane(tp, gateClose(running))
          await toolIdle()
          await away()
          await twoFrames(tp)
          const done = await recorded()
          const again = tp
            .locator(`${col(0)} .tool[data-tool="bash"]`)
            .filter({ hasText: "pinetrie-gate-again" })
          const after = {
            again: await sizeOf(again),
            ticked: await sizeOf(ticked),
            stepped: await sizeOf(stepped),
          }
          // Fold the opened one again, so the checks below see the column they expect.
          if (after.ticked === "detail")
            await ticked.locator(".tool-more").click()
          check(
            "a tab shown again draws each tool row as it was left: a running one ringed from its first frame, the line hidden, and its reader's choice of detail or summary kept",
            opened &&
              mounted.filter(r => r.includes(":again:")).join() ===
                "added:again:live:summary:revealed" &&
              line === "hidden" &&
              done.every(r => r.startsWith("added:")) &&
              after.again === "summary" &&
              after.ticked === "detail" &&
              after.stepped === "summary",
            `${JSON.stringify({ mounted, line, done, after })}`,
          )
        }

        // While the lane runs, its header's mark pulses and a line at the
        // column's end says more is coming. It takes no height, and stays the
        // content's last child with a card queued: the queue is in the dock,
        // below the thread.
        {
          const thinking = script.hold("think a while")
          script.use([{ text: "thought" }, { text: "after the thought" }])
          await say("think a while")
          const star = `${col(0)} .column-head .agent-name .thread-mark`
          const pulsing = await appears(`${star}.pulse`, 10_000)
          const starShows = await tp
            .$eval(star, s => ({
              animation: getComputedStyle(s).animationName,
              title: s.getAttribute("title"),
            }))
            .catch(() => null)
          /** Where accepted work is, and what the content's height is with and without it. */
          const lineShows = () =>
            tp.$eval(`${col(0)} .column-content`, c => {
              const line = c.querySelector(".working-line")
              if (!(c instanceof HTMLElement) || !(line instanceof HTMLElement))
                return null
              const prev = line.previousElementSibling
              const next = line.nextElementSibling
              if (prev === null) return null
              const rem = Number.parseFloat(
                getComputedStyle(document.documentElement).fontSize,
              )
              const r = line.getBoundingClientRect()
              const box = c.getBoundingClientRect()
              const gapTop = prev.getBoundingClientRect().bottom
              const gapBottom =
                next?.getBoundingClientRect().top ??
                gapTop + Number.parseFloat(getComputedStyle(prev).marginBottom)
              const withLine = c.offsetHeight
              line.style.display = "none"
              const without = c.offsetHeight
              line.style.display = ""
              return {
                visible: getComputedStyle(line).visibility === "visible",
                next: next?.className ?? null,
                offCentre: Math.abs(
                  (r.left + r.right) / 2 - (box.left + box.right) / 2,
                ),
                inGap: r.top >= gapTop - 1 && r.bottom <= gapBottom + 1,
                gap: (gapBottom - gapTop) / rem,
                grows: withLine - without,
              }
            })
          await waitFor(() => thinking.reached)
          await twoFrames(tp)
          const last = await lineShows()
          // A message sent now is a card queued behind the paused run, in the
          // dock.
          await say("wait behind it")
          const queuedInDock = await appears(
            `${col(0)} .dock .card-editor.queued`,
            10_000,
          )
          await twoFrames(tp)
          const above = await lineShows()
          thinking.finish()
          await toolIdle()
          await twoFrames(tp)
          const ended = {
            pulsing: await tp.locator(`${star}.pulse`).count(),
            line: await tp.locator(`${col(0)} .working-line`).count(),
          }
          check(
            "the header's mark pulses while the agent works, and stops when it ends",
            pulsing &&
              starShows?.animation === "pulse-mark" &&
              // It names the ask it works on.
              starShows.title?.startsWith(`${workingWords(true, null)} on `) ===
                true &&
              ended.pulsing === 0,
            `${JSON.stringify({ starShows, ended })}`,
          )
          const placed = (l: Awaited<ReturnType<typeof lineShows>>) =>
            l?.visible === true &&
            l.offCentre <= 1 &&
            l.inGap &&
            Math.abs(l.grows) <= 0.5
          check(
            "while the agent works, a line pulses at the column's end, centred, above what waits, and takes no height",
            placed(last) &&
              last?.next === null &&
              placed(above) &&
              above?.next === null &&
              queuedInDock &&
              ended.line === 0,
            `${JSON.stringify({ last, above, ended })}`,
          )
        }

        // A command the work opened is outlined while it runs, shows how long
        // it has run, and the line hides. Until it has run `REVEAL_MS` it does
        // none of it: its row's first frame, recorded as it is added, is what
        // a call that ends sooner shows for its whole life.
        {
          await tp.evaluate(c => {
            const w = window as unknown as {
              __firstFrame: {
                line: boolean
                lineVisible: boolean
                outlined: boolean
                timed: boolean
              } | null
              __firstWatch: MutationObserver
            }
            w.__firstFrame = null
            w.__firstWatch = new MutationObserver(() => {
              const row = document.querySelector(`${c} .tool.live`)
              if (w.__firstFrame !== null || row === null) return
              const line = document.querySelector(`${c} .working-line`)
              w.__firstFrame = {
                line: line !== null,
                lineVisible:
                  line !== null &&
                  getComputedStyle(line).visibility === "visible",
                outlined: getComputedStyle(row, "::after").content !== "none",
                timed: row.querySelector(".tool-elapsed") !== null,
              }
              w.__firstWatch.disconnect()
            })
            w.__firstWatch.observe(document.body, {
              subtree: true,
              childList: true,
            })
          }, col(0))
          const held = newGate("ring")
          script.use([
            { tool: "bash", args: { command: gateCommand(held) } },
            { text: "held" },
          ])
          await say("hold on to it")
          const revealed = `${col(0)} .tool.live[data-revealed]`
          const outlined = await appears(revealed, 10_000)
          const first = await tp.evaluate(
            () =>
              (
                window as unknown as {
                  __firstFrame: {
                    line: boolean
                    lineVisible: boolean
                    outlined: boolean
                    timed: boolean
                  } | null
                }
              ).__firstFrame,
          )
          await twoFrames(tp)
          const slow = await tp
            .$eval(
              revealed,
              (row, c) => {
                const line = document.querySelector(`${c} .working-line`)
                const s = getComputedStyle(row, "::after")
                // The ring's box, from the row's and its resolved insets, against
                // the column's: as far from its right edge as from its left.
                const r = row.getBoundingClientRect()
                // Its inner box: a classic scrollbar is not the column's edge,
                // and the Mac's overlay one takes no width.
                const scroller = row.closest(".column-body")
                const box = scroller?.getBoundingClientRect()
                const body =
                  scroller === null ||
                  scroller === undefined ||
                  box === undefined
                    ? undefined
                    : {
                        left: box.left + scroller.clientLeft,
                        right:
                          box.left + scroller.clientLeft + scroller.clientWidth,
                      }
                const left = r.left + Number.parseFloat(s.left)
                const right = r.right - Number.parseFloat(s.right)
                return {
                  outline: s.borderTopStyle,
                  colour: s.borderTopColor,
                  line:
                    line === null ? null : getComputedStyle(line).visibility,
                  margins:
                    body === undefined
                      ? null
                      : { left: left - body.left, right: body.right - right },
                  // The row itself: its contents reach as far right as left.
                  row:
                    body === undefined
                      ? null
                      : {
                          left: r.left - body.left,
                          right: body.right - r.right,
                        },
                  // The ring, as far outside the row on each side.
                  insets: [s.top, s.right, s.bottom, s.left].map(v =>
                    Number.parseFloat(v),
                  ),
                }
              },
              col(0),
            )
            .catch(() => null)
          // How long it has run, then again once it has counted on.
          const elapsedNow = () =>
            tp
              .$eval(`${revealed} .tool-head .tool-elapsed`, e => e.textContent)
              .catch(() => null)
          const firstTime = await elapsedNow()
          await waitFor(async () => (await elapsedNow()) !== firstTime, 3_000)
          const laterTime = await elapsedNow()
          await inThreadLane(tp, gateClose(held))
          await toolIdle()
          check(
            "a running command the work opened is outlined, the row and its ring centred in its column, and hides the line; one not yet ringed does neither",
            outlined &&
              slow?.outline === "solid" &&
              slow.colour !== "rgba(0, 0, 0, 0)" &&
              slow.line === "hidden" &&
              slow.margins !== null &&
              Math.abs(slow.margins.left - slow.margins.right) <= 1 &&
              slow.row !== null &&
              Math.abs(slow.row.left - slow.row.right) <= 1 &&
              new Set(slow.insets).size === 1 &&
              first?.line === true &&
              first.lineVisible &&
              !first.outlined,
            `${JSON.stringify({ slow, first })}`,
          )
          const seconds = (t: string | null) =>
            t === null ? Number.NaN : Number.parseInt(t, 10)
          check(
            "a running command the work opened shows how long it has run, counting up; one not yet ringed never shows it",
            /^\d+s$/.test(firstTime ?? "") &&
              /^\d+s$/.test(laterTime ?? "") &&
              seconds(laterTime) > seconds(firstTime) &&
              first !== null &&
              !first.timed,
            `${JSON.stringify({ firstTime, laterTime, first })}`,
          )
        }

        // A shell row's tag is its tool's word, with its status at its top
        // right, and a long one-line chain is laid out, a step a
        // line, each step's command marked. Seven steps are more than a
        // summary shows: its detail shows them all.
        {
          const STEPS = [
            "mkdir -p /tmp/chain",
            "cd /tmp/chain",
            "touch a",
            "ls -la",
            "cat a",
            "wc -c a",
            "echo done",
          ]
          script.use([
            { tool: "bash", args: { command: STEPS.join(" && ") } },
            { text: "chained" },
          ])
          await say("chain some steps")
          await toolIdle()
          const chained = `${col(0)} .tool[data-tool="bash"][data-status="ok"]:has-text("mkdir -p /tmp/chain")`
          await appears(chained, 10_000)
          const row = tp.locator(chained).last()
          await row
            .locator(".tool-more")
            .click({ timeout: 5_000 })
            .catch(() => {})
          const seen = await row.evaluate(r => {
            const box = r.getBoundingClientRect()
            const tag = r.querySelector(".tool-head .tool-tag")
            const status = r.querySelector(".tool-head .tool-status")
            const command = r.querySelector(".tool-command")
            return {
              tag: tag?.textContent ?? "",
              status: status?.textContent ?? "",
              // The status ends the row's top line, and the command's first
              // line runs beside the head, not below it.
              right: box.right - (status?.getBoundingClientRect().right ?? 0),
              top: (tag?.getBoundingClientRect().top ?? 0) - box.top,
              beside:
                (command?.getBoundingClientRect().top ?? box.bottom) - box.top,
              lines:
                command instanceof HTMLElement
                  ? command.innerText.split("\n").length
                  : 0,
              commands: [
                ...r.querySelectorAll(".tool-command .sh-command"),
              ].map(c => c.textContent ?? ""),
            }
          })
          await row
            .locator(".tool-more")
            .click({ timeout: 5_000 })
            .catch(() => {})
          check(
            "a shell row's tag and status sit at its top right, and its command, opened, is laid out a step a line, its command names marked",
            seen.tag === toolWord("bash") &&
              seen.status === "✓" &&
              Math.abs(seen.right) <= 2 &&
              Math.abs(seen.top) <= 2 &&
              Math.abs(seen.beside) <= 2 &&
              seen.lines === STEPS.length &&
              STEPS.every(step =>
                seen.commands.includes(step.split(" ")[0] ?? ""),
              ),
            JSON.stringify(seen),
          )
        }

        // ── the agent's column, frame by frame, while it works ────────────────
        // At 20× CPU throttle every render is painted, as in a long session, so
        // a render that disagrees with the document would be seen here.
        {
          const bodyOf = `${col(0)} .column-body`
          await tp.$eval(bodyOf, b => {
            b.scrollTop = b.scrollHeight
          })
          // Six steps, each fed once the one before it is drawn.
          const stepping = newGate("tests")
          const COMMAND = gateCommand(stepping)
          script.use([
            {
              text: "Now the tests for this, which take a moment.",
              tool: "bash",
              args: { command: COMMAND },
            },
            { text: "They passed: every step printed, and nothing failed." },
          ])
          const cdp = await tp.context().newCDPSession(tp)
          const stop = await recordFrames(tp, col(0))
          await cdp.send("Emulation.setCPUThrottlingRate", { rate: 20 })
          await say("run the tests")
          await tp
            .waitForSelector(`${col(0)} .tool.live`, { timeout: 30_000 })
            .catch(() => null)
          for (const step of ["a", "b", "c", "d", "e", "f"]) {
            await inThreadLane(tp, gateFeed(stepping, [`step ${step}`]))
            await tp
              .waitForFunction(
                ([c, line]) =>
                  document
                    .querySelector(`${c} .tool.live .tool-output`)
                    ?.textContent?.includes(line) === true,
                [col(0), `step ${step}`] as const,
                { timeout: 30_000 },
              )
              .catch(() => null)
          }
          await inThreadLane(tp, gateClose(stepping))
          await toolIdle()
          await tp.waitForSelector(`${col(0)} .stop`, {
            state: "detached",
            timeout: 30_000,
          })
          await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 })
          const frames = await stop()
          await cdp.detach()
          const during = frames.filter(f => f.running)
          const drops = frames.flatMap((f, i) => {
            const before = frames[i - 1]
            return before !== undefined && f.steps < before.steps
              ? [`${before.steps}→${f.steps}`]
              : []
          })
          const scrolls = during.some(f => f.height > f.clientHeight)
          check(
            "the column was sampled through the run, taller than its view",
            during.length > 10 && scrolls,
            `${during.length} frames`,
          )
          const chips = frames[0]?.chips ?? 0
          check(
            "no branch chip is painted in the agent's column while it works",
            frames.every(f => f.chips === chips),
            `${frames.filter(f => f.chips !== chips).length} frames`,
          )
          check(
            "the agent's step is never missing from its column: the entry replaces its stream in one frame",
            drops.length === 0,
            `${drops.join(" ") || "no drops"}`,
          )
          // That a following column never gets shorter while its agent works
          // is the floor's: `follow.ts`'s unit tests decide it, and the check
          // of a row folded while its agent works proves the page sets it.
          // A running command's label shows once: its row draws its stream
          // (`ToolRow`), so nothing else draws the call.
        }

        // A command that never ends on its own: only Stop ends it.
        script.use([
          { tool: "bash", args: { command: gateCommand(newGate("held")) } },
          { text: "after" },
        ])
        await say("hold it")
        // As a person does: stop the command once it is seen running.
        await appears(`${col(0)} .tool.live`)
        const stopShown = await appears(`${col(0)} .stop`)
        if (stopShown) await tp.click(`${col(0)} .stop`)
        const failed = `${col(0)} .tool[data-tool="bash"][data-status="error"]`
        const ended = await appears(failed, 10_000)
        const why = await tp
          .textContent(`${failed} .tool-output`)
          .catch(() => "")
        check(
          'Stop ends a running command, shown as ✗ "Command aborted"',
          stopShown &&
            ended &&
            (await tp.textContent(`${failed} .tool-status`)) === "✗" &&
            why?.includes("aborted") === true,
          `${why?.slice(-16) ?? "none"}`,
        )
        await toolIdle()

        // ── commands: found as you type, sent in full ────────────────────────
        await tp.fill(`${col(0)} .composer .input`, "/hel")
        const commandOffered = await appears(
          `${col(0)} .command-menu [data-option="/fixture:skill:hello"]`,
        )
        await tp.press(`${col(0)} .composer .input`, "Tab")
        const inserted = await tp.inputValue(`${col(0)} .composer .input`)
        script.use([{ text: "hello back" }])
        await tp.press(`${col(0)} .composer .input`, "Enter")
        const labelled = await appears(
          `${col(0)} .msg .command-label:has-text("/fixture:skill:hello")`,
        )
        await toolIdle()
        check(
          "typing /hel offers /fixture:skill:hello; Tab inserts it, and the sent message shows it",
          commandOffered && inserted === "/fixture:skill:hello " && labelled,
          `${inserted}`,
        )

        // ── a column keeps its width, whatever its content ───────────────────
        script.use([
          {
            text: `\`\`\`\n${"x".repeat(150)}\n\`\`\``,
            tool: "read",
            args: { path: `${"y".repeat(100)}.txt` },
          },
          { text: "wide" },
        ])
        await say("something wide")
        await appears(
          `${col(0)} .tool[data-tool="read"] .tool-command:has-text("yyy")`,
        )
        await toolIdle()
        const widths = await tp.$eval(`${col(0)} .column-thread`, c => {
          const body = c.querySelector(".column-body")
          const rem = Number.parseFloat(
            getComputedStyle(document.documentElement).fontSize,
          )
          return {
            column: Math.round(c.getBoundingClientRect().width),
            basis: Math.round(28 * rem),
            overflow: body === null ? -1 : body.scrollWidth - body.clientWidth,
          }
        })
        check(
          "a long code line and a long tool label leave the column at 28rem, with nothing past its side",
          widths.column === widths.basis && widths.overflow === 0,
          `${JSON.stringify(widths)}`,
        )

        // ── the thread's name in its header, and its proposed changes at its
        // foot ────── The name is as the host stored it.
        const nameText = await tp.textContent(
          `${col(0)} .column-head .agent-name`,
        )
        const threadName = await tp.getAttribute(
          `${col(0)} .column-head .agent-name`,
          "data-thread",
        )
        // Under the default icon source, built-in: the name's noun's icon,
        // loaded, unblended, over the star.
        const icon = await tp
          .waitForFunction(
            sel => {
              const img = document.querySelector(
                `${sel} .column-head .agent-name .thread-mark img[data-kind="built-in"]`,
              )
              return img instanceof HTMLImageElement &&
                img.complete &&
                img.naturalWidth > 0
                ? {
                    src: img.getAttribute("src"),
                    natural: img.naturalWidth,
                    blend: getComputedStyle(img).mixBlendMode,
                  }
                : null
            },
            col(0),
            { timeout: 10_000 },
          )
          .then(
            h => h.jsonValue(),
            () => null,
          )
        const noun =
          threadName === null ? undefined : threadNameParts(threadName)?.noun
        check(
          "the column's header names the thread, its noun's built-in icon unblended in the star's square",
          threadName !== null &&
            [...readNames(toolHost.session).values()].includes(
              threadName as ThreadName,
            ) &&
            nameText === `✦ ${threadName}` &&
            icon !== null &&
            noun !== undefined &&
            icon.src === builtInIconUrl(noun) &&
            icon.natural === 32 &&
            icon.blend === "normal",
          `${nameText} ${JSON.stringify(icon)}`,
        )
        const longLane = Array.from({ length: 300 }, (_, i) => `line ${i}\n`)
        script.use([
          { tool: "write", args: { path: "from-lane.txt", content: "lane\n" } },
          {
            tool: "write",
            args: { path: "long-lane.txt", content: longLane.join("") },
          },
          { text: "written" },
        ])
        await say("write two files")
        await toolIdle()
        const acceptShown = await appears(
          `${col(0)} .work.work-strip[data-state="ready"] .work-accept`,
        )
        const line =
          (await tp
            .textContent(`${col(0)} .work .work-line`)
            .catch(() => "")) ?? ""
        const bookmark =
          (await tp
            .textContent(`${col(0)} .work .work-bookmark`)
            .catch(() => "")) ?? ""

        // ── the review, beside the thread ────────────────────────────────────
        {
          // Once described: describing rewrites the proposed changes' commit,
          // and the review would read the new one mid-check.
          await waitFor(
            () =>
              [...readJjProposedByLane(toolHost.session).values()].some(
                o => o.acceptedAs === null && o.described,
              ),
            15_000,
          )
          const review = `${col(0)} .review`
          const section = (file: string) =>
            `${review} .review-file[data-key$=":${file}"]`
          await tp.click(`${col(0)} .work .work-line`).catch(() => {})
          const opened = await appears(`${review} .review-list-file`)
          const threadWidth = await tp
            .$eval(`${col(0)} .column-thread`, t => {
              const rem = Number.parseFloat(
                getComputedStyle(document.documentElement).fontSize,
              )
              return (
                Math.round(t.getBoundingClientRect().width) ===
                Math.round(28 * rem)
              )
            })
            .catch(() => false)
          const rows = await tp.locator(`${review} .review-list-file`).count()
          const diffShown = await appears(
            `${section("from-lane.txt")}[data-letter="A"][data-state="shown"] [data-kind="add"]:text-is("+lane")`,
          )
          check(
            "the proposed changes' line opens its review beside the thread, which keeps its 28rem: a row per file, and a file's diff",
            opened && threadWidth && rows === 2 && diffShown,
            `opened ${opened}, thread 28rem ${threadWidth}, rows ${rows}, diff ${diffShown}`,
          )
          // What only typing changes redraws no part of the review.
          await appears(`${section("long-lane.txt")}[data-state="shown"]`)
          await componentRenders(tp)
          await tp.click(`${col(0)} .composer .input`)
          await tp.keyboard.type("typed beside a review", { delay: 60 })
          const typedBeside = (await componentRenders(tp)).filter(
            r => r.name === "ReviewPaneView" || r.name === "ReviewFileView",
          )
          await tp.fill(`${col(0)} .composer .input`, "")
          check(
            "typing beside an open review redraws none of it",
            opened && typedBeside.length === 0,
            `${typedBeside.map(r => r.name).join(", ")}`,
          )
          // A file's head stays at the top while its diff scrolls under it, and
          // the list brings a file's head to the top.
          const headAtTop = (file: string) =>
            tp
              .$eval(
                `${section(file)} .review-file-head`,
                (h, box) => {
                  const top = document
                    .querySelector(box)
                    ?.getBoundingClientRect().top
                  return (
                    top !== undefined &&
                    Math.abs(h.getBoundingClientRect().top - top) <= 1
                  )
                },
                `${review} .review-diffs`,
              )
              .catch(() => false)
          await tp
            .$eval(
              section("long-lane.txt"),
              (s, box) => {
                const scroller = document.querySelector(box)
                if (scroller === null) return
                const offset =
                  s.getBoundingClientRect().top -
                  scroller.getBoundingClientRect().top
                scroller.scrollTop +=
                  offset + s.getBoundingClientRect().height / 2
              },
              `${review} .review-diffs`,
            )
            .catch(() => {})
          const pinned =
            (await waitFor(() => headAtTop("long-lane.txt"), 5_000)) >= 0
          await tp
            .click(`${review} .review-list-file[title="from-lane.txt"]`, {
              timeout: 5_000,
            })
            .catch(() => {})
          const listJumped =
            (await waitFor(() => headAtTop("from-lane.txt"), 5_000)) >= 0
          check(
            "a file's head stays pinned while its diff scrolls, and the list brings a file to the top",
            pinned && listJumped,
            `pinned ${pinned}, jumped ${listJumped}`,
          )
          await tp
            .click(`${col(0)} > .pane .pane-close`, { timeout: 5_000 })
            .catch(() => {})
          const closed = await appears(`${col(0)}:not(:has(.review))`, 5_000)
          if (acceptShown) await tp.click(`${col(0)} .work .work-accept`)
          // The acceptance moves accepted work forward to the proposed changes.
          const onAccepted = () =>
            command("jj", [
              "-R",
              work,
              "file",
              "list",
              "-r",
              "pinetrie-accepted",
              'root:"from-lane.txt"',
            ]).then(
              out => out.includes("from-lane.txt"),
              () => false,
            )
          const accepted =
            (await waitFor(onAccepted, 10_000)) >= 0 &&
            !existsSync(path.join(work, "from-lane.txt"))
          check(
            "the column's foot shows the thread's proposed changes in words, its bookmark apart, and its add button moves accepted work to it, leaving your working copy",
            acceptShown &&
              bookmark.startsWith("pinetrie-proposed/") &&
              !line.includes("`") &&
              accepted,
            `${line} · ${bookmark}`,
          )
          const settled = await tp
            .waitForFunction(
              sel => {
                const l = document.querySelector(sel)
                return l !== null && l.tagName !== "BUTTON"
              },
              `${col(0)} .work .work-line`,
              { timeout: 10_000 },
            )
            .then(
              () => true,
              () => false,
            )
          const noReview = (await tp.$(review)) === null
          check(
            "the review closes, and after the acceptance there is none to open",
            closed && settled && noReview,
            `closed ${closed}, line not a button ${settled}, no review ${noReview}`,
          )
        }

        // ── markdown: drawn ───────────────────────────────────────────────────
        const REPLY = [
          "Plain **bold** here.",
          "",
          "A first line,",
          "and a second.",
          "",
          "```sh",
          "echo hi",
          "```",
          "",
          "| a | b |",
          "|---|---|",
          "| 1 | 2 |",
          "",
          "<script>alert(1)</script>",
          "",
          "[x](javascript:alert(1))",
        ].join("\n")
        script.use([{ text: REPLY }])
        await say("show me markdown")
        await toolIdle()
        const drawn = `${col(0)} .msg[data-entry]:has(> .text strong)`
        await appears(drawn)
        const replyId =
          (await tp.locator(drawn).last().getAttribute("data-entry")) ?? ""
        const reply = `.msg[data-entry="${replyId}"]`
        // A soft break shows, as people type them. (So a triple-click there
        // selects one line: Chrome ends a paragraph at a shown newline.)
        const lines = `${reply} > .text p:nth-of-type(2)`
        const twoLines = await tp
          .$eval(lines, p => (p as HTMLElement).innerText)
          .catch(() => "")
        check(
          "a reply's markdown is drawn: bold, a code block, a table, and its soft break",
          (await tp.locator(`${reply} > .text pre code`).count()) === 1 &&
            (await tp.locator(`${reply} > .text table`).count()) === 1 &&
            twoLines === "A first line,\nand a second.",
          `${JSON.stringify(twoLines)}`,
        )

        // ── a column follows its end, until the reader scrolls up ──────────────
        const body = (n: number) => `${col(n)} .column-body`
        const gapOf = (n: number) =>
          tp.$eval(body(n), b => b.scrollHeight - b.scrollTop - b.clientHeight)
        /**
         * Turn the wheel over column 0 by `dy`, and wait until its scroll has
         * moved and holds across a frame: the scroll lands frames after the
         * wheel's event. A column that ignores the wheel times out here, and
         * its check fails on what it reads next.
         */
        const wheelColumn = async (dy: number) => {
          const top = () => tp.$eval(body(0), b => b.scrollTop)
          const from = await top()
          await tp.hover(body(0))
          await tp.mouse.wheel(0, dy)
          let last = from
          await waitFor(async () => {
            await oneFrame(tp)
            const now = await top()
            const settled = now !== from && now === last
            last = now
            return settled
          }, 2_000)
        }
        const streamHeight = () =>
          tp
            .$eval(
              `${col(0)} .streaming`,
              s => s.getBoundingClientRect().height,
            )
            .catch(() => 0)
        /** Column 0's reply holds what `held` has released, whitespace aside. */
        const releasedDrawn = (held: Held) =>
          tp
            .waitForFunction(
              ([c, tail]) =>
                (document.querySelector(`${c} .streaming`)?.textContent ?? "")
                  .replace(/\s+/g, "")
                  .endsWith(tail),
              [col(0), held.released.replace(/\s+/g, "").slice(-12)] as const,
              { timeout: 10_000 },
            )
            .catch(() => null)
        /**
         * Release `held` a delta at a time, until `enough` or its end, and
         * after each is drawn and a frame has passed, take column 0's gap to
         * its end.
         */
        const stepReply = async (
          held: Held,
          enough: () => Promise<boolean> = async () => false,
        ) => {
          const gaps: number[] = []
          let tallest = 0
          while (!(await enough()) && (await held.next())) {
            await releasedDrawn(held)
            await oneFrame(tp)
            tallest = Math.max(tallest, await streamHeight())
            gaps.push(Math.round(await gapOf(0)))
          }
          return { gaps, tallest }
        }
        const LONG = Array.from(
          { length: 40 },
          (_, i) => `Line ${i + 1} of a long reply.`,
        ).join("\n\n")

        const firstLong = script.hold("a long one")
        script.use([{ text: LONG }])
        await say("a long one")
        await waitFor(() => firstLong.reached, 10_000)
        const followed = await stepReply(firstLong)
        await toolIdle()
        check(
          "a column at its end follows a reply as it is written",
          followed.gaps.length >= 3 &&
            followed.tallest >= 300 &&
            followed.gaps.every(g => g < 80),
          `gaps ${followed.gaps.join(" ")}; reply ${Math.round(followed.tallest)}px`,
        )

        // Held between deltas, so nothing grows under the wheel.
        const secondLong = script.hold("another long one")
        script.use([{ text: LONG }])
        await say("another long one")
        await waitFor(() => secondLong.reached, 10_000)
        await stepReply(secondLong, async () => (await streamHeight()) > 100)
        await wheelColumn(-10)
        const heldAt = await tp.$eval(body(0), b => b.scrollTop)
        const grownFrom = await streamHeight()
        await stepReply(
          secondLong,
          async () => (await streamHeight()) > grownFrom + 200,
        )
        const heldTo = await tp.$eval(body(0), b => b.scrollTop)
        const offered = await appears(`${col(0)} .jump-latest`, 2_000)
        if (offered) await tp.click(`${col(0)} .jump-latest`)
        await oneFrame(tp)
        const jumped = await gapOf(0)
        const gone = (await tp.locator(`${col(0)} .jump-latest`).count()) === 0
        const after = await stepReply(secondLong)
        await toolIdle()
        check(
          "a small scroll up holds the column still while the reply is written, and ↓ new below is the way back",
          Math.abs(heldTo - heldAt) <= 1 &&
            offered &&
            jumped <= 2 &&
            gone &&
            after.gaps.every(g => g < 80),
          `held ${Math.round(heldAt)}→${Math.round(heldTo)}, offered ${offered}, gap after ${Math.round(jumped)}, then ${after.gaps.join(" ")}`,
        )

        await wheelColumn(-300)
        const away = await gapOf(0)
        script.use([{ text: "short" }])
        await say("back to the end")
        await toolIdle()
        await appears(`${col(0)} ${msg("back to the end")}`)
        await oneFrame(tp)
        const back = await gapOf(0)
        check(
          "your own send brings the column back to its end",
          away > 200 && back <= 2,
          `${Math.round(away)}px away, then ${Math.round(back)}`,
        )

        // A column opened level with its fork point, and longer than it is
        // tall, keeps that place as its thread grows: it was placed short of
        // its end, so it does not follow it.
        const aligner = await join(toolHost, "aligner", "browser")
        try {
          const forkId =
            (await tp
              .locator(`${col(0)} .msg[data-entry]`)
              .nth(2)
              .getAttribute("data-entry")) ?? ""
          const lines = (n: number) =>
            `Branch message ${n}.\nIts second line.\nIts third line.`
          const first = await aligner.send(lines(0), atEntry(entryId(forkId)), {
            mode: "branch",
          })
          let tip = first.kind === "appended" ? first.id : null
          for (let n = 1; n <= 12 && tip !== null; n++) {
            const next = await aligner.send(lines(n), atEntry(tip))
            tip = next.kind === "appended" ? next.id : null
          }
          const fork = `${col(0)} .msg[data-entry="${forkId}"]`
          await tp.waitForSelector(`${fork} .open-branch`, { timeout: 15_000 })
          await tp.$eval(body(0), b => {
            b.scrollTop = 0
          })
          await tp.evaluate(() => document.fonts.ready)
          await tp.click(`${fork} .open-branch`)
          await tp.waitForSelector(`${col(1)} .msg`, { timeout: 15_000 })
          await oneFrame(tp)
          await oneFrame(tp)
          const level = async () => {
            const a = await tp.$eval(
              `${col(1)} .msg`,
              m => m.getBoundingClientRect().top,
            )
            const b = await tp.$eval(fork, m => m.getBoundingClientRect().top)
            return Math.abs(a - b)
          }
          const opened = await level()
          const more =
            tip === null
              ? null
              : await aligner.send("one more below", atEntry(tip))
          await tp
            .waitForSelector(
              `${col(1)} .msg[data-entry="${more?.kind === "appended" ? more.id : "none"}"]`,
              { state: "attached", timeout: 15_000 },
            )
            .catch(() => null)
          await oneFrame(tp)
          const grown = await level()
          const short = await gapOf(1)
          check(
            "an aligned column that runs past its end keeps its alignment as its thread grows",
            tip !== null && opened <= 4 && grown <= 4 && short > 100,
            `off by ${opened.toFixed(1)}, then ${grown.toFixed(1)}px; ${Math.round(short)}px above its end`,
          )
        } finally {
          await aligner.close()
        }

        // ── the agent's work, on the board ──────────────────────────────────
        // Another writer starts agent work at the root: no tab opens, the
        // strip counts it, the board rings its root though this tab does not
        // hold it, choosing the item opens it, and that root cannot be
        // archived until the agent is done.
        const starter = await join(toolHost, "starter", "browser")
        try {
          script.use([{ text: LONG }])
          await starter.send("@agent a long one elsewhere", ROOT, {
            mode: "branch",
          })
          const newRoot = heldTree(toolHost).roots.at(-1) ?? ""
          await appears("#bottom .state-working")
          const newCanvas = canvasHolding(toolHost, entryId(newRoot))
          await openBoard(tp)
          const ringed = `#board ${boardSel(newCanvas)}:has(.signal[data-signal="running"]) .board-open`
          await appears(ringed)
          await tp.click(ringed)
          await appears(
            `#sidebar .open-root[data-canvas="${newCanvas}"][aria-current="true"]`,
          )
          await seeInMenu(tp, OWN_MENU, ".move-to.closes")

          await toolIdle()
        } finally {
          await starter.close()
        }

        // ── the rail draws a long loop as one capsule ────────────────────────
        await tp.keyboard.press("Escape")
        await tp.click("#sidebar .add-canvas")
        script.use([
          ...Array.from({ length: 30 }, () => ({
            tool: "read" as const,
            args: { path: "notes.txt" },
          })),
          { tool: "read", args: { path: "missing.txt" } },
          { text: "I read it 30 times, and one file was missing." },
        ])
        await say("read notes, again and again")
        await toolIdle()
        const loopIndex = heldTree(toolHost)
        const loopRows = projectRail(
          loopIndex,
          loopIndex.roots.at(-1) ?? entryId(""),
        )
        await tp.waitForSelector(
          `${col(0)} .msg[data-entry="${loopRows.at(-1)?.id ?? "none"}"]`,
          { timeout: 15_000 },
        )
        const tall = await tp.$eval(
          body(0),
          b => b.scrollHeight > 2 * b.clientHeight,
        )
        const capsule = await tp
          .$eval(".rail .rail-stretch", r => ({
            count: Number(r.getAttribute("data-count")),
            span: Number(r.getAttribute("data-span")),
            height: r.getBoundingClientRect().height,
            label: r.getAttribute("title") ?? "",
            fill: r.getAttribute("data-fill"),
          }))
          .catch(() => null)
        const accounted = await railCount(tp)
        check(
          "a long loop is one hollow capsule on the rail, as long as its size has digits, its label counting the failed call",
          tall &&
            capsule !== null &&
            capsule.count >= 30 &&
            capsule.span === 1 + String(capsule.count).length &&
            capsule.height > 8 &&
            // Its first line counts; a digest, on by default,
            // follows on the next.
            (capsule.label.split("\n")[0] ?? "").endsWith("· 1 failed") &&
            capsule.fill === "agent" &&
            accounted === loopRows.length,
          `${capsule?.count ?? 0} messages, ${capsule?.span ?? 0} rows, ${capsule?.fill ?? "no"} fill, "${capsule?.label ?? ""}"; ${accounted} of ${loopRows.length} accounted for`,
        )

        // A capsule opens its first message in view, and the column keeps it
        // there. Its fork point is out of view in the column that shows it, so
        // aligning the new column to it alone would not show the message. The
        // aside is one message, so the preview below opens on a short path and
        // its pick scrolls down, which does not stop a column following.
        const railer = await join(toolHost, "railer", "browser")
        try {
          const say3 = (n: string) => `${n}.\nIts second line.\nIts third line.`
          const chain = async (
            from: string,
            name: string,
            n: number,
            branch: boolean,
          ) => {
            let tip = from
            for (let k = 1; k <= n; k++) {
              // A branch starts a thread of its own; the rest
              // continue it.
              const r = await railer.send(
                say3(`${name} ${k}`),
                atEntry(entryId(tip)),
                k === 1 && branch ? { mode: "branch" } : undefined,
              )
              if (r.kind !== "appended") return null
              tip = r.id
            }
            return tip
          }
          const start = await railer.send(say3("Trunk 0"), ROOT, {
            mode: "branch",
          })
          // The trunk is the first thread, which the canvas's first column
          // follows; the branches at its end are threads of their own, each
          // on a track of its own, the older, Later, first.
          const trunk =
            start.kind === "appended"
              ? await chain(start.id, "Trunk", 20, false)
              : null
          const later =
            trunk === null ? null : await chain(trunk, "Later", 30, true)
          const aside =
            trunk === null ? null : await chain(trunk, "Aside", 1, true)
          const railRoot =
            start.kind === "appended" ? start.id : entryId("none")
          // Another writer's root is not in the sidebar: open it from the board.
          await openFromBoard(tp, canvasHolding(toolHost, railRoot))
          await tp.waitForSelector(
            `${col(0)} .msg[data-entry="${aside === null ? "none" : (trunk ?? "none")}"]`,
            { timeout: 15_000 },
          )
          const rows = projectRail(heldTree(toolHost), railRoot)
          // Later's first message begins its branch, a dot of its own; its
          // capsule starts at the message after.
          const laterHead = rows.find(r => r.parentId === trunk && r.head)
          const firstLater = rows.find(r => r.parentId === laterHead?.id)
          const target = firstLater?.id ?? "none"
          /** Whether `target` is drawn whole inside its column's view, in `scope`. */
          const inView = (scope = "#strip", id = target) =>
            tp.evaluate(
              ([scope, id]) => {
                const m = document.querySelector(
                  `${scope} .msg[data-entry="${id}"]`,
                )
                const b = m?.closest(".column-body")
                if (
                  m === null ||
                  m === undefined ||
                  b === null ||
                  b === undefined
                )
                  return false
                const r = m.getBoundingClientRect()
                const v = b.getBoundingClientRect()
                return r.top >= v.top - 1 && r.bottom <= v.bottom + 1
              },
              [scope, id] as const,
            )
          /** A resize: a column that is still following jumps to its end. */
          const nudge = async () => {
            const size = tp.viewportSize()
            if (size !== null)
              await tp.setViewportSize({ ...size, height: size.height - 40 })
            await oneFrame(tp)
            await oneFrame(tp)
            if (size !== null) await tp.setViewportSize(size)
          }
          // The fork point, the trunk's last message, goes below the view.
          await tp.$eval(body(0), b => {
            b.scrollTop = 0
          })
          /** Click `fraction` of the way down the capsule. */
          const clickRun = async (scope: string, fraction: number) => {
            const box = await tp
              .locator(`${scope} .rail-stretch[data-entry="${target}"]`)
              .boundingBox()
            if (box !== null)
              await tp.mouse.click(
                box.x + box.width / 2,
                box.y + fraction * box.height,
              )
          }
          const before = await inView()
          // At its top: a click there opens the run's first message.
          await clickRun(".rail", 0.02)
          await tp.waitForSelector(`#strip .msg[data-entry="${target}"]`, {
            timeout: 15_000,
          })
          await oneFrame(tp)
          const shownAtOnce = await inView()
          await nudge()
          const kept = await inView()
          check(
            "a click at a capsule's top opens a column at its first message, in view, and the column keeps it there",
            later !== null && !before && shownAtOnce && kept,
            `${before}, ${shownAtOnce}, ${kept}`,
          )

          // Three quarters of the way down: the message three quarters through
          // the run, in the column now showing it, and far from the first.
          // A run's messages are consecutive rows.
          const count = Number(
            await tp.getAttribute(
              `.rail .rail-stretch[data-entry="${target}"]`,
              "data-count",
            ),
          )
          const at = rows.findIndex(r => r.id === target)
          const members = at < 0 ? [] : rows.slice(at, at + count)
          const three = members[Math.floor(0.75 * members.length)]?.id ?? "none"
          await clickRun(".rail", 0.75)
          await oneFrame(tp)
          const deepShown = await inView("#strip", three)
          const firstGone = !(await inView())
          check(
            "a click lower on a capsule shows the message that far through its run",
            members.length > 20 && deepShown && firstGone,
            `${members.length} messages; ${deepShown}, ${firstGone}`,
          )
        } finally {
          await railer.close()
        }
      } finally {
        await tp.close().catch(() => {})
        await toolHost.shutdown().catch(() => {})
        // Its threads' agents worked in containers: remove them, and their disks.
        for (const lane of readLaneRecords(toolHost.session).keys())
          await removeLane(work, lane)
        rmSync(work, { recursive: true, force: true })
      }
    }
  } finally {
    await browser.close().catch(() => {})
  }
}
