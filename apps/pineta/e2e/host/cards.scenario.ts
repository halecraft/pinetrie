// e2e/host/cards — what you type, kept on its thread (ADR-0048).

import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { SessionClient } from "@pineta/client/session"
import { type CardId, cardId, type LaneName, ROOT } from "@pineta/core"
import { yourCard } from "@pineta/marginalia"
import { scriptedModel } from "@pineta/pi"
import { readCards, readLanes, readSeats, readTreeIndex } from "@pineta/reads"
import { cardDocId, readLaneNames, readLaneTip } from "@pineta/schema"
import { startHost } from "../../host/index.ts"
import { openStore } from "../../host/store.ts"
import type { Checks } from "../checks.ts"
import { join, noQueued, waitFor } from "../harness.ts"
import type { Scenario } from "../scenario.ts"

import { at, LATE_LOAD_MS, START_AGENT, sleep, slowToLoad } from "./support.ts"

export const scenario: Scenario = {
  run: ({ check }) => run(check),
}

async function run(check: Checks["check"]): Promise<void> {
  // Its own host, with a store to restart over.
  {
    const dbFile = path.join(
      mkdtempSync(path.join(tmpdir(), "pineta-cards-")),
      "pineta.db",
    )
    const script = scriptedModel()
    const open = () =>
      startHost({
        model: { kind: "scripted", script },
        store: dbFile,
        log: () => {},
      })
    let ch = await open()
    const ada = await join(ch, "ada", "cards")
    const bea = await join(ch, "bea", "cards")
    await Promise.all([ada.setName("Ada"), bea.setName("Bea")])
    const tipOf = () => {
      const l = readLaneNames(ch.doc)[0]
      return l === undefined ? null : readLaneTip(ch.doc, l)
    }
    const cIdle = () =>
      waitFor(
        () => Object.keys(ch.doc.activeRuns()).length === 0 && noQueued(ch),
        30_000,
      )
    const onHost = (id: CardId) => readCards(ch.cards).find(c => c.id === id)
    const drafting = (end: string | null) =>
      ({ kind: "drafting", at: at(end), lane: null }) as const
    const newCard = (
      who: SessionClient,
      end: string | null,
      text: string,
    ): CardId => {
      const id = cardId(crypto.randomUUID())
      who.createCard(
        {
          id,
          owner: who.writer,
          place: drafting(end),
          command: null,
          unsent: null,
        },
        text,
      )
      return id
    }

    script.use([{ text: "Ready." }])
    await ada.chat("@agent start", ROOT, START_AGENT)
    await cIdle()
    const end = tipOf()

    // 1. Ada's card at the lane's end reaches Bea, who types in it; after two
    // more messages it is still Ada's card at the new end.
    const c1 = newCard(ada, end, "@agent next: ")
    const beaSees = await waitFor(
      () =>
        readCards(bea.cards).some(c => c.id === c1) &&
        bea.cardText(c1).text() === "@agent next: ",
      5_000,
    )
    bea.cardText(c1).text.insert(13, "write the tests.")
    const typed = "@agent next: write the tests."
    await waitFor(
      () => ada.cardText(c1).text() === typed && ch.cardText(c1) === typed,
      5_000,
    )
    await bea.chat("@Ada one", at(end), { mode: "reply" })
    await bea.chat("@Ada two", at(tipOf()), { mode: "reply" })
    await cIdle()
    const grown = tipOf()
    const idx = readTreeIndex(ch.doc)
    const found = yourCard(
      ada.writer,
      { kind: "end", end: grown ?? "" },
      readCards(ada.cards),
      readLanes(ch.doc, idx, readCards(ch.cards)),
      idx,
    )
    check(
      "a card at a thread's end reaches the others, and is still its owner's there after the thread grows",
      beaSees >= 0 && grown !== end && found?.id === c1,
    )

    // 2. Ada sends it: at the new end, with Bea as contributor; the card is spent.
    script.use([{ text: "Tests it is." }])
    const SEND1 = crypto.randomUUID()
    await ada.chat(typed, at(grown), { id: SEND1, card: c1 })
    await cIdle()
    await ch.quiet()

    // 2b. Undo in a card reaches only that card (ADR-0052): A's undo passes
    // over B's newer creation. A sent card's copy is destroyed once the host
    // lets go of it (S64), so its steps no longer stand; undoing past a card's
    // creation keeps the copy, so redo brings it back.
    const kept = newCard(ada, tipOf(), "kept")
    ada.undoFor(kept).typing(() => ada.cardText(kept).text.insert(4, " more"))
    const spentCard = newCard(ada, tipOf(), "@Bea spent")
    await waitFor(
      () =>
        ch.cardText(kept) === "kept more" &&
        ch.cardText(spentCard) === "@Bea spent",
      5_000,
    )
    await ada.undoFor(kept).undo()
    const own = await waitFor(() => ch.cardText(kept) === "kept", 5_000)
    const othersLeft = onHost(spentCard) !== undefined
    await ada.chat("@Bea spent", at(tipOf()), { card: spentCard })
    const dropped = await waitFor(
      () => !ada.exchange.has(cardDocId(spentCard)),
      5_000,
    )
    const sentUndo = await ada.undoFor(spentCard).undo()
    await ada.undoFor(kept).undo()
    const uncreated = await waitFor(() => onHost(kept) === undefined, 5_000)
    await ch.quiet()
    const stillHeld = ada.exchange.has(cardDocId(kept))
    await ada.undoFor(kept).redo()
    const redone = await waitFor(
      () => onHost(kept) !== undefined && ch.cardText(kept) === "kept",
      5_000,
    )
    check(
      "undo in a card reaches only that card, and a sent card's steps act on nothing; undoing past a card's creation and redoing brings back its record and text",
      own >= 0 &&
        othersLeft &&
        dropped >= 0 &&
        !sentUndo &&
        uncreated >= 0 &&
        stillHeld &&
        redone >= 0,
      `${[own, othersLeft, dropped, sentUndo, uncreated, stillHeld, redone].join()}; ${ch.cardText(kept)}`,
    )
    // Creating another card writes another key and another text, so it clears
    // nothing of the first card's redo: the redo brings it back whole (S64,
    // addendum 3).
    await ada.undoFor(kept).undo()
    await waitFor(() => onHost(kept) === undefined, 5_000)
    const other = newCard(ada, tipOf(), "another")
    await waitFor(() => onHost(other) !== undefined, 5_000)
    await ada.undoFor(kept).redo()
    await waitFor(
      () => onHost(kept) !== undefined && ch.cardText(kept) === "kept",
      5_000,
    )

    // 3. A compelled send to a busy lane is a conflict, and the card stays.
    script.use([{ text: "A long answer." }, { text: "later" }])
    const longOne = script.pause("@agent a long one")
    await bea.chat("@agent a long one", at(tipOf()), { mode: "reply" })
    await waitFor(() => longOne.reached, 10_000)
    const busyEnd = tipOf()
    const c2 = newCard(ada, busyEnd, "@agent me too")
    await waitFor(() => ch.cardText(c2) === "@agent me too", 5_000)
    await ada.chat("@agent me too", at(busyEnd), { card: c2 })

    // 4. The busy lane's queue (ADR-0048). A plain send is `busy`, and
    // nothing is written. Bea queues Ada's card, and Ada edits it while it
    // waits; Ada queues another and unqueues it.
    const lane = (readLaneNames(ch.doc)[0] ?? "") as LaneName
    const c3 = newCard(ada, busyEnd, "@Ada the plan")
    await waitFor(() => ch.cardText(c3) === "@Ada the plan", 5_000)
    const busy = await bea.chat("@Ada the plan", at(busyEnd), { card: c3 })
    bea.queueCard(c3, { lane, at: at(busyEnd) })
    await waitFor(() => ada.cardText(c3).text() === "@Ada the plan", 5_000)
    ada.cardText(c3).text.insert(13, " is ready")
    const c5 = newCard(ada, busyEnd, "@Bea never mind")
    await waitFor(() => ch.cardText(c5) === "@Bea never mind", 5_000)
    ada.queueCard(c5, { lane, at: at(busyEnd) })
    await waitFor(() => onHost(c5)?.place.kind === "queued", 5_000)
    ada.unqueueCard(c5, { lane, by: ada.writer })
    await waitFor(
      () =>
        onHost(c5)?.place.kind === "drafting" &&
        ch.cardText(c3) === "@Ada the plan is ready",
      5_000,
    )
    longOne.resume()
    await cIdle()
    await ch.quiet()
    const index3 = readTreeIndex(ch.doc)
    const sent3 = Object.values(index3.entries).find(
      e =>
        e.message?.role === "chat" &&
        e.message.content === "@Ada the plan is ready",
    )?.message
    check(
      "a queued card is taken when the run ends: its queuer's message, with the edits made while it waited",
      busy.kind === "busy" &&
        sent3?.writer === bea.writer &&
        sent3.contributors?.join() === ada.writer &&
        onHost(c3) === undefined,
      `${busy.kind}; ${sent3?.writer ?? "not sent"}`,
    )
    const neverSent = !Object.values(index3.entries).some(
      e =>
        e.message?.role === "chat" && e.message.content === "@Bea never mind",
    )
    check(
      "an unqueued card is not sent, and is below the line again for everyone",
      neverSent &&
        onHost(c5)?.place.kind === "drafting" &&
        readCards(bea.cards).find(c => c.id === c5)?.place.kind === "drafting",
      `${neverSent}; ${onHost(c5)?.place.kind}`,
    )

    // 4b. A card queued on an idle thread is taken at once.
    const idleEnd = tipOf()
    const c6 = newCard(ada, idleEnd, "@Bea while it is quiet")
    await waitFor(() => ch.cardText(c6) === "@Bea while it is quiet", 5_000)
    ada.queueCard(c6, { lane, at: at(idleEnd) })
    const taken = await waitFor(
      () =>
        Object.values(readTreeIndex(ch.doc).entries).some(
          e =>
            e.message?.role === "chat" &&
            e.message.content === "@Bea while it is quiet",
        ),
      5_000,
    )
    check(
      "a card queued on an idle thread is taken at once",
      taken >= 0 && onHost(c6) === undefined,
      `${taken} ms`,
    )
    await ch.quiet()

    // 5. Bea sends Ada's card after Ada has left: Bea's message, with Ada,
    // named through her seat's record.
    const c4 = newCard(ada, tipOf(), "@Bea over to you")
    await waitFor(() => ch.cardText(c4) === "@Bea over to you", 5_000)
    await ada.close()
    await sleep(200)
    const SEND4 = crypto.randomUUID()
    const sent4 = await bea.chat("@Bea over to you", at(tipOf()), {
      id: SEND4,
      card: c4,
    })
    await ch.quiet()
    const index4 = readTreeIndex(ch.doc)
    const msg4 = index4.entries[index4.bySend.get(SEND4) ?? ""]
    check(
      "someone else's card, sent after its owner left, names them as contributor",
      sent4.kind === "appended" &&
        msg4?.message?.writer === bea.writer &&
        msg4.message.contributors?.join() === ada.writer &&
        onHost(c4) === undefined,
      `${sent4.kind}`,
    )

    // 6. A restart sweeps: an empty card, a stored card text with no record,
    // and a seat no text names; a card with text is back.
    const keep = newCard(bea, tipOf(), "kept across a restart")
    const empty = newCard(bea, tipOf(), "")
    const orphan = cardId(crypto.randomUUID())
    bea.cardText(orphan).text.insert(0, "no record")
    const zed = await join(ch, "zed", "cards")
    await waitFor(
      () =>
        ch.cardText(keep) === "kept across a restart" &&
        ch.cardText(orphan) === "no record" &&
        onHost(empty) !== undefined &&
        readSeats(ch.doc).some(s => s.writer === zed.writer),
      5_000,
    )
    await Promise.all([bea.close(), zed.close()])
    await ch.shutdown()
    // The empty card's text loads late, so a host that served before its
    // sweep finished would still hold the card.
    const reopened = openStore(dbFile)
    ch = await startHost({
      model: { kind: "scripted", script },
      store: slowToLoad(reopened.store, cardDocId(empty), LATE_LOAD_MS),
      blobs: reopened.blobs,
      log: () => {},
    })
    // Read as `startHost` returns, before any client could connect.
    check(
      "a starting host has swept before it returns: no empty card is left for a client to find",
      onHost(empty) === undefined,
    )
    const eve = await join(ch, "eve", "cards")
    await ch.quiet()
    await waitFor(
      () => eve.cardText(keep).text() === "kept across a restart",
      5_000,
    )
    await eve.close()
    await ch.shutdown()
    // Read the store once the host has let it go: it owns its file (S47).
    const stored: string[] = []
    const closed = openStore(dbFile)
    for await (const d of closed.store.listDocIds("card:")) stored.push(d)
  }
}
