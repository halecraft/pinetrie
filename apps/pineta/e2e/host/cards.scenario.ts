// e2e/host/cards — what you type, kept on its thread (ADR-0048).

import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { SessionClient } from "@pineta/client/session"
import { type CardId, cardId, entryId, type LaneName, ROOT } from "@pineta/core"
import { yourCard } from "@pineta/marginalia"
import { scriptedModel } from "@pineta/pi"
import { PLACES_DOC_ID } from "@pineta/protocol/messages"
import { readLanes, readPlaces, readSeats, readTreeIndex } from "@pineta/reads"
import {
  cardDocId,
  InventoryDoc,
  inventoryDocId,
  PlacesDoc,
  readLaneNames,
  readLaneTip,
} from "@pineta/schema"
import { startHost } from "../../host/index.ts"
import { openStore } from "../../host/store.ts"
import type { Checks } from "../checks.ts"
import { idleNow, join, waitFor } from "../harness.ts"
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
    const cIdle = () => waitFor(() => idleNow(ch), 30_000)
    const onHost = (id: CardId) => readPlaces(ch.places).find(c => c.id === id)
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
          placer: who.writer,
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
        bea.cards.current().some(c => c.id === c1) &&
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
      { kind: "end", end: grown ?? entryId("") },
      ada.cards.current(),
      readLanes(ch.doc, idx, readPlaces(ch.places)),
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
    // lets go of it (S64), so its steps no longer stand. Undoing past a card's
    // creation empties it and keeps its record, which only the host writes
    // (ADR-0059), so redo brings its text back.
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
    const emptied = await waitFor(() => ch.cardText(kept) === "", 5_000)
    await ch.quiet()
    const recordKept = onHost(kept) !== undefined
    const stillHeld = ada.exchange.has(cardDocId(kept))
    await ada.undoFor(kept).redo()
    const redone = await waitFor(
      () => onHost(kept) !== undefined && ch.cardText(kept) === "kept",
      5_000,
    )
    check(
      "undo in a card reaches only that card, and a sent card's steps act on nothing; undoing past a card's creation empties it and keeps its record, and redo brings its text back",
      own >= 0 &&
        othersLeft &&
        dropped >= 0 &&
        !sentUndo &&
        emptied >= 0 &&
        recordKept &&
        stillHeld &&
        redone >= 0,
      `${[own, othersLeft, dropped, sentUndo, emptied, recordKept, stillHeld, redone].join()}; ${ch.cardText(kept)}`,
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

    // 4. The busy lane's queue (ADR-0048, ADR-0059). Bea sends Ada's card
    // there: the host queues it in the same step, as Bea's. Ada edits it while
    // it waits; Ada queues another and unqueues it.
    const lane = (readLaneNames(ch.doc)[0] ?? "") as LaneName
    const c3 = newCard(ada, busyEnd, "@Ada the plan")
    await waitFor(
      () =>
        ch.cardText(c3) === "@Ada the plan" &&
        bea.cards.current().some(c => c.id === c3),
      5_000,
    )
    const busy = await bea.chat("@Ada the plan", at(busyEnd), { card: c3 })
    await waitFor(() => onHost(c3)?.place.kind === "queued", 5_000)
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
      "a send that finds its lane busy queues its card in one step, and the card is taken when the run ends: its queuer's message, with the edits made while it waited",
      busy.kind === "queued" &&
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
        bea.cards.current().find(c => c.id === c5)?.place.kind === "drafting",
      `${neverSent}; ${onHost(c5)?.place.kind}`,
    )

    // 4b. A card queued on an idle thread is taken at once. It is queued as
    // soon as it is made, as the bring-up-to-date button's card can be: its
    // record can reach the host before its text (S72), and the take waits.
    const idleEnd = tipOf()
    const c6 = newCard(ada, idleEnd, "@Bea while it is quiet")
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
      "a card queued on an idle thread is taken at once, with all its text, though its record can reach the host before its text",
      taken >= 0 && onHost(c6) === undefined,
      `${taken} ms`,
    )
    await ch.quiet()

    // 4c. An unqueue sent right behind a queue on an idle thread: the queue's
    // step queued the drain, so the take is on the host's `Serial` first, and
    // the unqueue is refused as gone (ADR-0059). Ada's client says it was sent.
    const quickEnd = tipOf()
    const c7 = newCard(ada, quickEnd, "@Bea too quick")
    await waitFor(() => ch.cardText(c7) === "@Bea too quick", 5_000)
    ada.queueCard(c7, { lane, at: at(quickEnd) })
    ada.unqueueCard(c7, { lane, by: ada.writer })
    const told = await waitFor(
      () =>
        ada.refusals.current().some(r => r.card === c7 && r.code === "gone"),
      5_000,
    )
    await ch.quiet()
    const sent7 = Object.values(readTreeIndex(ch.doc).entries).some(
      e => e.message?.role === "chat" && e.message.content === "@Bea too quick",
    )
    check(
      "an unqueue the take got to first is refused as gone, and its client says it was sent",
      told >= 0 && sent7 && onHost(c7) === undefined,
      `${told}; sent ${sent7}`,
    )

    // 4d. A client's write to the places document is refused: only the host
    // writes it (ADR-0059). A throwaway session writes it, since the writer's
    // copy keeps its own value for good (S76).
    const mallory = await join(ch, "mallory", "cards")
    const forged = cardId(crypto.randomUUID())
    mallory.exchange.get(PLACES_DOC_ID, PlacesDoc).cards.set(forged, {
      owner: mallory.writer,
      kind: "fresh",
      at: "",
      lane: "",
      column: "forged",
      order: "",
      by: "",
      seen: "",
      command: "",
      unsent: "",
      placer: mallory.writer,
      holder: "",
    })
    await sleep(500)
    await ch.quiet()
    check(
      "a client's write to the places is refused: the host's copy is unchanged",
      onHost(forged) === undefined,
    )
    await mallory.close()

    // 4e. Your inventory (ADR-0059): a take reaches your other session's
    // inventory and nobody else's; nobody else moves a card out of it; and it
    // holds 18 cards. Each move is a client's request over the wire.
    const ada2 = await join(ch, "ada", "cards")
    const mine = { kind: "inventory", holder: ada.writer } as const
    const into = (slot: number) =>
      ({
        actedAt: { kind: "inventory" },
        history: { kind: "none" },
        slot,
      }) as const
    const taking = newCard(ada, tipOf(), "for later")
    await waitFor(() => onHost(taking) !== undefined, 5_000)
    const took = await ada.moveCard(
      { card: taking, from: drafting(tipOf()), to: mine },
      into(3),
    )
    const otherSession = await waitFor(
      () => ada2.slots.current()["3"] === taking,
      5_000,
    )
    const beaView = bea.exchange.get(inventoryDocId(ada.writer), InventoryDoc)
    beaView.slots.set("7", "planted")
    await sleep(500)
    await ch.quiet()
    const hidden =
      Object.keys(beaView.slots()).every(s => s === "7") &&
      ada.slots.current()["7"] === undefined &&
      ada2.slots.current()["7"] === undefined
    check(
      "a take reaches your other session's inventory and nobody else's, and nobody else writes it",
      took.kind === "accepted" && otherSession >= 0 && hidden,
      `${took.kind}; other session ${otherSession}; Bea sees ${JSON.stringify(beaView.slots())}`,
    )
    const stolen = await bea.moveCard(
      {
        card: taking,
        from: mine,
        to: { kind: "inventory", holder: bea.writer },
      },
      into(0),
    )
    check(
      "a move out of someone else's inventory is refused, as not theirs",
      stolen.kind === "refused" &&
        stolen.refusal?.code === "not-yours" &&
        onHost(taking)?.place.kind === "inventory",
      JSON.stringify(stolen),
    )
    const filled = await Promise.all(
      Array.from({ length: 17 }, (_, n) =>
        ada.createCard(
          {
            id: cardId(crypto.randomUUID()),
            owner: ada.writer,
            placer: ada.writer,
            place: mine,
            command: null,
            unsent: null,
          },
          `held ${n}`,
          into(n < 3 ? n : n + 1),
        ),
      ),
    )
    const nineteenth = newCard(ada, tipOf(), "one too many")
    await waitFor(() => onHost(nineteenth) !== undefined, 5_000)
    const tooMany = await ada.moveCard(
      { card: nineteenth, from: drafting(tipOf()), to: mine },
      into(2),
    )
    check(
      "the nineteenth card is refused: the inventory is full",
      filled.every(a => a.kind === "accepted") &&
        tooMany.kind === "refused" &&
        tooMany.refusal?.code === "full",
      JSON.stringify(tooMany),
    )
    await ada2.close()

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
    const wrote4 = index4.bySend.get(SEND4)
    const msg4 = wrote4 === undefined ? undefined : index4.entries[wrote4]
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
