// e2e/host/cards — what you type, kept on its thread (ADR-0048).

import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  type CardId,
  cardId,
  entryId,
  type LaneName,
  ROOT,
} from "@pinetrie/core"
import { scriptedModel } from "@pinetrie/pi"
import { PLACES_DOC_ID } from "@pinetrie/protocol/messages"
import { personDocId } from "@pinetrie/protocol/writers"
import {
  readPlaces,
  readQueueHolds,
  readReading,
  readSeats,
  readTraces,
  readTypingIn,
} from "@pinetrie/reads"
import { yourCard } from "@pinetrie/rules"
import { cardDocId, InventoryDoc, PlacesDoc } from "@pinetrie/schema"
import type { SessionClient } from "@pinetrie/session"
import { openStore } from "../../host/store.ts"
import type { Checks } from "../checks.ts"
import {
  idleNow,
  join,
  laneNamesOf,
  lanesOf,
  lateFor,
  queueCard,
  refusedWrite,
  rootAt,
  startSuiteHost,
  tipIn,
  treeOf,
  unqueueCard,
  waitFor,
} from "../harness.ts"
import type { Scenario } from "../scenario.ts"
import { at, LATE_LOAD_MS, START_AGENT, sleep, slowToLoad } from "./support.ts"

export const scenario: Scenario = {
  run: ({ check }) => run(check),
}

async function run(check: Checks["check"]): Promise<void> {
  // Its own host, with a store to restart over.
  {
    const dbFile = path.join(
      mkdtempSync(path.join(tmpdir(), "pinetrie-cards-")),
      "pinetrie.db",
    )
    const script = scriptedModel()
    const open = () =>
      startSuiteHost({
        model: { kind: "scripted", script },
        store: dbFile,
        log: () => {},
      })
    let ch = await open()
    const ada = await join(ch, "ada", "cards")
    const bea = await join(ch, "bea", "cards")
    await Promise.all([
      ada.request({ kind: "name", name: "Ada" }),
      bea.request({ kind: "name", name: "Bea" }),
    ])
    const tipOf = () => {
      const l = laneNamesOf(ch)[0]
      return l === undefined ? null : tipIn(ch, l)
    }
    const cIdle = () => waitFor(() => idleNow(ch), 30_000)
    const onHost = (id: CardId) => readPlaces(ch.places).find(c => c.id === id)
    const drafting = (end: string | null) =>
      ({
        kind: "drafting",
        root: rootAt(ch, at(end)),
        at: at(end),
        lane: null,
      }) as const
    const newCard = (
      who: SessionClient,
      end: string | null,
      text: string,
    ): CardId => {
      const id = cardId(crypto.randomUUID())
      who.createCard(
        {
          id,
          place: drafting(end),
          carries: { kind: "message", command: null },
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
    const idx = treeOf(ch)
    const found = yourCard(
      ada.writer,
      { kind: "end", end: grown ?? entryId("") },
      ada.cards.current(),
      lanesOf(ch, idx, readPlaces(ch.places)),
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
        sentUndo.kind === "none" &&
        emptied >= 0 &&
        recordKept &&
        stillHeld &&
        redone >= 0,
      `${[own, othersLeft, dropped, sentUndo.kind, emptied, recordKept, stillHeld, redone].join()}; ${ch.cardText(kept)}`,
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
    const lane = (laneNamesOf(ch)[0] ?? "") as LaneName
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
    void queueCard(ada, c5, { lane, at: at(busyEnd) })
    await waitFor(() => onHost(c5)?.place.kind === "queued", 5_000)
    void unqueueCard(ada, c5)
    await waitFor(
      () =>
        onHost(c5)?.place.kind === "drafting" &&
        ch.cardText(c3) === "@Ada the plan is ready",
      5_000,
    )
    longOne.resume()
    await cIdle()
    await ch.quiet()
    const index3 = treeOf(ch)
    const sent3 = Object.values(index3.entries).find(
      e =>
        e.message?.role === "chat" &&
        e.message.content === "@Ada the plan is ready",
    )?.message
    check(
      "a send that finds its lane busy queues its card in one step, and the card is popped when the run ends: its queuer's message, with the edits made while it waited",
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

    // 4b. A card queued on an idle thread is popped at once. It is queued as
    // soon as it is made, as the bring-up-to-date button's card can be: its
    // record can reach the host before its text (S96), and the pop waits.
    const idleEnd = tipOf()
    const c6 = newCard(ada, idleEnd, "@Bea while it is quiet")
    void queueCard(ada, c6, { lane, at: at(idleEnd) })
    const popped = await waitFor(
      () =>
        Object.values(treeOf(ch).entries).some(
          e =>
            e.message?.role === "chat" &&
            e.message.content === "@Bea while it is quiet",
        ),
      5_000,
    )
    check(
      "a card queued on an idle thread is popped at once, with all its text, though its record can reach the host before its text",
      popped >= 0 && onHost(c6) === undefined,
      `${popped} ms`,
    )
    await ch.quiet()

    // 4c. An unqueue sent right behind a queue on an idle thread: the queue's
    // step queued the drain, so the pop is on the documents' keeper first, and
    // the unqueue is refused as gone (ADR-0059). Ada's client says it was sent.
    const quickEnd = tipOf()
    const c7 = newCard(ada, quickEnd, "@Bea too quick")
    await waitFor(() => ch.cardText(c7) === "@Bea too quick", 5_000)
    void queueCard(ada, c7, { lane, at: at(quickEnd) })
    void unqueueCard(ada, c7)
    const told = await waitFor(
      () =>
        ada.moves
          .current()
          .refusals.some(r => r.card === c7 && r.code === "gone"),
      5_000,
    )
    await ch.quiet()
    const sent7 = Object.values(treeOf(ch).entries).some(
      e => e.message?.role === "chat" && e.message.content === "@Bea too quick",
    )
    check(
      "an unqueue the pop got to first is refused as gone, and its client says it was sent",
      told >= 0 && sent7 && onHost(c7) === undefined,
      `${told}; sent ${sent7}`,
    )

    // 4d. The top queued card waits while someone types in it (ADR-0048
    // step 7): Ada types in her card as she queues it on the idle thread.
    // The host hears her typing through presence, waits, and pops it once
    // her typing decays.
    const typeEnd = tipOf()
    const c8 = newCard(ada, typeEnd, "@Bea wait for me")
    await waitFor(() => ch.cardText(c8) === "@Bea wait for me", 5_000)
    ada.setTyping(typeEnd ?? "", c8)
    await waitFor(() => readTypingIn(ch.presence).has(c8), 5_000)
    void queueCard(ada, c8, { lane, at: at(typeEnd) })
    await waitFor(() => onHost(c8)?.place.kind === "queued", 5_000)
    await ch.quiet()
    const waited = onHost(c8)?.place.kind === "queued"
    const sent8 = await waitFor(
      () =>
        onHost(c8) === undefined &&
        Object.values(treeOf(ch).entries).some(
          e =>
            e.message?.role === "chat" &&
            e.message.content === "@Bea wait for me",
        ),
      10_000,
    )
    check(
      "the top queued card waits while someone types in it, and is popped once their typing decays",
      waited && sent8 >= 0,
      `waited ${waited}; popped after ${sent8} ms`,
    )
    await ch.quiet()

    // 4e. Pinned cards (ADR-0048 step 5, S92): a card pinned at the thread's
    // end is read by the agent's next run, in a cards entry pi writes with
    // the run's prompt, before it.
    const pinEnd = tipOf()
    const pin = newCard(ada, pinEnd, "ship the sync fix")
    await waitFor(
      () =>
        onHost(pin) !== undefined && ch.cardText(pin) === "ship the sync fix",
      5_000,
    )
    await ada.moveCard(
      {
        card: pin,
        from: drafting(pinEnd),
        to: {
          kind: "pinned",
          root: rootAt(ch, at(pinEnd)),
          at: at(pinEnd),
          lane: null,
        },
      },
      { actedAt: { kind: "column", key: "k-pin" }, slot: null },
    )
    let readCards: readonly string[] = []
    script.use([
      {
        reply: context => {
          readCards = context
          return "Pinned, noted."
        },
      },
    ])
    await ada.chat("@agent go on", at(pinEnd), { pinned: [pin] })
    await cIdle()
    const prompt = Object.values(treeOf(ch).entries).find(
      e => e.message?.role === "chat" && e.message.content === "@agent go on",
    )
    const parent =
      prompt?.parentId == null ? undefined : treeOf(ch).entries[prompt.parentId]
    // The system prompt names the block too (`PINNED_RULE`): the entry starts with it.
    const cardsAt = readCards.findIndex(t => t.startsWith("<pinned-cards>"))
    check(
      "a run's prompt follows a cards entry holding the thread's pinned cards, and the model is given them",
      parent?.message?.role === "pinned" &&
        parent.message.pinned?.cards[0]?.text === "ship the sync fix" &&
        cardsAt === readCards.length - 2 &&
        (readCards[cardsAt] ?? "").includes("ship the sync fix") &&
        readCards.at(-1) === "Ada: @agent go on",
      `${parent?.message?.role}; ${cardsAt} of ${readCards.length}`,
    )

    // 4f. A pinned card's text typed just before a send reaches that run:
    // Kyneta keeps no order between documents (S96), so the run waits for
    // the text as its sender had it (`seen`). A second session of Ada's
    // sends her writes to the card's document 300 ms late (`lateFor`): her
    // card is made, pinned and sent at once, and the commands arrive first.
    const editEnd = tipOf()
    const late = cardId(crypto.randomUUID())
    const adaLate = await join(ch, "ada", "cards", {
      WebSocket: lateFor(cardDocId(late), 300),
    })
    script.use([
      {
        reply: context => {
          readCards = context
          return "Edited, noted."
        },
      },
    ])
    const pinnedHere = {
      kind: "pinned",
      root: rootAt(ch, at(editEnd)),
      at: at(editEnd),
      lane: null,
      // The host gives it its order: a key carries none.
      order: "",
    } as const
    void adaLate.createCard(
      {
        id: late,
        place: pinnedHere,
        carries: { kind: "message", command: null },
        unsent: null,
      },
      "typed just before the send",
    )
    await adaLate.chat("@agent and now", at(editEnd), { pinned: [pin, late] })
    await cIdle()
    const lastCards =
      readCards.findLast(t => t.startsWith("<pinned-cards>")) ?? ""
    check(
      "an edit to a pinned card made just before a send reaches that run",
      lastCards.includes("typed just before the send"),
      lastCards.slice(0, 200),
    )
    await adaLate.close()
    await ch.quiet()

    // 4g. Traces (ADR-0048 step 6): Bea pins a card of Ada's while Ada has no
    // column open at its thread, which leaves Ada a trace naming Bea; she pins
    // another while Ada reads that thread, which leaves none. The host learns
    // what Ada reads from presence alone.
    const traceEnd = tipOf()
    const pinnedAt = (end: string | null) =>
      ({
        kind: "pinned",
        root: rootAt(ch, at(end)),
        at: at(end),
        lane: null,
      }) as const
    const away = newCard(ada, traceEnd, "pinned while Ada was away")
    const watched = newCard(ada, traceEnd, "pinned while Ada read")
    await waitFor(
      () => onHost(away) !== undefined && onHost(watched) !== undefined,
      5_000,
    )
    const byBea = {
      actedAt: { kind: "column", key: "k-bea" },
      slot: null,
    } as const
    await bea.moveCard(
      { card: away, from: drafting(traceEnd), to: pinnedAt(traceEnd) },
      byBea,
    )
    ada.setReading("k-ada", traceEnd ?? "", rootAt(ch, at(traceEnd)))
    await waitFor(
      () =>
        readReading(ch.presence).some(
          ([w, end]) => w === ada.writer && end === traceEnd,
        ),
      5_000,
    )
    await bea.moveCard(
      { card: watched, from: drafting(traceEnd), to: pinnedAt(traceEnd) },
      byBea,
    )
    const tracesOf = (card: CardId) =>
      [...readTraces(ada.session).values()].filter(t => t.card === card)
    const traced = await waitFor(() => tracesOf(away).length === 1, 5_000)
    const [trace] = tracesOf(away)
    check(
      "a card someone else moves while its placer is away leaves them a trace; none while they read its thread",
      traced >= 0 &&
        trace?.for === ada.writer &&
        trace.by === bea.writer &&
        [...readTraces(ch.session).values()].every(t => t.card !== watched),
      `${tracesOf(away).length} away, ${tracesOf(watched).length} watched`,
    )
    // Seen: the host deletes it, and Ada's copy loses it too.
    await ada.request({ kind: "traces-seen", traces: [trace?.id ?? ""] })
    const gone = await waitFor(() => tracesOf(away).length === 0, 5_000)
    check(
      "a trace its placer has seen is deleted on the host, for every device",
      gone >= 0 &&
        ![...readTraces(ch.session).keys()].includes(trace?.id ?? ""),
    )
    ada.clearReading("k-ada")
    for (const card of [away, watched])
      await bea.moveCard(
        { card, from: pinnedAt(traceEnd), to: drafting(traceEnd) },
        byBea,
      )
    await ch.quiet()

    // 4d. A client cannot write the places document: only the host writes it
    // (ADR-0059), and every peer declares so (`writersPolicy`), so the write
    // throws before it is made. A throwaway session tries it: had it been
    // made, the writer's copy would keep its own value for good (S76).
    const mallory = await join(ch, "mallory", "cards")
    const forged = cardId(crypto.randomUUID())
    const placesRefused = refusedWrite(() =>
      mallory.exchange.get(PLACES_DOC_ID, PlacesDoc).cards.set(forged, {
        owner: mallory.writer,
        kind: "fresh",
        root: "",
        at: "",
        lane: "",
        column: "forged",
        order: "",
        by: "",
        seen: "",
        command: "",
        fact: "",
        unsent: "",
        placer: mallory.writer,
        holder: "",
      }),
    )
    await sleep(500)
    await ch.quiet()
    check(
      "a client cannot write the places: its write is refused before it is made, and the host's copy is unchanged",
      placesRefused && onHost(forged) === undefined,
      `refused ${placesRefused}`,
    )
    await mallory.close()

    // 4e. Your inventory (ADR-0059): a take into it reaches your other
    // session's inventory and nobody else's; nobody else moves a card out of
    // it; and it holds 18 cards. Each move is a client's request over the wire.
    const ada2 = await join(ch, "ada", "cards")
    const mine = { kind: "inventory", holder: ada.writer } as const
    const into = (slot: number) =>
      ({ actedAt: { kind: "inventory" }, slot }) as const
    const forLater = newCard(ada, tipOf(), "for later")
    await waitFor(() => onHost(forLater) !== undefined, 5_000)
    const tookIntoInventory = await ada.moveCard(
      { card: forLater, from: drafting(tipOf()), to: mine },
      into(3),
    )
    const otherSession = await waitFor(
      () => ada2.slots.current()["3"] === forLater,
      5_000,
    )
    const beaView = bea.exchange.get(
      personDocId("inventory", ada.writer),
      InventoryDoc,
    )
    const beaRefused = refusedWrite(() => beaView.slots.set("7", "planted"))
    await sleep(500)
    await ch.quiet()
    const hidden =
      beaRefused &&
      Object.keys(beaView.slots()).length === 0 &&
      ada.slots.current()["7"] === undefined &&
      ada2.slots.current()["7"] === undefined
    check(
      "a take into the inventory reaches your other session's inventory and nobody else's, and nobody else writes it",
      tookIntoInventory.kind === "accepted" && otherSession >= 0 && hidden,
      `${tookIntoInventory.kind}; other session ${otherSession}; Bea refused ${beaRefused}, sees ${JSON.stringify(beaView.slots())}`,
    )
    const stolen = await bea.moveCard(
      {
        card: forLater,
        from: mine,
        to: { kind: "inventory", holder: bea.writer },
      },
      into(0),
    )
    check(
      "a move out of someone else's inventory is refused, as not theirs",
      stolen.kind === "refused" &&
        stolen.refusal?.code === "not-yours" &&
        onHost(forLater)?.place.kind === "inventory",
      JSON.stringify(stolen),
    )

    // 4f. Moves' history (ADR-0066): one per person and root, on the host.
    // Ada's second session undoes, in this root, the take into the inventory
    // her first session made here; her take in another root stays. An undo after Bea moved the
    // card is refused, naming Bea. A keep of three cards is one move.
    const here = rootAt(ch, at(tipOf()))
    const other = await ada.chat("a root of its own", ROOT, { mode: "branch" })
    const otherEnd = other.kind === "appended" ? other.id : null
    const takeIntoInventory = (
      card: CardId,
      end: string | null,
      slot: number,
    ) => ada.moveCard({ card, from: drafting(end), to: mine }, into(slot))
    const a1 = newCard(ada, tipOf(), "taken here")
    const b1 = newCard(ada, otherEnd, "taken there")
    await waitFor(
      () => onHost(a1) !== undefined && onHost(b1) !== undefined,
      5_000,
    )
    await takeIntoInventory(a1, tipOf(), 4)
    await takeIntoInventory(b1, otherEnd, 5)
    const undoneHere = await ada2.undoMoves(here, "undo")
    const a1Back = onHost(a1)?.place.kind === "drafting"
    const b1Stays = onHost(b1)?.place.kind === "inventory"
    const parked = {
      kind: "fresh",
      column: "k-parked",
      root: here,
      at: at(tipOf()),
    } as const
    await ada.moveCard(
      { card: a1, from: drafting(tipOf()), to: parked },
      { actedAt: { kind: "column", key: "k-parked" }, slot: null },
    )
    await waitFor(
      () =>
        bea.cards.current().some(c => c.id === a1 && c.place.kind === "fresh"),
      5_000,
    )
    await bea.moveCard(
      { card: a1, from: parked, to: drafting(tipOf()) },
      { actedAt: { kind: "column", key: "k" }, slot: null },
    )
    const refused = await ada.undoMoves(here, "undo")
    check(
      "Ada's second session undoes, in a root, the move her first session made there; her move in another root stays; an undo after Bea moved the card is refused, naming Bea, and changes nothing",
      undoneHere.kind === "undone" &&
        a1Back &&
        b1Stays &&
        refused.kind === "unmoved" &&
        refused.by === bea.writer &&
        onHost(a1)?.placer === bea.writer &&
        onHost(a1)?.place.kind === "drafting",
      `${undoneHere.kind}, ${a1Back}, ${b1Stays}; ${JSON.stringify(refused)}`,
    )
    const keeping = {
      kind: "fresh",
      column: "k-keep",
      root: here,
      at: at(tipOf()),
    } as const
    const three = ["one", "two", "three"].map(text => {
      const id = cardId(crypto.randomUUID())
      void ada.createCard(
        {
          id,
          place: keeping,
          carries: { kind: "message", command: null },
          unsent: null,
        },
        text,
      )
      return id
    })
    await waitFor(() => three.every(id => onHost(id) !== undefined), 5_000)
    const [k1, k2, k3] = three as [CardId, CardId, CardId]
    const keepAt = (card: CardId, slot: number) => ({
      move: { card, from: keeping, to: mine },
      slot,
    })
    const keep3 = () =>
      ada.moveCards([keepAt(k1, 6), keepAt(k2, 7), keepAt(k3, 8)], {
        kind: "column",
        key: "k-keep",
      })
    // Bea moves one first: the keep is refused whole.
    await waitFor(() => bea.cards.current().some(c => c.id === k3), 5_000)
    await bea.moveCard(
      { card: k3, from: keeping, to: drafting(tipOf()) },
      { actedAt: { kind: "column", key: "k" }, slot: null },
    )
    const refusedWhole = await keep3()
    const noneMoved = [k1, k2].every(id => onHost(id)?.place.kind === "fresh")
    await bea.moveCard(
      { card: k3, from: drafting(tipOf()), to: keeping },
      { actedAt: { kind: "column", key: "k" }, slot: null },
    )
    const keptAll = await keep3()
    const allKept = three.every(id => onHost(id)?.place.kind === "inventory")
    const keepUndone = await ada.undoMoves(here, "undo")
    check(
      "a keep of three cards is one move: refused whole when one has moved, and undone whole",
      refusedWhole.kind === "refused" &&
        noneMoved &&
        keptAll.kind === "accepted" &&
        allKept &&
        keepUndone.kind === "undone" &&
        keepUndone.cards.length === 3 &&
        three.every(id => onHost(id)?.place.kind === "fresh"),
      `${refusedWhole.kind}, ${noneMoved}, ${keptAll.kind}, ${allKept}; ${keepUndone.kind}`,
    )
    // Ada's last move in this root, to undo after a restart (section 6).
    const lastMove = newCard(ada, tipOf(), "moved before the restart")
    await waitFor(() => onHost(lastMove) !== undefined, 5_000)
    await ada.moveCard(
      { card: lastMove, from: drafting(tipOf()), to: parked },
      { actedAt: { kind: "column", key: "k-parked" }, slot: null },
    )

    const filled = await Promise.all(
      // Every slot but the first take's (3) and the other root's (5).
      Array.from({ length: 18 }, (_, n) => n)
        .filter(slot => slot !== 3 && slot !== 5)
        .map(slot =>
          ada.createCard(
            {
              id: cardId(crypto.randomUUID()),
              place: mine,
              carries: { kind: "message", command: null },
              unsent: null,
            },
            `held ${slot}`,
            into(slot),
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
    const index4 = treeOf(ch)
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
        readSeats(ch.session).some(s => s.writer === zed.writer),
      5_000,
    )
    // A held queue (ADR-0048 step 7): Bea holds it, and her send to the idle
    // thread waits in it, across the restart.
    await bea.request({ kind: "queue-hold", lane, held: true })
    const c9 = newCard(bea, tipOf(), "@Ada after the restart")
    await waitFor(() => ch.cardText(c9) === "@Ada after the restart", 5_000)
    const heldSend = await bea.chat("@Ada after the restart", at(tipOf()), {
      card: c9,
    })
    await ch.quiet()
    await Promise.all([bea.close(), zed.close()])
    await ch.shutdown()
    // The empty card's text loads late, so a host that served before its
    // sweep finished would still hold the card.
    const reopened = openStore(dbFile)
    ch = await startSuiteHost({
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
    // Ada's history in that root was kept in the store: her undo undoes her
    // last move there (ADR-0066, S91).
    const adaAgain = await join(ch, "ada", "cards")
    const afterRestart = await adaAgain.undoMoves(here, "undo")
    check(
      "after the host restarts, Ada's undo in a root still undoes her last move there",
      afterRestart.kind === "undone" &&
        onHost(lastMove)?.place.kind === "drafting",
      `${JSON.stringify(afterRestart)}; ${onHost(lastMove)?.place.kind}`,
    )
    await adaAgain.close()
    const eve = await join(ch, "eve", "cards")
    await ch.quiet()
    const heldAcross =
      onHost(c9)?.place.kind === "queued" &&
      readQueueHolds(ch.session).has(lane)
    await eve.request({ kind: "queue-hold", lane, held: false })
    const released = await waitFor(
      () =>
        onHost(c9) === undefined &&
        Object.values(treeOf(ch).entries).some(
          e =>
            e.message?.role === "chat" &&
            e.message.content === "@Ada after the restart",
        ),
      5_000,
    )
    check(
      "a held queue keeps a card sent to its idle thread queued across a restart, and a release pops it",
      heldSend.kind === "queued" && heldAcross && released >= 0,
      `${heldSend.kind}; held ${heldAcross}; popped after ${released} ms`,
    )
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
