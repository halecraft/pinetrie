// e2e/browser/second-window — a second window joins and asks; your
// inventory, pinned cards and notes; the theme, a reload and a new tab;
// threads as cards. Over the canvases `page` leaves, made through the
// session.

import { entryId, ROOT } from "@pinetrie/core"
import {
  readCardTitles,
  readPlaces,
  readReading,
  readRoots,
  readThreads,
} from "@pinetrie/reads"
import { indexCanvases } from "@pinetrie/rules"
import { placeKey, textCardId, threadFirstMessage } from "@pinetrie/threads"
import type { Checks } from "../checks.ts"
import {
  canvasHolding,
  heldTree,
  idleNow,
  join,
  moveCanvasOnBoard,
  taskBoardState,
  threadHolding,
  waitFor,
} from "../harness.ts"
import type { Scenario } from "../scenario.ts"

import {
  asPerson,
  boardSel,
  chooseFromMenu,
  chooseFromMenuOrThrow,
  chooseOnCard,
  componentRenders,
  connected,
  itemSel,
  launchBrowser,
  OWN_MENU,
  openBoard,
  openFromBoard,
  openNote,
  reachable,
  shownName,
  stepAway,
  stepBack,
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
    const { host, page, errors, rootCanvas, countIsHosts, send, idle } = kit
    try {
      const { downRoot } = await twoCanvases(kit)
      await openAsAda(kit)
      // The DOWN canvas, its agent thread and its chat side by side, as
      // `page` leaves it.
      await page.click(itemSel(rootCanvas(downRoot)))
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
      // Bea, on another device: what she starts and moves is not yours.
      const api = await join(host, "tabs", "browser")
      await api.request({ kind: "name", name: "Bea" })
      // Ada reads Bea's thread as `sidebar` leaves her: written in,
      // archived, opened from the board's archive read-only, then restored.
      // The DOWN canvas is another tab.
      const third = await api.send("a third thread", ROOT, { mode: "branch" })
      if (third.kind !== "appended")
        throw new Error(
          `Bea's thread was not started: ${JSON.stringify(third)}`,
        )
      await countIsHosts(page)
      // Her card there, typed and emptied: its record stays.
      await openFromBoard(page, rootCanvas(third.id))
      const thirdBox = `${col(0)} .composer .input`
      await page.fill(thirdBox, "typed, not sent")
      await page.waitForFunction(
        s => document.querySelector(s)?.getAttribute("data-card") != null,
        thirdBox,
        { timeout: 10_000 },
      )
      await page.fill(thirdBox, "")
      // Left, then archived, then opened again: its box mounts read-only, and
      // is bound to her card while it is.
      await page.click(itemSel(rootCanvas(downRoot)))
      await moveCanvasOnBoard(api, entryId(third.id), "archive")
      await openBoard(page)
      await page.waitForSelector(
        `#board .board-archive ${boardSel(rootCanvas(third.id))}`,
        { timeout: 15_000 },
      )
      await openFromBoard(page, rootCanvas(third.id))
      await page.waitForSelector(`${col(0)} .msg`, { timeout: 15_000 })
      await page.click(`${col(0)} .read-only-action`)
      await page.waitForSelector(`${col(0)} .composer .send`, {
        timeout: 15_000,
      })
      // ── a second window joins and asks ──────────────────────────────────────
      // Alone, nobody else is shown anywhere.
      await page.evaluate(() => ({
        avatars: [...document.querySelectorAll(".avatar")].map(
          a =>
            `${a.closest("[data-canvas], .column-head")?.className}:${a.getAttribute("data-writer")}`,
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
        // That choosing it opens her thread is the check of a reader's
        // thread on a thread card, above.
        await chooseFromMenuOrThrow(second, adaTrigger, ".here-thread")
        await second
          .waitForSelector(".column .msg", { timeout: 20_000 })
          .catch(() => null)
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
        const shownCanvas = await page
          .$eval('#sidebar [aria-current="true"]', n =>
            n.getAttribute("data-canvas"),
          )
          .catch(() => null)
        // Its first root's newest message.
        const threads = readThreads(host.session)
        const shownRoot = [...threads.values()].find(
          t =>
            indexCanvases(readPlaces(host.places), threads).canvasOfThread.get(
              t.thread,
            ) === shownCanvas,
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
        // The note trashed, and a message again, for what follows.
        await page.click(`${ourFrame} .trash-card`)
        await page.click(box)
        await page.keyboard.type("Together: from B")
        await hasValue(page, box, "Together: from B")
        const here =
          (await page.getAttribute(
            '#sidebar [aria-current="true"]',
            "data-canvas",
          )) ?? ""
        await page.click(itemSel(rootCanvas(downRoot)))
        await page.click(itemSel(here))
        check(
          "what you type is still there after switching tabs",
          await hasValue(page, box, "Together: from B"),
          `${await boxValue(page, box)}`,
        )
        // A card in another root, typed before this one's last word.
        await page.click(itemSel(rootCanvas(downRoot)))
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
        await page.click(itemSel(rootCanvas(downRoot)))
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
        await page.click(itemSel(rootCanvas(downRoot)))
        await page.click(itemSel(here))
        check(
          "a sent card leaves the box empty, and a tab switch does not bring it back",
          emptied && (await hasValue(page, box, "")),
        )
        // A spent send unbinds the box (`editorState`'s unit tests), so Cmd+Z
        // in it reaches no card.
        const cardsAfterSend = readPlaces(host.places).length
        await page.focus(box)
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
        // A branch's message is kept at its thread; closing it asks, and trashes.
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
        await page.click(itemSel(rootCanvas(downRoot)))
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
        await page.click(`${col(1)} .trash-column`)
        await page
          .waitForFunction(
            () => document.querySelectorAll(".column").length === 1,
            undefined,
            { timeout: 5_000 },
          )
          .catch(() => null)
        await waitFor(
          () =>
            readPlaces(host.places).filter(c => c.place.kind !== "trash")
              .length < cardsBefore,
          5_000,
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
        await page.click(itemSel(rootCanvas(downRoot)))
        const tabMarked = await pipIn(page, itemSel(here))
        const otherBare =
          (await page
            .locator(
              `${itemSel(rootCanvas(downRoot))} .signal[data-signal="unsent"]`,
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
        await chooseFromMenuOrThrow(page, OWN_MENU, ".move-to.closes")
        await page.waitForFunction(
          r =>
            document.querySelector(
              `#sidebar .open-root[data-canvas="${r}"]`,
            ) === null,
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
      await page.click(itemSel(rootCanvas(downRoot)))
      await page.waitForFunction(
        () => document.querySelectorAll(".column").length >= 2,
        undefined,
        { timeout: 15_000 },
      )
      const placeOf = (id: string) =>
        readPlaces(host.places).find(c => c.id === id)?.place
      const slotOf = (id: string) => `.inventory .slot[data-card="${id}"]`
      // A slot's card to the trash: selected, then the bench's trash.
      const trashFromSlot = async (id: string) => {
        await page.click(slotOf(id))
        await page.click(".inventory .bench .trash-selected")
      }
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
          `${slotOf(parked)} .compact-text`,
          { timeout: 10_000 },
        )
        .then(
          () => true,
          () => false,
        )
      const firstLine = await page
        .textContent(`${slotOf(parked)} .compact-text`)
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
      // The panel, open in the middle, may cover the composer: it is
      // focused from the keyboard.
      const slotIndex = await page.getAttribute(slotOf(parked), "data-slot")
      await page.focus(downBox)
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
      // The panel, open in the middle, may cover most of the composer: the
      // drop aims at a point of it the pointer reaches.
      const agentBox = `${col(0)} textarea[data-card="${parked}"]`
      await page.dragAndDrop(slotOf(parked), `${col(0)} .composer`, {
        targetPosition: await reachable(page, `${col(0)} .composer`),
      })
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
      await page.dragAndDrop(slotOf(parked), "#strip > .canvas-end", {
        targetPosition: await reachable(page, "#strip > .canvas-end"),
      })
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
            c.place.canvas !== columnPlace.canvas ||
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
      // Trashed with the bench's trash, and back in its slot with the undo
      // key: a trash is a move the host's history holds.
      await trashFromSlot(parked)
      await waitFor(() => placeOf(parked)?.kind === "trash", 5_000)
      await page.evaluate(() =>
        (document.activeElement as HTMLElement | null)?.blur(),
      )
      await page.keyboard.press("ControlOrMeta+z")
      const trashUndone = await waitFor(
        () => placeOf(parked)?.kind === "inventory",
        5_000,
      )
      check(
        "the bench's trash trashes the selected card, and the undo key outside a box brings it back",
        trashUndone >= 0,
        `${trashUndone} ms; ${placeOf(parked)?.kind}`,
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
        into?.entry == null ? undefined : canvasHolding(host, into.entry)
      const landed =
        thread === undefined
          ? undefined
          : taskBoardState(readPlaces(host.places), thread)
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
      // Selected, a card is shown on the bench beside the grid, normal and
      // read only, and the panel keeps its size whatever it shows: an empty
      // slot, a card, the card opened. Enter opens it on the bench, the
      // caret in its box; Escape folds it, and focus is back on its slot.
      // An empty slot first, since a click on the card already selected
      // opens it.
      const panelBox = () =>
        page.$eval(".inventory", el => {
          const r = el.getBoundingClientRect()
          return `${Math.round(r.width)}×${Math.round(r.height)}`
        })
      await page.click(slotAt(emptySlot))
      const emptyBench = await appears(".inventory .bench .bench-empty")
      const sizeEmpty = await panelBox()
      await page.click(slotOf(parked))
      const onBench = await page
        .waitForFunction(
          id => {
            const normal = document.querySelector(
              `.inventory .bench .card-normal[data-card="${id}"]`,
            )
            return (
              normal?.textContent?.includes("for later: a plan") === true &&
              normal.querySelector("textarea, [contenteditable]") === null
            )
          },
          parked,
          { timeout: 10_000 },
        )
        .then(
          () => true,
          () => false,
        )
      const sizeCard = await panelBox()
      check(
        "selecting a slot shows its card on the bench, read only, and the panel keeps its size",
        emptyBench && onBench && sizeEmpty === sizeCard,
        `empty slot on the bench ${emptyBench}, card ${onBench}, ${sizeEmpty} then ${sizeCard}`,
      )
      await page.keyboard.press("Enter")
      const caretInBox = await page
        .waitForFunction(
          id =>
            document.activeElement?.matches(
              `.inventory .bench textarea[data-card="${id}"]`,
            ) === true,
          parked,
          { timeout: 5_000 },
        )
        .then(
          () => true,
          () => false,
        )
      const sizeOpen = await panelBox()
      await page.keyboard.press("Escape")
      const foldedBack = await page
        .waitForFunction(
          sel =>
            document.querySelector(".inventory .bench textarea") === null &&
            document.activeElement === document.querySelector(sel),
          slotOf(parked),
          { timeout: 5_000 },
        )
        .then(
          () => true,
          () => false,
        )
      check(
        "Enter opens the card on the bench, caret in its box, and Escape folds it back to its slot",
        caretInBox &&
          foldedBack &&
          sizeOpen === sizeCard &&
          placeOf(parked)?.kind === "inventory",
        `caret ${caretInBox}, folded ${foldedBack}, ${sizeOpen}`,
      )
      // The open card's × closes it, as Escape does: × never trashes.
      await page.keyboard.press("Enter")
      await appears(".inventory .bench .close-card")
      await page.click(".inventory .bench .close-card")
      const closedKept = await page
        .waitForFunction(
          () =>
            document.querySelector(".inventory .bench textarea") === null &&
            document.querySelector(".inventory[data-shown]") !== null,
          undefined,
          { timeout: 5_000 },
        )
        .then(
          () => true,
          () => false,
        )
      check(
        "the × of a card open on the bench closes it, and the card stays in its slot",
        closedKept && placeOf(parked)?.kind === "inventory",
        `closed ${closedKept}, ${placeOf(parked)?.kind}`,
      )
      // A take while the panel is closed peeks: the panel opens for the
      // card's landing, and a pointer over it keeps it open, as if you had
      // opened it. The card is trashed after.
      await page.click("#bottom .inventory-toggle")
      await page.click(downBox)
      await page.keyboard.type("a peek")
      await page.waitForFunction(
        s => document.querySelector(s)?.getAttribute("data-card") != null,
        downBox,
        { timeout: 10_000 },
      )
      const peeked = (await page.getAttribute(downBox, "data-card")) ?? ""
      await page.keyboard.press("Control+Shift+I")
      const peeks = await appears('.inventory[data-shown="peek"]')
      // Its box as laid out: while it grows from its toggle, its drawn box
      // is a fraction of it.
      const peekBox = await page.$eval(".inventory", el => {
        const panel = el as HTMLElement
        return {
          x: panel.offsetLeft,
          y: panel.offsetTop,
          h: panel.offsetHeight,
        }
      })
      await page.mouse.move(peekBox.x + 40, peekBox.y + peekBox.h / 2, {
        steps: 2,
      })
      const keptOpen = await appears('.inventory[data-shown="held"]')
      check(
        "a take while the inventory is closed peeks, and a pointer over it keeps it open",
        peeks && keptOpen,
        `peeked ${peeks}, kept open ${keptOpen}`,
      )
      // Delete on a selected slot trashes its card.
      await page.click(slotOf(peeked))
      await page.keyboard.press("Delete")
      const deleted = await waitFor(
        () => placeOf(peeked)?.kind === "trash",
        5_000,
      )
      check(
        "Delete on a selected slot trashes its card",
        deleted >= 0,
        `${deleted} ms; ${placeOf(peeked)?.kind}`,
      )
      await trashFromSlot(parked)
      await waitFor(() => placeOf(parked)?.kind === "trash", 5_000)
      const columnsBefore = await page.locator(".column").count()
      // The inventory, left open in the middle of the screen, may cover the
      // message: closed for the click on its →, open again for what follows.
      const inventoryOpen =
        (await page.locator(".inventory[data-shown]").count()) > 0
      if (inventoryOpen) await page.click("#bottom .inventory-toggle")
      // Move to trash, from its ⋯, on an unstarted branch with text trashes
      // it; the canvas column's trash lists it, and restore brings it back,
      // its text with it.
      const branchable = page
        .locator(
          `${col(columnsBefore - 1)} .msg[data-entry]:has(> .tools > .branch)`,
        )
        .first()
      await branchable.hover()
      await branchable.locator(":scope > .tools > .branch").click()
      if (inventoryOpen) await page.click("#bottom .inventory-toggle")
      const branch = col(columnsBefore)
      const unstartedBox = `${branch} .composer .input`
      await page.waitForSelector(unstartedBox, { timeout: 15_000 })
      // The panel, open in the middle, may cover its composer.
      await page.focus(unstartedBox)
      await page.keyboard.type("half a thought")
      await page.waitForFunction(
        s => document.querySelector(s)?.getAttribute("data-card") != null,
        unstartedBox,
        { timeout: 10_000 },
      )
      const thought = (await page.getAttribute(unstartedBox, "data-card")) ?? ""
      const branchCard = (await page.getAttribute(branch, "data-card")) ?? ""
      const trashed = await chooseFromMenu(
        page,
        `${branch} .column-menu`,
        ".column-trash",
      )
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
      // The inventory, docked in the middle, covers the canvas column: its
      // controls are pressed from the keyboard.
      const press = async (sel: string) => {
        await page.focus(sel, { timeout: 10_000 })
        await page.keyboard.press("Enter")
      }
      if ((await page.$(".canvas-column.folded-column")) !== null)
        await press(".canvas-column.folded-column .unfold")
      const trashRow = `.canvas-trash .trash-row[data-card="${branchCard}"]`
      await press(".canvas-trash summary").catch(() => {})
      const listed = await appears(trashRow)
      await press(`${trashRow} .trash-restore`).catch(() => {})
      const restored = await columnsAre(columnsBefore + 1)
      check(
        "Move to trash on a branch trashes it, the canvas's trash lists it, and restore brings it back with its text",
        trashed &&
          closedFresh &&
          listed &&
          restored &&
          placeOf(branchCard)?.kind === "canvas" &&
          placeOf(thought)?.kind === "composing",
        `chosen ${trashed}, closed ${closedFresh}, listed ${listed}, restored ${restored}, ${placeOf(branchCard)?.kind}`,
      )
      // Its text taken into slot 5, which a reload below keeps.
      await page.click('.inventory .slot[data-slot="5"]')
      await page.focus(unstartedBox)
      await page.keyboard.press("Control+Shift+I")
      await appears(`.inventory .slot[data-slot="5"][data-card="${thought}"]`)
      await page.click(`${branch} .trash-column`)
      await columnsAre(columnsBefore)

      // Pinned cards, in the DOWN thread's agent column:
      // pin moves the composer's card to the strip at the column's top, above
      // its scrolling messages, and the composer is empty again.
      const composerBox = `${col(0)} .composer .input`
      // The inventory, left open in the middle of the screen, would cover it.
      if ((await page.locator(".inventory[data-shown]").count()) > 0)
        await page.click("#bottom .inventory-toggle")
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
      if ((await page.locator(".inventory[data-shown]").count()) > 0)
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
              marker?.nextElementSibling?.matches(".msg.person") === true &&
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
      if ((await page.locator(".inventory[data-shown]").count()) > 0)
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
      // Its title, renamed from its ⋯, for everyone.
      const notesColumn = `.note-column:has(textarea[data-card="${noted}"])`
      await chooseFromMenuOrThrow(
        page,
        `${notesColumn} .column-menu`,
        ".column-rename",
      )
      const titleBox = `${notesColumn} .open-title-input`
      await page.waitForSelector(titleBox, { timeout: 10_000 })
      await page.fill(titleBox, "Ideas")
      await page.press(titleBox, "Enter")
      const columnRenamed = await waitFor(
        () =>
          [...readCardTitles(host.session).values()].some(
            r => r.title === "Ideas",
          ),
        10_000,
      )
      // The record reaches the page apart from the reply.
      await page
        .waitForFunction(
          s => document.querySelector(s)?.textContent === "Ideas",
          `${notesColumn} .note-column-title [data-fold-name]`,
          { timeout: 10_000 },
        )
        .catch(() => {})
      const shownTitle = await page
        .textContent(`${notesColumn} .note-column-title [data-fold-name]`)
        .catch(() => null)
      check(
        "a note column is renamed from its header, for everyone",
        columnRenamed >= 0 && shownTitle === "Ideas",
        `${columnRenamed} ms; ${[...readCardTitles(host.session).values()].map(r => r.title).join()}; shown ${shownTitle}`,
      )

      // Pin a card, in the conversation below, which has no pinned card:
      // its ⋯ offers it, and the box it opens in the strip makes a pinned
      // card. Enter there is a new line; Alt+↑ hands the card to the strip,
      // focused there, and closes the box; the card stays pinned, and "+ pin"
      // is the strip's. It is the strip's only card, so nothing moves.
      await chooseFromMenuOrThrow(page, `${col(1)} .column-menu`, ".column-pin")
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
        "Pin a card in a column's ⋯ opens a box in the strip where Enter is a new line; Alt+↑ there hands the card it makes to the strip, focused, and it stays pinned",
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
          { card: traced, from: placeKey(tracedFrom), to: pinTo },
          { actedAt: { kind: "column", key: "k-api" }, slot: null },
        )
      await stepBack(page, rootCanvas(downRoot))
      const traceRow = `${col(1)} .trace`
      const drawnTrace = await appears(traceRow)
      const traceText = (await page.textContent(traceRow).catch(() => "")) ?? ""
      await page.click(traceRow).catch(() => {})
      const leads = await appears(
        `${col(0)} .pinned-strip textarea[data-card="${traced}"]`,
      )
      // The inventory, left open in the middle of the screen, would cover it.
      if ((await page.locator(".inventory[data-shown]").count()) > 0)
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

      // The theme: the suite's browser is set light, so Dark is a change of
      // the page's own, which the device keeps through a reload.
      const pageIsDark = () =>
        page
          .waitForFunction(
            () =>
              document.documentElement.dataset.theme === "dark" &&
              getComputedStyle(document.body).backgroundColor ===
                "rgb(20, 22, 26)",
            undefined,
            { timeout: 10_000 },
          )
          .then(
            () => true,
            () => false,
          )
      const choseDark = await chooseFromMenu(
        page,
        "#bottom .me-trigger",
        '.account-theme[data-choice="dark"]',
      )
      const darkNow = choseDark && (await pageIsDark())
      await page.keyboard.press("Escape")

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
      const darkKept = await pageIsDark()
      check(
        "Dark in the account menu draws the page dark over a light system, and a reload keeps it",
        darkNow && darkKept,
        `chosen ${darkNow}, after a reload ${darkKept}`,
      )
      await chooseFromMenuOrThrow(
        page,
        "#bottom .me-trigger",
        '.account-theme[data-choice="system"]',
      )
      await page.keyboard.press("Escape")
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
      // What you typed comes back as any card's text reaches a client that
      // opens it fresh: the note another window reads, above.
      // Your inventory is kept as you left it: the kept card in slot 5.
      await page.click("#bottom .inventory-toggle")
      const stillInSlot = await appears(
        `.inventory .slot[data-slot="5"][data-card="${thought}"]`,
      )
      check("a reload keeps your inventory's cards in their slots", stillInSlot)
      await page.click(`.inventory .slot[data-card="${thought}"]`)
      await page.click(".inventory .bench .trash-selected")
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
      const here = canvasHolding(host, entryId(downRoot))
      const far = await api.send("a root of another canvas", ROOT, {
        mode: "branch",
      })
      const farEntry = far.kind === "appended" ? far.id : entryId("none")
      await waitFor(() => {
        try {
          return canvasHolding(host, farEntry) !== undefined
        } catch {
          return false
        }
      }, 10_000)
      const farThread = threadHolding(host, farEntry)
      await api.moveCard(
        {
          card: farThread,
          from: { kind: "canvas", canvas: canvasHolding(host, farEntry) },
          to: { kind: "canvas-at", canvas: here, after: null },
        },
        { actedAt: { kind: "column", key: "k-api" }, slot: null },
      )
      // The rail draws messages a person reads: a root's first entry can be
      // its thread's system prompt, so its tree is found by its first message.
      const ownTree = heldTree(host)
      const ownThread = ownTree.entries[entryId(downRoot)]?.thread
      const ownFirst =
        ownThread === undefined
          ? downRoot
          : (threadFirstMessage(ownTree, ownThread) ?? downRoot)
      const twoRoots = await page
        .waitForFunction(
          ([thread, entry, own]) =>
            document.querySelector(`#strip [data-card="${thread}"]`) !== null &&
            document.querySelector(`.rail [data-entry="${entry}"]`) !== null &&
            document.querySelector(`.rail [data-entry="${own}"]`) !== null,
          [farThread, farEntry, ownFirst],
          { timeout: 20_000 },
        )
        .then(
          () => true,
          () => false,
        )
      check(
        "a thread moved onto the canvas from another canvas's makes a canvas of two roots: its column, and its root's tree on the rail",
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
        .click(`.folded-column[data-card="${farThread}"] .unfold`, {
          timeout: 15_000,
        })
        .catch(() => {})
      const farColumn = `#strip .column[data-card="${farThread}"]`
      // Unfolding moves the columns beside it: a click while they move lands
      // on a neighbour, and the click's retry scrolls the strip until the ⋯
      // is in the window's left half, where its box opens away from the
      // column's messages.
      await page
        .waitForFunction(
          column =>
            document.querySelector(column) !== null &&
            document.getAnimations().every(a => a.id !== "fold"),
          farColumn,
          { timeout: 15_000 },
        )
        .catch(() => {})
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
          const centres = [...box.querySelectorAll('[role^="menuitem"]')].map(
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
      // Copy to this canvas: a new thread forked at its source's end, its
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
          .click(`.folded-column[data-card="${copy}"] .unfold`, {
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
        "Copy to this canvas makes a copy beside its source, its fork row naming what it was copied from",
        copy !== "" && copiedRow,
        copy,
      )

      // Archived by someone else before a reload, the root you were on gives
      // way to the last of the sidebar (`pruneLayout`'s unit tests), and the
      // page draws that with no error, which the check below reads.
      await moveCanvasOnBoard(api, entryId(downRoot), "archive")
      await page.reload({ waitUntil: "domcontentloaded" })
      await page
        .waitForFunction(
          r => {
            const on = document
              .querySelector('#sidebar [aria-current="true"]')
              ?.getAttribute("data-canvas")
            return on != null && on !== r
          },
          rootCanvas(downRoot),
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
      await kit.close()
    }
  } finally {
    await browser.close().catch(() => {})
  }
}
