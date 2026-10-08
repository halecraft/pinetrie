// e2e/browser/tools — a scripted tools host: tool rows, live output and Stop,
// where the agent will work, the column's height while it works, commands,
// widths, the thread's name and offer, the review, markdown, following, the
// header's work, and the rail's capsules; first, each ask's work folded
// and opened from the rail (ADR-0106), on a host of its own.

import { execFileSync } from "node:child_process"
import { existsSync, rmSync } from "node:fs"
import path from "node:path"
import {
  atEntry,
  entryId,
  messageText,
  projectRail,
  ROOT,
  type ThreadName,
} from "@pinetrie/core"
import { rowSummary, toolWord, workingWords } from "@pinetrie/interface"
import { scriptedModel } from "@pinetrie/pi"
import {
  readLaneRecords,
  readNames,
  readOffers,
  readPlaces,
} from "@pinetrie/reads"
import type { Checks } from "../checks.ts"
import {
  committedProject,
  idleNow,
  join,
  lanesOf,
  setUpAccepted,
  treeOf,
  waitFor,
} from "../harness.ts"
import type { LaneHosts } from "../lane-hosts.ts"
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
} from "./page.ts"

export const scenario: Scenario = {
  lanes: true,
  run: ({ check }, { lanes }) => run(check, lanes),
}

async function run(check: Checks["check"], lanes: LaneHosts): Promise<void> {
  const browser = await launchBrowser()
  try {
    // ── asks: each ask's work folds, and the rail opens it (ADR-0106) ─────
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
        await ap.click("#sidebar .add-agent")
        const say = async (text: string) => {
          await ap.fill(`${col(0)} .composer .input`, text)
          await ap.click(`${col(0)} .composer .send`)
        }
        const idle = () => waitFor(() => idleNow(askHost))
        const askId = (text: string) => {
          const index = treeOf(askHost)
          return (
            Object.values(index.entries).find(
              e => messageText(e.message) === text,
            )?.id ?? ""
          )
        }
        /** Eight reads, a command that waits, then a reply: a run long enough to watch. */
        const longRun = (reply: string) =>
          script.use([
            ...Array.from({ length: 8 }, () => ({
              tool: "read" as const,
              args: { path: "notes.txt" },
            })),
            { tool: "bash", args: { command: "sleep 2; echo waited" } },
            { text: reply },
          ])
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
        longRun("Read it eight times.")
        await say("read the notes, slowly")
        await ap.waitForSelector(`${col(0)} .tool.live`, { timeout: 15_000 })
        const first = askId("read the notes, slowly")
        const work1 = `${col(0)} .ask-work[data-ask-of="${first}"]`
        const openWhileRunning = (await ap.$(`${work1}[data-open]`)) !== null
        const running = await scroll()
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
        longRun("Read it again.")
        await say("read them once more")
        // The command that waits, live: every read before it is drawn, so
        // the scroll below lands inside the ask's work, as a lane's start
        // can hold the reads back (ADR-0102).
        await ap.waitForSelector(`${col(0)} .tool.live:has-text("sleep")`, {
          timeout: 15_000,
        })
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
        const lane = lanesOf(
          askHost,
          treeOf(askHost),
          readPlaces(askHost.places),
        )[0]
        await bo.chat(
          "@agent anything new?",
          atEntry(entryId(lane?.tip ?? "")),
          {
            lane: lane?.name,
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

        // 6. A column's density is kept with it across a reload.
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
        // The root's document arrives after the stored layout is drawn (ADR-0063).
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

    {
      const work = committedProject("pinetrie-browser-tools-", {
        "notes.txt": "the secret word is MANGO\n",
      })
      // Slow enough that a reply is seen while it is still being written.
      const script = scriptedModel({ tokensPerSecond: 60 })
      const toolHost = await lanes.startHost({
        model: { kind: "scripted", script },
        project: { dir: work, tools: true },
        // A fixture pi directory, for commands (ADR-0036).
        agentDir: path.join(
          import.meta.dirname,
          "../../../../packages/pi/fixtures/pi-agent",
        ),
        log: () => {},
      })
      // A new thread of its own starts at accepted work (ADR-0104).
      {
        const owner = await join(toolHost, "owner", "tools")
        await setUpAccepted(toolHost.session, owner)
        await owner.close()
      }
      const tp = await browser.newPage({ viewport: PANE_VIEWPORT })
      await asPerson(tp, "tools@browser.test", "Tess")
      try {
        await tp.goto(toolHost.httpUrl, { waitUntil: "domcontentloaded" })
        await tp.click("#sidebar .add-agent")
        const say = async (text: string) => {
          await tp.fill(`${col(0)} .composer .input`, text)
          await tp.click(`${col(0)} .composer .send`)
          await readRaw(tp)
        }
        const toolIdle = () => waitFor(() => idleNow(toolHost))
        const appears = (sel: string, timeout = 20_000) =>
          tp.waitForSelector(sel, { timeout }).then(
            () => true,
            () => false,
          )
        /**
         * Open a closed tool row, as a reader does, so its output is drawn. A
         * row the work opened is left as it is: a click would show it whole.
         */
        const openRow = async (sel: string) => {
          if ((await tp.getAttribute(sel, "open").catch(() => "")) === null)
            await tp.click(`${sel} summary`)
        }

        // ── what a new thread starts from, said before sending (ADR-0104) ───
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
          execFileSync("jj", ["--no-pager", "-R", work, ...args], {
            stdio: "pipe",
          })
        await tp.fill(`${col(0)} .composer .input`, "what is in notes?")
        {
          const noLine = (await tp.$(startLine)) === null
          inWork("new", "--no-edit", "pinetrie-accepted", "-m", "wip e2e")
          inWork(
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
          inWork("abandon", "wip/e2e")
          inWork("bookmark", "delete", "wip/e2e")
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
        await say("what is in notes?")
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
        const row = `${col(0)} .tool[data-tool="read"][data-status="ok"]`
        const shown = await appears(row)
        await toolIdle()
        await tp.textContent(`${row} .tool-label`).catch(() => "")
        if (shown) await openRow(row)
        await tp.textContent(`${row} .tool-output`).catch(() => "")

        // A command that ends within REVEAL_MS never opens its row: a
        // MutationObserver records any bash row that is ever open.
        await tp.evaluate(c => {
          const w = window as unknown as {
            __opened: string[]
            __openedWatch: MutationObserver
          }
          w.__opened = []
          const look = (el: Element) => {
            for (const row of [el, ...el.querySelectorAll(".tool")])
              if (row.matches('.tool[data-tool="bash"][open]'))
                w.__opened.push(row.textContent ?? "")
          }
          w.__openedWatch = new MutationObserver(records => {
            for (const r of records) {
              if (r.target instanceof Element) look(r.target)
              for (const n of r.addedNodes) if (n instanceof Element) look(n)
            }
          })
          const column = document.querySelector(c)
          if (column !== null)
            w.__openedWatch.observe(column, {
              subtree: true,
              childList: true,
              attributes: true,
              attributeFilter: ["open"],
            })
        }, col(0))
        script.use([
          { tool: "bash", args: { command: "echo quick" } },
          { text: "quick" },
        ])
        await say("quick")
        await toolIdle()
        const quick = `${col(0)} .tool[data-tool="bash"][data-status="ok"]`
        const quickShown = await appears(quick, 10_000)
        const everOpened = await tp.evaluate(() => {
          const w = window as unknown as {
            __opened: string[]
            __openedWatch: MutationObserver
          }
          w.__openedWatch.disconnect()
          return w.__opened
        })
        check(
          "a command that ends within half a second never opens its row",
          quickShown && everOpened.length === 0,
          `${everOpened.length} opened`,
        )

        script.use([
          {
            tool: "bash",
            args: {
              command:
                "for i in 1 2 3 4 5 6 7 8; do echo tick $i; seq 1 4; sleep 0.25; done",
            },
          },
          { text: "ticked" },
        ])
        await say("tick")
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
        // The reader scrolls the live output up: the result, drawn in the same
        // element, keeps that place.
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
        await tp
          .$eval(`${col(0)} .tool.live .tool-output`, o => {
            o.scrollTop = 0
          })
          .catch(() => null)
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
            open: d.hasAttribute("open"),
            size: d.getAttribute("data-size"),
            status: d.getAttribute("data-status"),
            top: out?.scrollTop ?? -1,
            scrolls: out === null ? false : out.scrollHeight > out.clientHeight,
            result: out?.textContent?.includes("tick 8") === true,
          }
        })
        check(
          "a command still running after half a second opens its row, and it stays open when it ends, where its reader scrolled it",
          !kept.live &&
            kept.open &&
            kept.size === "capped" &&
            kept.status === "ok" &&
            kept.result &&
            kept.scrolls &&
            kept.top <= 2,
          `${JSON.stringify(kept)}`,
        )

        // A row the work opened is capped; the reader's click shows it whole,
        // and a second folds it.
        {
          const LONG = "seq 1 300 | sed 's/^/line /'\nsleep 0.6"
          script.use([
            { tool: "bash", args: { command: LONG } },
            { text: "listed" },
          ])
          await say("list them")
          await toolIdle()
          const row = tp
            .locator(`${col(0)} .tool[data-tool="bash"][data-status="ok"]`)
            .last()
          await row
            .locator(".tool-output")
            .waitFor({ timeout: 10_000 })
            .catch(() => null)
          const measure = () =>
            row.evaluate(d => {
              const rem = Number.parseFloat(
                getComputedStyle(document.documentElement).fontSize,
              )
              const out = d.querySelector(".tool-output")
              return {
                size: d.getAttribute("data-size"),
                rems: d.getBoundingClientRect().height / rem,
                inner:
                  out === null ? null : out.scrollHeight - out.clientHeight,
                gap:
                  out === null
                    ? null
                    : out.scrollHeight - out.scrollTop - out.clientHeight,
              }
            })
          const capped = await measure()
          await row.locator("summary").click()
          const full = await measure()
          await row.locator("summary").click()
          const folded = await measure()
          check(
            "a row the work opens is capped, at its end, and the toggle shows it whole, then folds it",
            capped.size === "capped" &&
              capped.rems <= 17 &&
              capped.gap !== null &&
              capped.gap <= 2 &&
              full.size === "full" &&
              full.rems > 17 &&
              full.inner !== null &&
              full.inner <= 1 &&
              folded.size === "closed" &&
              folded.inner === null,
            `${JSON.stringify({ capped, full, folded })}`,
          )
        }

        // A row its reader folds while the agent works: the floor takes up
        // what it gave back, so a column at its end keeps its height. Its
        // output is short, so the floor needs less than its cap (FLOOR_MAX).
        {
          script.use([
            {
              tool: "bash",
              args: { command: "printf 'step %s\\n' a b c; sleep 3" },
            },
            { text: "stepped" },
          ])
          await say("step through")
          const running = `${col(0)} .tool.live[data-size="capped"]`
          const opened = await appears(running, 10_000)
          const summary = `${col(0)} .tool.live summary`
          const column = () =>
            tp.$eval(`${col(0)} .column-body`, b => ({
              height: b.scrollHeight,
              gap: b.scrollHeight - b.scrollTop - b.clientHeight,
              floor:
                b.querySelector(".column-floor")?.getBoundingClientRect()
                  .height ?? 0,
            }))
          if (opened) await tp.click(summary)
          await twoFrames(tp)
          const full = await column()
          if (opened) await tp.click(summary)
          await twoFrames(tp)
          const folded = await column()
          const size = await tp
            .getAttribute(`${col(0)} .tool.live`, "data-size", {
              timeout: 1_000,
            })
            .catch(() => null)
          await toolIdle()
          check(
            "a row its reader folds while its agent works leaves the column at its end, no shorter",
            opened &&
              size === "closed" &&
              folded.floor > 0 &&
              folded.height >= full.height &&
              folded.gap <= 2,
            `${JSON.stringify({ size, full, folded })}`,
          )
        }

        // A tab shown again mounts its columns anew: each row starts as it was
        // left (ADR-0049), so a running one is open from its first frame and a
        // finished one keeps its size, or its reader's choice.
        {
          script.use([
            {
              tool: "bash",
              args: {
                command:
                  "for i in $(seq 1 25); do echo again $i; sleep 0.2; done",
              },
            },
            { text: "again done" },
          ])
          const ticked = tp
            .locator(`${col(0)} .tool[data-tool="bash"]`)
            .filter({ hasText: "seq 1 4" })
          const stepped = tp
            .locator(`${col(0)} .tool[data-tool="bash"]`)
            .filter({ hasText: "step %s" })
          // The reader shows the tick command's row whole. The floor check
          // above folded the step command's.
          await ticked.locator("summary").click()
          await say("again")
          const opened = await appears(
            `${col(0)} .tool.live[data-size="capped"]`,
            10_000,
          )
          const root =
            (await tp.getAttribute(
              '#sidebar .open-root[aria-current="true"]',
              "data-root",
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
                `${how}:${row.textContent?.includes("echo again") ? "again" : "other"}:${row.classList.contains("live") ? "live" : "done"}:${row.getAttribute("data-size")}:${row.hasAttribute("data-revealed") ? "revealed" : "-"}`
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
                attributeFilter: ["open", "data-size", "data-revealed"],
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
          await tp.waitForTimeout(1_000)
          const running = await recorded()
          const sizeOf = async (row: typeof ticked) =>
            (await row.count()) === 1
              ? await row.getAttribute("data-size")
              : "missing"
          await toolIdle()
          await away()
          await twoFrames(tp)
          const done = await recorded()
          const again = tp
            .locator(`${col(0)} .tool[data-tool="bash"]`)
            .filter({ hasText: "echo again" })
          const after = {
            again: await sizeOf(again),
            ticked: await sizeOf(ticked),
            stepped: await sizeOf(stepped),
          }
          // Fold the whole one again, so the checks below see the column they expect.
          if (after.ticked === "full") await ticked.locator("summary").click()
          check(
            "a tab shown again draws each tool row as it was left: a running one open from its first frame, the line hidden, and a finished one's size or its reader's choice kept",
            opened &&
              running.filter(r => r.includes(":again:")).join() ===
                "added:again:live:capped:revealed" &&
              line === "hidden" &&
              done.every(r => r.startsWith("added:")) &&
              after.again === "capped" &&
              after.ticked === "full" &&
              after.stepped === "closed",
            `${JSON.stringify({ running, line, done, after })}`,
          )
        }

        // While the lane runs, its header's mark pulses and a line at the
        // column's end says more is coming. Accepted work takes no height, whether
        // it is the content's last child or sits above a queued card.
        {
          const thinking = script.pause("think a while")
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
          // A message sent now is a card queued behind the paused run, below
          // accepted work.
          await say("wait behind it")
          await appears(`${col(0)} .card-editor.queued`, 10_000)
          await twoFrames(tp)
          const above = await lineShows()
          thinking.resume()
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
              // It names the ask it works on (ADR-0106).
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
              above?.next?.includes("queued") === true &&
              ended.line === 0,
            `${JSON.stringify({ last, above, ended })}`,
          )
        }

        // A command the work opened is outlined while it runs, and the line
        // hides; one that ends within half a second does neither. The fast one
        // sleeps, so it is live for frames the sampler sees: an `echo` alone
        // gets its result between two.
        {
          script.use([
            { tool: "bash", args: { command: "sleep 2" } },
            { text: "slept" },
          ])
          await say("sleep on it")
          const revealed = `${col(0)} .tool.live[data-revealed]`
          const outlined = await appears(revealed, 10_000)
          await tp.waitForTimeout(400)
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
                }
              },
              col(0),
            )
            .catch(() => null)
          await toolIdle()
          await tp.evaluate(c => {
            const w = window as unknown as {
              __frames: {
                line: number
                hidden: number
                live: number
                outlined: number
              }
              __sampling: boolean
            }
            w.__frames = { line: 0, hidden: 0, live: 0, outlined: 0 }
            w.__sampling = true
            const sample = () => {
              if (!w.__sampling) return
              const line = document.querySelector(`${c} .working-line`)
              if (line !== null) {
                w.__frames.line++
                if (getComputedStyle(line).visibility !== "visible")
                  w.__frames.hidden++
              }
              for (const row of document.querySelectorAll(`${c} .tool.live`)) {
                w.__frames.live++
                if (getComputedStyle(row, "::after").content !== "none")
                  w.__frames.outlined++
              }
              requestAnimationFrame(sample)
            }
            requestAnimationFrame(sample)
          }, col(0))
          script.use([
            { tool: "bash", args: { command: "sleep 0.2; echo briefly" } },
            { text: "brief" },
          ])
          await say("briefly")
          await toolIdle()
          await twoFrames(tp)
          const fast = await tp.evaluate(() => {
            const w = window as unknown as {
              __frames: {
                line: number
                hidden: number
                live: number
                outlined: number
              }
              __sampling: boolean
            }
            w.__sampling = false
            return w.__frames
          })
          check(
            "a running command the work opened is outlined, centred in its column, and hides the line; a fast one does neither",
            outlined &&
              slow?.outline === "solid" &&
              slow.colour !== "rgba(0, 0, 0, 0)" &&
              slow.line === "hidden" &&
              slow.margins !== null &&
              Math.abs(slow.margins.left - slow.margins.right) <= 1 &&
              fast.line > 0 &&
              fast.live > 0 &&
              fast.hidden === 0 &&
              fast.outlined === 0,
            `${JSON.stringify({ slow, fast })}`,
          )
        }

        // A row previews a command's first line, and at most 120 characters;
        // the row, opened, shows all of it in the preview's place, once. A
        // command its preview shows whole has nothing to swap.
        {
          const WHOLE = `echo ${"long ".repeat(30)}\necho second line`
          script.use([
            { tool: "bash", args: { command: WHOLE } },
            { text: "echoed" },
          ])
          await say("echo a long one")
          await toolIdle()
          const cut = `${col(0)} .tool[data-tool="bash"][data-status="ok"]`
          await appears(`${cut}:has-text("echo long")`, 10_000)
          const row = tp.locator(cut).last()
          /** The summary's text as shown: only what is displayed counts. */
          const summaryShows = () =>
            row.locator("summary").evaluate(s => (s as HTMLElement).innerText)
          const closed = await summaryShows()
          await row.locator("summary").click()
          const opened = await summaryShows()
          const whole = WHOLE
          // A command short enough to need no layout, run earlier.
          const short = tp.locator(cut).filter({ hasText: "echo quick" })
          const shorts = await short.count()
          const swaps = await short.locator(".tool-label-whole").count()
          check(
            "an opened row shows the whole command in its label's place, once, and a short one's has nothing to swap",
            closed.includes("…") &&
              !closed.includes("second line") &&
              opened.includes(whole) &&
              !opened.includes("…") &&
              opened.split("echo long").length === 2 &&
              shorts > 0 &&
              swaps === 0,
            `${JSON.stringify(closed.slice(-12))}, ${opened.split("echo long").length - 1} times, ${swaps} of ${shorts}`,
          )
        }

        // A shell row's tag is its tool's word, at its top right (ADR-0114),
        // and a long one-line chain opens laid out, a step a line, each
        // step's command marked.
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
          await row.locator("summary").click()
          const seen = await row.evaluate(r => {
            const summary = r.querySelector("summary")?.getBoundingClientRect()
            const tag = r.querySelector(".tool-tag")
            const box = tag?.getBoundingClientRect()
            const whole = r.querySelector(
              ".tool-label-whole",
            ) as HTMLElement | null
            return {
              tag: tag?.textContent ?? "",
              right: (summary?.right ?? 0) - (box?.right ?? 0),
              top: (box?.top ?? 0) - (summary?.top ?? 0),
              lines: (whole?.innerText ?? "").split("\n").length,
              commands: [
                ...r.querySelectorAll(".tool-label-whole .sh-command"),
              ].map(c => c.textContent ?? ""),
            }
          })
          check(
            "a shell row's tag sits at its top right, and its opened command is laid out a step a line, its command names marked",
            seen.tag === toolWord("bash") &&
              Math.abs(seen.right) <= 2 &&
              Math.abs(seen.top) <= 2 &&
              seen.lines === STEPS.length &&
              STEPS.every(step =>
                seen.commands.includes(step.split(" ")[0] ?? ""),
              ),
            JSON.stringify(seen),
          )
        }

        // ── a following column never gets shorter while its agent works (S35) ─
        // At 20× CPU throttle every render is painted, as in a long session, so
        // a render that disagrees with the document would be seen here.
        {
          const bodyOf = `${col(0)} .column-body`
          await tp.$eval(bodyOf, b => {
            b.scrollTop = b.scrollHeight
          })
          const COMMAND =
            "for s in a b c d e f; do echo step $s; sleep 0.1; done"
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
          await toolIdle()
          await tp.waitForSelector(`${col(0)} .stop`, {
            state: "detached",
            timeout: 30_000,
          })
          await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 })
          const samples = await stop()
          await cdp.detach()
          const frames = samples.filter(f => f.at === "frame")
          const during = frames.filter(f => f.running)
          const painted = samples.filter(f => f.at === "resize" && f.running)
          const shrinks = painted.flatMap((f, i) => {
            const before = painted[i - 1]
            return before !== undefined && f.height < before.height
              ? [`${before.height}→${f.height}`]
              : []
          })
          const drops = frames.flatMap((f, i) => {
            const before = frames[i - 1]
            return before !== undefined && f.steps < before.steps
              ? [`${before.steps}→${f.steps}`]
              : []
          })
          const label = rowSummary({ id: "", name: "bash", subject: COMMAND })
            .preview.map(r => r.text)
            .join("")
          const twice = during.filter(
            f => f.labels.filter(l => l === label).length > 1,
          ).length
          const seen = during.some(f => f.labels.includes(label))
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
          check(
            "a column following its end never gets shorter while its agent works",
            shrinks.length === 0,
            `${shrinks.join(" ") || "no shrinks"}`,
          )
          check(
            "a running command's label shows once, in its row",
            seen && twice === 0,
            `${twice} frames with two`,
          )
        }

        script.use([
          { tool: "bash", args: { command: "sleep 5" } },
          { text: "after" },
        ])
        await say("sleep")
        // As a person does: stop the command once it is seen running.
        await appears(`${col(0)} .tool.live`)
        const stopShown = await appears(`${col(0)} .stop`)
        const t0 = Date.now()
        if (stopShown) await tp.click(`${col(0)} .stop`)
        const failed = `${col(0)} .tool[data-tool="bash"][data-status="error"]`
        const ended = await appears(failed, 10_000)
        if (ended) await openRow(failed)
        const why = await tp
          .textContent(`${failed} .tool-output`)
          .catch(() => "")
        check(
          'Stop ends a running command, shown as ✗ "Command aborted"',
          stopShown &&
            ended &&
            Date.now() - t0 < 4_000 &&
            (await tp.textContent(`${failed} .tool-status`)) === "✗" &&
            why?.includes("aborted") === true,
          `${why?.slice(-16) ?? "none"}`,
        )
        await toolIdle()

        // ── commands: found as you type, sent in full (ADR-0036) ─────────────
        await tp.fill(`${col(0)} .composer .input`, "/hel")
        const commandOffered = await appears(
          `${col(0)} .command-menu [data-command="fixture:skill:hello"]`,
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

        // ── a column keeps its width, whatever its content (S37) ─────────────
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
          `${col(0)} .tool[data-tool="read"] .tool-label:has-text("yyy")`,
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

        // ── the thread's name in its header, and its offer at its foot ──────
        // (ADR-0105, ADR-0039, ADR-0040). The name is as the host stored it.
        const nameText = await tp.textContent(
          `${col(0)} .column-head .agent-name`,
        )
        const threadName = await tp.getAttribute(
          `${col(0)} .column-head .agent-name`,
          "data-thread",
        )
        const starShown = await tp
          .locator(
            `${col(0)} .column-head .agent-name .thread-mark .thread-star`,
          )
          .evaluate(n => getComputedStyle(n).opacity === "1")
        check(
          "the column's header names the thread, its star shown with no banner",
          threadName !== null &&
            [...readNames(toolHost.session).values()].includes(
              threadName as ThreadName,
            ) &&
            nameText === `✦ ${threadName}` &&
            starShown,
          `${nameText}`,
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
          `${col(0)} .work.offer[data-state="ready"] .offer-accept`,
        )
        const line =
          (await tp
            .textContent(`${col(0)} .work .offer-line`)
            .catch(() => "")) ?? ""
        const bookmark =
          (await tp
            .textContent(`${col(0)} .work .offer-bookmark`)
            .catch(() => "")) ?? ""

        // ── the review, beside the thread (ADR-0047) ─────────────────────────
        {
          // Once described: describing rewrites the offer's commit, and the review
          // would read the new one mid-check.
          await waitFor(
            () =>
              [...readOffers(toolHost.session).values()].some(
                o => o.acceptedAs === null && o.described,
              ),
            15_000,
          )
          const review = `${col(0)} .review`
          const section = (file: string) =>
            `${review} .review-file[data-key$=":${file}"]`
          await tp.click(`${col(0)} .work .offer-line`).catch(() => {})
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
            "the offer's line opens its review beside the thread, which keeps its 28rem: a row per file, and a file's diff",
            opened && threadWidth && rows === 2 && diffShown,
            `opened ${opened}, thread 28rem ${threadWidth}, rows ${rows}, diff ${diffShown}`,
          )
          // What only typing changes redraws no part of the review (S54).
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
          await tp.waitForTimeout(100)
          const pinned = await headAtTop("long-lane.txt")
          await tp
            .click(`${review} .review-list-file[title="from-lane.txt"]`, {
              timeout: 5_000,
            })
            .catch(() => {})
          await tp.waitForTimeout(100)
          const listJumped = await headAtTop("from-lane.txt")
          check(
            "a file's head stays pinned while its diff scrolls, and the list brings a file to the top",
            pinned && listJumped,
            `pinned ${pinned}, jumped ${listJumped}`,
          )
          await tp
            .click(`${col(0)} > .pane .pane-close`, { timeout: 5_000 })
            .catch(() => {})
          const closed = await appears(`${col(0)}:not(:has(.review))`, 5_000)
          if (acceptShown) await tp.click(`${col(0)} .work .offer-accept`)
          // The acceptance moves accepted work forward to the offer (ADR-0104).
          const onAccepted = () => {
            try {
              return execFileSync(
                "jj",
                [
                  "-R",
                  work,
                  "file",
                  "list",
                  "-r",
                  "pinetrie-accepted",
                  'root:"from-lane.txt"',
                ],
                { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
              ).includes("from-lane.txt")
            } catch {
              return false
            }
          }
          const accepted =
            (await waitFor(onAccepted, 10_000)) >= 0 &&
            !existsSync(path.join(work, "from-lane.txt"))
          check(
            "the column's foot shows the thread's offer in words, its bookmark apart, and its add button moves accepted work to it, leaving your working copy",
            acceptShown &&
              bookmark.startsWith("pinetrie-offer/") &&
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
              `${col(0)} .work .offer-line`,
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
        const frame = () =>
          tp.evaluate(() => new Promise(r => requestAnimationFrame(r)))
        const streamHeight = () =>
          tp
            .$eval(
              `${col(0)} .streaming`,
              s => s.getBoundingClientRect().height,
            )
            .catch(() => 0)
        /** The column's gap to its end, sampled while its reply is written. */
        const sampleWhileStreaming = async () => {
          const gaps: number[] = []
          let tallest = 0
          while ((await tp.$(`${col(0)} .streaming`)) !== null) {
            tallest = Math.max(tallest, await streamHeight())
            gaps.push(Math.round(await gapOf(0)))
            await new Promise(r => setTimeout(r, 100))
          }
          return { gaps, tallest }
        }
        const LONG = Array.from(
          { length: 40 },
          (_, i) => `Line ${i + 1} of a long reply.`,
        ).join("\n\n")

        script.use([{ text: LONG }])
        await say("a long one")
        await appears(`${col(0)} .streaming`)
        const followed = await sampleWhileStreaming()
        await toolIdle()
        check(
          "a column at its end follows a reply as it is written",
          followed.gaps.length >= 3 &&
            followed.tallest >= 300 &&
            followed.gaps.every(g => g < 80),
          `gaps ${followed.gaps.join(" ")}; reply ${Math.round(followed.tallest)}px`,
        )

        script.use([{ text: LONG }])
        await say("another long one")
        await tp
          .waitForFunction(
            c =>
              (document
                .querySelector(`${c} .streaming`)
                ?.getBoundingClientRect().height ?? 0) > 100,
            col(0),
            { timeout: 20_000 },
          )
          .catch(() => null)
        await tp.hover(body(0))
        await tp.mouse.wheel(0, -10)
        await new Promise(r => setTimeout(r, 300))
        const heldAt = await tp.$eval(body(0), b => b.scrollTop)
        const grownFrom = await streamHeight()
        await tp
          .waitForFunction(
            ([c, h]) =>
              (document
                .querySelector(`${c} .streaming`)
                ?.getBoundingClientRect().height ?? 0) >
              h + 200,
            [col(0), grownFrom] as const,
            { timeout: 20_000 },
          )
          .catch(() => null)
        const heldTo = await tp.$eval(body(0), b => b.scrollTop)
        const offered = await appears(`${col(0)} .jump-latest`, 2_000)
        if (offered) await tp.click(`${col(0)} .jump-latest`)
        await frame()
        const jumped = await gapOf(0)
        const gone = (await tp.locator(`${col(0)} .jump-latest`).count()) === 0
        const after = await sampleWhileStreaming()
        await toolIdle()
        check(
          "a small scroll up holds the column still while the reply is written, and ↓ new below is the way back",
          Math.abs(heldTo - heldAt) <= 1 &&
            offered &&
            // While the reply streams, a paragraph can land between the jump
            // and this read, as in the samples.
            jumped < 80 &&
            gone &&
            after.gaps.every(g => g < 80),
          `held ${Math.round(heldAt)}→${Math.round(heldTo)}, offered ${offered}, gap after ${Math.round(jumped)}, then ${after.gaps.join(" ")}`,
        )

        await tp.hover(body(0))
        await tp.mouse.wheel(0, -300)
        await new Promise(r => setTimeout(r, 300))
        const away = await gapOf(0)
        script.use([{ text: "short" }])
        await say("back to the end")
        await toolIdle()
        await appears(`${col(0)} ${msg("back to the end")}`)
        await frame()
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
          const first = await aligner.chat(lines(0), atEntry(entryId(forkId)), {
            mode: "branch",
          })
          let tip = first.kind === "appended" ? first.id : null
          for (let n = 1; n <= 12 && tip !== null; n++) {
            const next = await aligner.chat(lines(n), atEntry(tip))
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
          await frame()
          await frame()
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
              : await aligner.chat("one more below", atEntry(tip))
          await tp
            .waitForSelector(
              `${col(1)} .msg[data-entry="${more?.kind === "appended" ? more.id : "none"}"]`,
              { state: "attached", timeout: 15_000 },
            )
            .catch(() => null)
          await frame()
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

        // ── the agent's work, on the board (ADR-0091) ───────────────────────
        // Another writer starts agent work at the root: no tab opens, the
        // strip counts it, the board rings its root though this tab does not
        // hold it, choosing the item opens it, and that root cannot be
        // archived until the agent is done.
        await tp
          .$eval('#sidebar [aria-current="true"]', n =>
            n.getAttribute("data-root"),
          )
          .catch(() => null)
        const starter = await join(toolHost, "starter", "browser")
        try {
          script.use([{ text: LONG }])
          await starter.chat("@agent a long one elsewhere", ROOT, {
            mode: "branch",
          })
          const newRoot = treeOf(toolHost).roots.at(-1) ?? ""
          await appears("#bottom .state-working")
          await openBoard(tp)
          const ringed = `#board ${boardSel(newRoot)}:has(.root-status.working) .board-open`
          await appears(ringed)
          await tp.click(ringed)
          await appears(
            `#sidebar .open-root[data-root="${newRoot}"][aria-current="true"]`,
          )
          await seeInMenu(tp, OWN_MENU, ".move-to.closes")

          await toolIdle()
        } finally {
          await starter.close()
        }

        // ── the rail draws a long loop as one capsule (ADR-0031) ─────────────
        await tp.keyboard.press("Escape")
        await tp.click("#sidebar .add-agent")
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
        const loopIndex = treeOf(toolHost)
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
            // Its first line counts; a digest, on by default (ADR-0071),
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
        // its pick scrolls down, which does not stop a column following (S33).
        const railer = await join(toolHost, "railer", "browser")
        try {
          const say3 = (n: string) => `${n}.\nIts second line.\nIts third line.`
          const chain = async (from: string, name: string, n: number) => {
            let tip = from
            for (let k = 1; k <= n; k++) {
              // A message below one that has a reply starts a branch there.
              const r = await railer.chat(
                say3(`${name} ${k}`),
                atEntry(entryId(tip)),
                k === 1 ? { mode: "branch" } : undefined,
              )
              if (r.kind !== "appended") return null
              tip = r.id
            }
            return tip
          }
          const start = await railer.chat(say3("Trunk 0"), ROOT, {
            mode: "branch",
          })
          const trunk =
            start.kind === "appended"
              ? await chain(start.id, "Trunk", 20)
              : null
          // The trunk's continuation first, so it keeps the trunk's track; the
          // aside after it, so it is the newest leaf, which the tab opens.
          const later = trunk === null ? null : await chain(trunk, "Later", 30)
          const aside = trunk === null ? null : await chain(trunk, "Aside", 1)
          const railRoot =
            start.kind === "appended" ? start.id : entryId("none")
          // Another writer's root is not in the sidebar (ADR-0030): open it from the board.
          await openFromBoard(tp, railRoot)
          await tp.waitForSelector(
            `${col(0)} .msg[data-entry="${aside ?? "none"}"]`,
            { timeout: 15_000 },
          )
          const rows = projectRail(treeOf(toolHost), railRoot)
          const firstLater = rows.find(
            r => r.parentId === trunk && r.track === 0,
          )
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
            await frame()
            await frame()
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
          await frame()
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
          await frame()
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
          removeLane(work, lane)
        rmSync(work, { recursive: true, force: true })
      }
    }
  } finally {
    await browser.close().catch(() => {})
  }
}
