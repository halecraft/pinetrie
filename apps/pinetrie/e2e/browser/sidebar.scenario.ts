// e2e/browser/sidebar — your list, the board and the inbox, over a first
// canvas and the DOWN canvas made through the session; then a branch shown
// again after a return to its tab.

import { atEntry, entryId, ROOT } from "@pinetrie/core"
import { readerHeading } from "@pinetrie/interface"
import { SCRIPTED_DESCRIPTION } from "@pinetrie/pi"
import {
  readCanvases,
  readMarks,
  readPlaces,
  readTyping,
  readWorkflow,
} from "@pinetrie/reads"
import { replyTitle } from "@pinetrie/rules"
import { mentionHandle, projectRail } from "@pinetrie/threads"
import type { Page } from "@playwright/test"
import type { Checks } from "../checks.ts"
import {
  canvasHolding,
  heldTree,
  join,
  taskBoardState,
  waitFor,
} from "../harness.ts"
import type { Scenario } from "../scenario.ts"

import {
  asPerson,
  boardSel,
  chooseFromMenu,
  chooseFromMenuOrThrow,
  componentRenders,
  connected,
  itemSel,
  launchBrowser,
  OWN_MENU,
  openBoard,
  openFromBoard,
  RAIL_MESSAGES,
  seeInMenu,
  shownName,
  stepAway,
  stepBack,
  TO_NOBODY,
  twoFrames,
  waitForListWidth,
  waitForQuiet,
} from "./page.ts"

import { col, ME, msg, openAsAda, startKit, twoCanvases } from "./page-kit.ts"

export const scenario: Scenario = {
  run: ({ check }) => run(check),
}

async function run(check: Checks["check"]): Promise<void> {
  const browser = await launchBrowser()
  try {
    const kit = await startKit(browser)
    const {
      host,
      page,
      errors,
      rootCanvas,
      countIsHosts,
      label,
      caretIn,
      shows,
    } = kit
    try {
      const canvases = await twoCanvases(kit)
      const { firstRoot } = canvases
      await openAsAda(kit)
      // The DOWN canvas, its agent thread and its chat side by side, as
      // `page` leaves it.
      await page.click(itemSel(rootCanvas(canvases.downRoot)))
      // A thread made through the session is folded on her page until
      // she opens it, as she opened the chat in `page`.
      await page.click(".folded-column:not(.canvas-column) .unfold", {
        timeout: 15_000,
      })
      await page.waitForFunction(
        () => document.querySelectorAll(".column").length === 2,
        undefined,
        { timeout: 15_000 },
      )
      // ── the sidebar, the board and the inbox ───────────
      const downRoot = heldTree(host).roots.at(-1) ?? ""
      const selectedRoot = (p: Page) =>
        p
          .$eval('#sidebar [aria-current="true"]', n =>
            n.getAttribute("data-canvas"),
          )
          .catch(() => null)
      const messagesIn = (root: string) =>
        projectRail(heldTree(host), entryId(root)).length
      // 1. Which tree a root's rail draws is `canvasRail`'s, proven by its unit test.
      await page.click(itemSel(rootCanvas(firstRoot)))
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
      const third = await api.send("a third thread", ROOT, { mode: "branch" })
      const thirdRoot = third.kind === "appended" ? third.id : entryId("")
      await countIsHosts(page)
      check(
        "a root another writer starts is not added to the sidebar, and the page stays where it is",
        thirdRoot !== "" &&
          (await page.locator(itemSel(rootCanvas(thirdRoot))).count()) === 0 &&
          (await selectedRoot(page)) === rootCanvas(firstRoot),
      )
      // Any root can be moved on the board: another item's ⋯ shows while it is hovered.
      const otherMenu = page.locator(
        `${itemSel(rootCanvas(downRoot))} ~ .open-more .open-menu`,
      )
      const hiddenAtRest = !(await otherMenu.isVisible())
      await page.hover(itemSel(rootCanvas(downRoot)))
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
      await api.send("meanwhile, elsewhere", atEntry(entryId(downRoot)), {
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
      await page.click(itemSel(rootCanvas(downRoot)))
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
      await page.hover(itemSel(rootCanvas(downRoot)))
      await page.click(`${itemSel(rootCanvas(downRoot))} ~ .open-close`)
      await page
        .waitForFunction(
          r =>
            document.querySelector(
              `#sidebar .open-root[data-canvas="${r}"]`,
            ) === null,
          rootCanvas(downRoot),
          { timeout: 15_000 },
        )
        .catch(() => null)
      await openFromBoard(page, rootCanvas(downRoot))
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
      await page.click(itemSel(rootCanvas(firstRoot)))

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
        await openFromBoard(tb, rootCanvas(thirdRoot))
        await openBoard(page)
        const reader = `#board ${boardSel(rootCanvas(thirdRoot))} .reader-trigger`
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
            `${itemSel(rootCanvas(thirdRoot))}[aria-current="true"]`,
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
          .waitForSelector(`${itemSel(rootCanvas(thirdRoot))} .avatar`, {
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
        const tabby = `#board ${boardSel(rootCanvas(thirdRoot))} .reader-trigger`
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
        await openFromBoard(tb, rootCanvas(firstRoot))
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
                `#sidebar .open-root[data-canvas="${from}"] .avatar`,
              ) === null &&
              document.querySelector(
                `#sidebar .open-root[data-canvas="${to}"] .avatar`,
              ) !== null,
            [rootCanvas(thirdRoot), rootCanvas(firstRoot)] as const,
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
          p
            .textContent(`${itemSel(rootCanvas(r))} .open-label`)
            .catch(() => null)
        const labelIs = (p: Page, r: string, want: string) =>
          p
            .waitForFunction(
              ([sel, text]) =>
                document.querySelector(sel)?.textContent === text,
              [`${itemSel(rootCanvas(r))} .open-label`, want] as const,
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
          r => document.activeElement?.getAttribute("data-canvas") === r,
          rootCanvas(thirdRoot),
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
              `#board ${boardSel(rootCanvas(thirdRoot))} .board-label`,
              TITLE,
            ] as const,
            { timeout: 15_000 },
          )
          .catch(() => null)
        await tb.click(itemSel(rootCanvas(firstRoot)))
        const thirdCanvas = canvasHolding(host, thirdRoot)
        const setAt = readMarks(host.session).get(thirdCanvas)?.at
        await rename("not this", "Escape")
        // Long enough for a rename sent by mistake to come back.
        await waitFor(() => false, 1_000)
        check(
          "Escape leaves a root's title as it was, and sends nothing",
          (await labelIs(page, thirdRoot, TITLE)) &&
            (await page.locator(".open-title-input").count()) === 0 &&
            readMarks(host.session).get(thirdCanvas)?.at === setAt,
        )
        await rename("", "Enter")

        // 4c. Auto-update title: the model's title arrives as the
        // label. The suites' scripted model answers every request outside a
        // thread with `SCRIPTED_DESCRIPTION`.
        const auto = replyTitle(SCRIPTED_DESCRIPTION) ?? ""
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
          // Its scripted run may have moved it to Active already: it goes
          // to whichever of Topics and Active it is not in.
          const workflow = readWorkflow(host.session)
          const now =
            firstRoot === ""
              ? undefined
              : taskBoardState(
                  readPlaces(host.places),
                  canvasHolding(host, firstRoot),
                )
          const target =
            (now === workflow?.topics.id
              ? workflow?.active?.id
              : workflow?.topics.id) ?? ""
          const column = `#board .board-column[data-state="${target}"]`
          await openBoard(page)
          await openBoard(tb)
          await page
            .dragAndDrop(
              `#board ${boardSel(rootCanvas(firstRoot))} .board-open`,
              column,
            )
            .catch(() => null)
          const theirs = await tb
            .waitForSelector(`${column} ${boardSel(rootCanvas(firstRoot))}`, {
              timeout: 15_000,
            })
            .then(
              () => true,
              () => false,
            )
          const id =
            firstRoot === "" ? undefined : canvasHolding(host, firstRoot)
          check(
            "dragging a thread card to another state moves it for the other window",
            theirs &&
              id !== undefined &&
              taskBoardState(readPlaces(host.places), id) === target,
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

        // 5. ＋ canvas, by keyboard: its box starts with @agent, and deleting
        // it sends to people only; an unsent canvas closes without a trace.

        const noMenu = (await page.$("#sidebar .add-menu")) === null
        await page.focus("#sidebar .add-canvas")
        const canvasesBefore = readCanvases(host.places).size
        await page.keyboard.press("Enter")
        await page.waitForSelector(`${col(0)}[data-card] .composer`, {
          timeout: 15_000,
        })
        const typed = await page.inputValue(`${col(0)} .composer .input`)
        const caret = await caretIn(0)
        await page.fill(`${col(0)} .composer .input`, "")
        const chat = await label(0)
        const opened = await waitFor(
          () => readCanvases(host.places).size === canvasesBefore + 1,
          5_000,
        )
        const tab = (await page.getAttribute(col(0), "data-card")) ?? ""
        check(
          "＋ canvas opens a canvas whose box starts with @agent; deleting it sends to people only",
          noMenu &&
            typed === "@agent " &&
            caret === typed.length &&
            chat === TO_NOBODY &&
            opened >= 0 &&
            (await page.$('#sidebar .open-root[aria-current="true"]')) !==
              null &&
            readPlaces(host.places).find(c => c.id === tab)?.place.kind ===
              "canvas",
          `${noMenu}, "${typed}", ${caret}, "${chat}", ${opened}`,
        )
        // Closed unsent, by ×, asking nothing: its canvas goes too.
        await page.fill(`${col(0)} .composer .input`, "never sent")
        await page.click(`${col(0)} .trash-column`)
        const gone = await waitFor(
          () => readCanvases(host.places).size === canvasesBefore,
          10_000,
        )
        check(
          "an unsent new canvas trashed with its bin takes its canvas away, and its thread's card to the trash, asking nothing",
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
        const handle = `@${mentionHandle(await shownName(page))}`
        const before = await unseen()
        const mention = await api.send(
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
        await api.send(`${handle} and here`, atEntry(entryId(mentionId)))
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
        await api.send(
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
        await page.click(itemSel(rootCanvas(firstRoot)))
        const keysOf = () =>
          page.$$eval(".column", cs => cs.map(c => c.getAttribute("data-key")))
        const columnsBefore = await keysOf()
        const reloading = page.reload({ waitUntil: "domcontentloaded" })
        await api.send(
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
            (await selectedRoot(page)) === rootCanvas(firstRoot),
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
          await chooseFromMenuOrThrow(
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
        await page.click(itemSel(rootCanvas(thirdRoot)))
        await page.waitForSelector(`${col(0)} .composer .send`, {
          timeout: 15_000,
        })
        // tb opens the third root again, so it has an item there to lose, and
        // moves it to Done from there.
        await openFromBoard(tb, rootCanvas(thirdRoot))
        await page.fill(`${col(0)} .composer .input`, "typed, not sent")
        const menuSeen =
          (await seeInMenu(page, OWN_MENU, ".move-to.closes")) !== null
        await page.keyboard.press("Escape")
        check("a root's ⋯ in the sidebar opens a menu drawn in full", menuSeen)
        await chooseFromMenuOrThrow(tb, OWN_MENU, ".move-to.closes")
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
                `#sidebar .open-root[data-canvas="${r}"]`,
              ) === null,
            rootCanvas(thirdRoot),
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
          "an archived canvas offers no ＋ to make a column",
          (await page.$("#strip .column")) !== null &&
            (await page.$("#strip > .canvas-end")) === null,
        )
        await page.click(`${col(0)} .read-only-action`)
        const writable = await page
          .waitForSelector(`${col(0)} .composer .send`, { timeout: 15_000 })
          .then(
            () => true,
            () => false,
          )
        await waitFor(() => false, 1_000)
        check(
          "restoring it in place brings back the composer with its text, and adds it to no other window's list",
          writable &&
            (await page.inputValue(input)) === "typed, not sent" &&
            (await tb.locator(itemSel(rootCanvas(thirdRoot))).count()) === 0,
        )

        // Moved to Done again, here, it leaves the sidebar; the board brings it back.
        await page.fill(input, "")
        await chooseFromMenuOrThrow(page, OWN_MENU, ".move-to.closes")
        await page
          .waitForFunction(
            r =>
              document.querySelector(
                `#sidebar .open-root[data-canvas="${r}"]`,
              ) === null,
            rootCanvas(thirdRoot),
            { timeout: 15_000 },
          )
          .then(
            () => true,
            () => false,
          )
        await openBoard(page)
        await page.waitForSelector(
          `#board .board-archive ${boardSel(rootCanvas(thirdRoot))}`,
          { timeout: 15_000 },
        )
        await openFromBoard(page, rootCanvas(thirdRoot))
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
        await page
          .waitForSelector(`${col(0)} .composer .send`, { timeout: 15_000 })
          .catch(() => null)
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
            const r = await writer.send(
              `Message ${n} of a long thread.\nIts second line.\nIts third line.`,
              at === undefined ? ROOT : atEntry(entryId(at)),
              at === undefined ? { mode: "branch" } : {},
            )
            if (r.kind === "appended") ids.push(r.id)
          }
          const longRoot = ids[0] ?? ""
          const forkId = ids.at(-2) ?? ""
          await lp.goto(host.httpUrl, { waitUntil: "domcontentloaded" })
          await openFromBoard(lp, rootCanvas(longRoot))
          await lp.waitForSelector(
            `${col(0)} .msg[data-entry="${ids.at(-1)}"]`,
            {
              timeout: 15_000,
            },
          )
          // Below its last message, so the branch does not move column 0 on.
          const fork = `${col(0)} .msg[data-entry="${forkId}"]`
          const aside = await writer.send(
            "a late aside",
            atEntry(entryId(forkId)),
            { mode: "branch" },
          )
          await lp.waitForSelector(`${fork} .open-branch`, { timeout: 15_000 })
          await lp.click(`${fork} .open-branch`)
          await lp.waitForSelector(`${col(1)} .msg`, { timeout: 15_000 })
          await stepAway(lp)
          await stepBack(lp, rootCanvas(longRoot))
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
              const r = await writer.send(
                `Branch message ${n}.\nIts second line.\nIts third line.`,
                atEntry(entryId(at)),
              )
              kinds.push(r.kind)
              if (r.kind === "appended") at = r.id
            }
            await stepBack(lp, rootCanvas(longRoot))
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
            await stepBack(lp, rootCanvas(longRoot))
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

      await api.close()

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
