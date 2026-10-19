// host/commands/cards — the commands that move cards: a move, a reorder and
// unqueue all, an undo of moves, a card's command, a busy chat's card queued, a
// sent card spent, a card made a thread and lifted back, a thread opened, a
// proposal's branches opened, and traces seen.
//
// Each runs inside one step of the documents' keeper, as every command does, so
// it is ordered with a queued card's pop and with every other move: gather the places,
// plan purely, then write in one change under the sender's cause
// (`Places.change`), whose close records the cards' history and traces and
// destroys the texts of the cards it removed. Nothing else writes the places
// while a step awaits a stack loading, or an undo's write landing. Every
// answer that wrote the places document, or refused a move, carries its
// `rev`: a client draws its move until its copy reaches it.

import type {
  BlobStore,
  CanvasId,
  EntryId,
  MoveHistoryScope,
  RootId,
  Sha256,
  ThreadId,
  WriterId,
} from "@pinetrie/core"
import {
  branchOutRefusal,
  copyRefusal,
  imageRefusal,
  openRefusal,
  spinOffRefusal,
} from "@pinetrie/interface"
import type { Outcome } from "@pinetrie/protocol/codec"
import { PLACES_DOC_ID } from "@pinetrie/protocol/messages"
import {
  readCanvases,
  readCardHistories,
  readLaneRecords,
  readLanes,
  readPlaces,
  readQueueHolds,
  readRoots,
  readThreads,
  readTreeIndex,
  readWorkflow,
} from "@pinetrie/reads"
import {
  type BoardMove,
  type CanvasIndex,
  type CardFacts,
  type CardPlan,
  type CardRefusal,
  type CopyThread,
  type GatheredStart,
  mintContainer,
  NO_CANVAS_INDEX,
  type OpenThread,
  planBusyQueue,
  planCanvasPlacement,
  planCardCommandSet,
  planCardMove,
  planCardPaste,
  planCardQueue,
  planCardReorder,
  planCardSpend,
  planCardSpinOff,
  planCardTick,
  planCardWidth,
  planImagesPut,
  planImageVersion,
  planProposalPress,
  planRootDelete,
  planThreadCopy,
  planThreadOpening,
  planUndo,
  planUndoAnswer,
  planUndoReach,
  planUnqueueAll,
  type SpinOff,
  type StoredBlob,
} from "@pinetrie/rules"
import { readActiveLanes } from "@pinetrie/schema"
import {
  type BranchOut,
  type CardCommand,
  type CardId,
  type CardRecord,
  type Intent,
  isTextCardId,
  type Move,
  type MoveDirection,
  type MoveTarget,
  placeKey,
  type QueuedFact,
  type QueueHoldChange,
  type QueueMove,
  type Reorder,
  type Send,
  type SentCard,
  type TextCardId,
  type TreeIndex,
} from "@pinetrie/threads"
import type { StepBasics } from "../basics.ts"
import { canvasesNow } from "../canvases.ts"
import type { CardPort } from "../cards.ts"
import type { MoveHistories } from "../move-history.ts"
import type { OpenChange, PersonCause, Places } from "../places.ts"
import type { Provenance } from "../provenance.ts"
import type { StepRecords } from "../records.ts"
import { spendsCard } from "./send.ts"

/**
 * A command's outcome, and the places document's `rev` after its step when the
 * step wrote it or refused a move.
 */
export interface Settled {
  readonly outcome: Outcome
  readonly rev: number | null
}

export const settled = (
  outcome: Outcome,
  rev: number | null = null,
): Settled => ({ outcome, rev })

export interface CardCommandDeps {
  readonly basics: Pick<
    StepBasics,
    "roots" | "live" | "places" | "session" | "now" | "newId" | "log"
  >
  readonly cards: Pick<
    CardPort,
    "destroy" | "hydrate" | "textNow" | "blankQueued"
  >
  /** Queue a drain of the lane on the documents' keeper, not awaited. */
  readonly drain: (lane: ThreadId) => void
  readonly histories: Pick<
    MoveHistories,
    "gestureOf" | "step" | "top" | "unloadCanvas"
  >
  /** The writer of the places: every move is a change, under its cause. */
  readonly placesWriter: Places
  /** The traces a person has seen. */
  readonly provenance: Pick<Provenance, "seen">
  /** A queue's hold, written with a card queued. */
  readonly records: Pick<StepRecords, "writeValues">
  /** Name every recorded thread that has none: a copy is named as it is made. */
  readonly ensureNames: () => Promise<void>
  /** A put image's blob, and its fitted copy, read without the bytes. */
  readonly blobs: Pick<BlobStore, "ref" | "fitted">
}

/** The card commands (`createCardCommands`). */
export type CardCommands = ReturnType<typeof createCardCommands>

/** The cause of a card command's change: whose, and why. */
type CardCause = Extract<
  PersonCause,
  { kind: "move" | "spend" | "queued-busy" }
>

/** A plan refused for no reason of its own: its `why` is `never`. */
const NO_WHY = (why: never): Outcome => why

/**
 * The card commands of one step of the documents' keeper: made in each step,
 * with its documents (`basics.roots`).
 */
export function createCardCommands(deps: CardCommandDeps) {
  const { roots, live, places, session } = deps.basics
  const docs = roots
  /** A column's id, for one made for a card dropped where its kind is not taken. */
  const newContainer = mintContainer(deps.basics.newId)

  /** A blob as the store holds it, read without its bytes. */
  const storedBlob = (sha: Sha256): StoredBlob => ({
    ref: deps.blobs.ref(sha),
    fitted: deps.blobs.fitted(sha),
  })

  /** What every card command's plan reads of the places, read once. */
  const cardFacts = (writer: WriterId, canvases: CanvasIndex): CardFacts => ({
    cards: readPlaces(places),
    canvases,
    sender: writer,
    now: deps.basics.now(),
    running: new Set(readActiveLanes(live)),
    newContainer,
  })

  /**
   * Carry out a card command's plan, the one way a card command writes the
   * places: the history's stack the plan names loaded (nothing writes the
   * places while it loads, on the keeper), the records before the change,
   * the steps as one change under `cause`, the drains, the records after,
   * then the names of the threads it recorded. A refusal says where the card
   * is now and who put it there; a plan's own reason is worded by `word`.
   */
  async function carryPlan<W>(
    plan: CardPlan<W>,
    cause: CardCause,
    word: (why: W) => Outcome,
  ): Promise<Settled> {
    switch (plan.kind) {
      case "refused":
        return unmoved(plan)
      case "nothing":
        return settled({ kind: "nothing" })
      case "declined":
        return settled(word(plan.why))
      case "steps": {
        const gesture =
          plan.history === null
            ? undefined
            : await deps.histories.gestureOf(cause.by, plan.history)
        if (plan.before.length > 0) await deps.records.writeValues(plan.before)
        const rev = await deps.placesWriter.change(
          cause,
          open => open.apply(plan.steps, gesture),
          roots,
        )
        for (const lane of plan.drain) deps.drain(lane)
        if (plan.after.length > 0) await deps.records.writeValues(plan.after)
        if (plan.names) await deps.ensureNames()
        return settled({ kind: "moved" }, rev)
      }
    }
  }

  /** `plan` carried as a move of `writer`'s. */
  const moved = <W>(
    plan: CardPlan<W>,
    writer: WriterId,
    word: (why: W) => Outcome,
  ): Promise<Settled> => carryPlan(plan, { kind: "move", by: writer }, word)

  /** A refused move, with the places' `rev` it was refused at. */
  const unmoved = (refusal: CardRefusal): Settled =>
    settled(unmovedOutcome(refusal), places.rev())

  /**
   * The thread of each entry whose margin a move sends a card to, from its
   * root's index, so `planMoveTargets` can refuse a margin that names another
   * thread. An entry not found is left out.
   */
  async function marginEntryThreads(
    targets: readonly MoveTarget[],
  ): Promise<ReadonlyMap<EntryId, ThreadId>> {
    const threads = readThreads(session)
    const found = new Map<EntryId, ThreadId>()
    for (const to of targets) {
      if (to.kind !== "margin" || to.on.kind !== "entry") continue
      const { on } = to
      const root = threads.get(on.thread)?.root
      if (root === undefined) continue
      const entry = readTreeIndex(await docs.root(root)).entries[on.entry]
      if (entry !== undefined) found.set(on.entry, entry.thread)
    }
    return found
  }

  /** An undo refused because its thread was replied to: nothing reverted. */
  const notLifted = (by: WriterId | null): Settled =>
    settled({ kind: "unmoved", code: "replied", place: null, by }, places.rev())

  /**
   * Delete a thread lifted back into its card (`planRootDelete`): its
   * directory record, its thread's, the canvas it was spun into, any card
   * still in either, its document, and the canvas's stacks of moves, which
   * the startup sweep retires.
   */
  async function deleteRoot(
    open: OpenChange,
    root: RootId,
    thread: ThreadId,
  ): Promise<void> {
    const cards = readPlaces(places)
    // Read after the undo wrote: the command's gathered index is older.
    const canvases = canvasesNow(deps.basics)
    const canvas = canvases.canvasOfThread.get(thread)
    if (canvas === undefined) return
    const plan = planRootDelete(
      root,
      thread,
      canvas,
      cards,
      canvases.rootOfThread,
    )
    await deps.records.writeValues(plan.values)
    // The cards' texts go as the undo's change closes, after their records.
    open.apply(plan.cards)
    await docs.destroy(root)
    await deps.histories.unloadCanvas(plan.histories)
  }

  /**
   * The message a send wrote, by its send's id; null before pi holds it.
   */
  async function sentMessage(sent: {
    readonly sendId: string
    readonly send: Send
  }): Promise<EntryId | null> {
    const index = readTreeIndex(await docs.root(sent.send.root))
    return index.bySend.get(sent.sendId) ?? null
  }

  /**
   * Handoffs, whole or refused: applied when every card is where its sender saw
   * it, in the history `planCardMove` names.
   */
  async function move(
    writer: WriterId,
    moves: readonly Move[],
    here: CanvasId | null,
    canvases: CanvasIndex,
  ): Promise<Settled> {
    const plan = planCardMove({
      ...cardFacts(writer, canvases),
      moves,
      here,
      threads: readThreads(session),
      started: new Set(readRoots(session).keys()),
      workflow: readWorkflow(session),
      entryThreads: await marginEntryThreads(moves.map(m => m.to)),
    })
    return moved(plan, writer, NO_WHY)
  }

  /**
   * A card queued, and its queue's hold changed with it, in one step
   * (`planCardQueue`): the hold written first, so the drain the move asks
   * for finds it as planned.
   */
  function queueCard(
    writer: WriterId,
    queued: QueueMove,
    hold: QueueHoldChange,
    command: CardCommand | null,
    canvases: CanvasIndex,
  ): Promise<Settled> {
    const plan = planCardQueue({
      ...cardFacts(writer, canvases),
      move: queued,
      hold,
      command,
      holds: readQueueHolds(session),
    })
    return moved(plan, writer, NO_WHY)
  }

  return {
    move,
    queueCard,

    /**
     * A queued or pinned card moved among its neighbours, as one step of the
     * sender's history of moves in its canvas, so the page can undo it. It
     * changes no lane's turn, so it drains nothing.
     */
    reorder(
      writer: WriterId,
      reorder: Reorder,
      canvases: CanvasIndex,
    ): Promise<Settled> {
      const plan = planCardReorder({ ...cardFacts(writer, canvases), reorder })
      return moved(plan, writer, NO_WHY)
    },

    /**
     * New images in a media column, as one step of the sender's history in
     * the canvas they land in: each blob read from the store first, then
     * `planImagesPut`. Refused for a blob the store does not hold, or one it
     * sorted as text or opaque.
     */
    putImages(
      writer: WriterId,
      put: Extract<Intent, { kind: "put-images" }>,
      canvases: CanvasIndex,
    ): Promise<Settled> {
      const blobs = new Map(
        put.images.map(i => [i.sha256, storedBlob(i.sha256)] as const),
      )
      const plan = planImagesPut({ ...cardFacts(writer, canvases), put, blobs })
      return moved(plan, writer, imageRefusal)
    },

    /**
     * A new version of an image, from a blob the store holds, as one step of
     * the sender's history in the image's canvas (`planImageVersion`).
     */
    version(
      writer: WriterId,
      change: Extract<Intent, { kind: "version" }>,
      canvases: CanvasIndex,
    ): Promise<Settled> {
      const plan = planImageVersion({
        ...cardFacts(writer, canvases),
        change,
        blob: storedBlob(change.sha256),
      })
      return moved(plan, writer, imageRefusal)
    },

    /**
     * A card drawn one column wide or two on its canvas, as one step of the
     * sender's history of moves in its canvas, as a reorder is. The width it has
     * already writes nothing.
     */
    cardWidth(
      writer: WriterId,
      change: Extract<Intent, { kind: "card-width" }>,
      canvases: CanvasIndex,
    ): Promise<Settled> {
      const plan = planCardWidth({ ...cardFacts(writer, canvases), change })
      return moved(plan, writer, NO_WHY)
    },

    /**
     * A column's box ticked or cleared on its canvas, as one step of the
     * sender's history of moves in its canvas, as a width is. The state it
     * has already writes nothing.
     */
    cardTick(
      writer: WriterId,
      change: Extract<Intent, { kind: "card-tick" }>,
      canvases: CanvasIndex,
    ): Promise<Settled> {
      const plan = planCardTick({ ...cardFacts(writer, canvases), change })
      return moved(plan, writer, NO_WHY)
    },

    /**
     * Every message card queued on `lane` back below the line, as the queue
     * is now (`planUnqueueAll`): one move, so one undo queues them again.
     * `nothing` when none is queued.
     */
    unqueueAll(
      writer: WriterId,
      lane: ThreadId,
      canvases: CanvasIndex,
    ): Promise<Settled> {
      const moves = planUnqueueAll(readPlaces(places), lane)
      return moves.length === 0
        ? Promise.resolve(settled({ kind: "nothing" }))
        : move(writer, moves, null, canvases)
    },

    /**
     * Undo or redo the sender's newest move in `scope`, a canvas's history or
     * theirs outside any canvas, whole or refused, in phases: what its step
     * would move (`planUndoReach`, from the stack's top); the trees of the
     * threads it would lift, read; whether it may go ahead (`planUndo`); then
     * Kyneta writes the revert, and its answer (`planUndoAnswer`) takes the
     * revert `planUndo` let through. `rev` is raised apart from the revert.
     */
    async undoMove(
      writer: WriterId,
      scope: MoveHistoryScope,
      direction: MoveDirection,
      canvases: CanvasIndex,
    ): Promise<Settled> {
      const top = await deps.histories.top(writer, scope, direction)
      const cards = readPlaces(places)
      const histories = readCardHistories(session)
      const reach = planUndoReach({
        parts: top?.parts ?? [],
        placesId: PLACES_DOC_ID,
        direction,
        cards,
        histories,
        workflow: readWorkflow(session),
        threads: readThreads(session),
        roots: new Set(readRoots(session).keys()),
      })
      if (reach.kind === "refused") return unmoved(reach)
      const trees = new Map<RootId, TreeIndex>()
      for (const { root, known } of reach.spun)
        if (known) trees.set(root, readTreeIndex(await docs.root(root)))
      const plan = planUndo({
        reach,
        trees,
        cards,
        lanes: [...readLaneRecords(session).values()],
        rootOfThread: canvases.rootOfThread,
        histories,
      })
      if (plan.kind === "replied") return notLifted(plan.by)
      // Kyneta writes the revert, in one change with the threads it lifts.
      return deps.placesWriter.change(
        { kind: direction, by: writer },
        async open => {
          const reverted = await open.revert(plan.cards, () =>
            deps.histories.step(writer, scope, direction),
          )
          const answer = planUndoAnswer(
            plan,
            reverted.result,
            readPlaces(places),
          )
          switch (answer.kind) {
            case "nothing":
              return settled({ kind: "nothing" })
            case "refused":
              return unmoved(answer)
            case "undone": {
              for (const { root, thread } of plan.lift)
                await deleteRoot(open, root, thread)
              return settled(
                { kind: "undone", cards: answer.cards },
                places.rev(),
              )
            }
          }
        },
        roots,
      )
    },

    /**
     * A text card made a thread, in one step of the keeper, in phases: planned
     * (`planCardSpinOff`), then the thread's records, its first message, the
     * card's text, sent by `start` (through the gate, as every send is), then
     * its card on its canvas and the card's move to the trash, in its history's
     * step. A send that took nothing deletes the records again. The answer is
     * the thread's start, its first message's id among it.
     */
    async spinOff(
      writer: WriterId,
      request: SpinOff,
      start: (outgoing: Send) => Promise<Outcome>,
      canvases: CanvasIndex,
    ): Promise<Settled> {
      const card = request.move.card
      // gather: the card's text, loaded whole; only a text card has one
      if (isTextCardId(card)) await deps.cards.hydrate([card])
      const text = isTextCardId(card) ? deps.cards.textNow(card) : ""
      const plan = planCardSpinOff({
        ...cardFacts(writer, canvases),
        request,
        text,
        roots: new Set(readRoots(session).keys()),
        threads: new Set(readThreads(session).keys()),
        workflow: readWorkflow(session),
      })
      switch (plan.kind) {
        case "refused":
          return unmoved(plan)
        case "declined":
          return settled(spinOffRefusal(plan.why))
      }
      const gesture =
        plan.history === null
          ? undefined
          : await deps.histories.gestureOf(writer, plan.history)
      // the thread's records, its first message, then its card and the
      // card's move; a send that took nothing takes its records back
      await deps.records.writeValues(plan.records)
      const sent = await start({
        kind: "send",
        text: plan.text,
        root: plan.root,
        at: {
          kind: "branch",
          thread: plan.thread,
          at: null,
          canvas: request.canvas,
        },
        mentions: plan.mentions,
        card: { id: plan.card, seen: "" },
        pinned: [],
        base: null,
        state: request.state,
      })
      if (!spendsCard(sent)) {
        await deps.records.writeValues(plan.unwrite)
        return settled(sent)
      }
      // The thread's card outside the history, the card's move to the trash
      // in it: one change, its sender's.
      const rev = await deps.placesWriter.change(
        { kind: "move", by: writer },
        async open => {
          open.apply(plan.opening)
          await deps.ensureNames()
          return open.apply(plan.move, gesture)
        },
        roots,
      )
      return settled(sent, rev)
    },

    /**
     * A canvas's card moved on the board (`planBoardMove`'s writes), in the
     * history `planCanvasPlacement` names. Its card's history and traces are
     * written as any move's.
     */
    placeCanvas(
      writer: WriterId,
      move: Extract<BoardMove, { kind: "move" | "reorder" }>,
    ): Promise<Settled> {
      return moved(planCanvasPlacement(move), writer, NO_WHY)
    },

    /**
     * A thread opened as its column opens, in one step of the keeper
     * (`planThreadOpening`), from its root's tree for a branch. No entry is
     * written: its first send is a branch at its fork, or a new root.
     */
    async openThread(writer: WriterId, open: OpenThread): Promise<Settled> {
      // gather: a branch's root's tree; a new root has none yet
      const start: GatheredStart =
        open.start.kind === "branch"
          ? {
              ...open.start,
              index: readTreeIndex(await docs.root(open.root)),
            }
          : open.start
      const plan = planThreadOpening({
        ...cardFacts(writer, NO_CANVAS_INDEX),
        open,
        start,
        threads: readThreads(session),
        roots: new Set(readRoots(session).keys()),
        held: readCanvases(places),
        workflow: readWorkflow(session),
      })
      return moved(plan, writer, openRefusal)
    },

    /**
     * A press on an agent's proposal, in one step of the keeper, planned
     * (`planProposalPress`) from its root's tree: every branch opened in one
     * change; for Start, each branch's message sent in order through `start`,
     * which clears it as any send; then the press's fact. A refused send is
     * logged and leaves its thread opened, unsent. The answer is the opening's.
     */
    async branchOut(
      writer: WriterId,
      press: BranchOut,
      canvases: CanvasIndex,
      start: (outgoing: Send) => Promise<Outcome>,
      queueFact: (fact: QueuedFact) => Promise<void>,
    ): Promise<Settled> {
      const plan = planProposalPress({
        ...cardFacts(writer, canvases),
        press,
        index: readTreeIndex(await docs.root(press.root)),
        threads: readThreads(session),
        held: readCanvases(places),
      })
      if (plan.kind === "declined") return settled(branchOutRefusal(plan.why))
      const opened = await moved(plan.opening, writer, NO_WHY)
      for (const send of plan.sends) {
        const sent = await start(send)
        if (sent.kind === "refused" || sent.kind === "failed")
          deps.basics.log(
            `[host] a proposal's branch was opened but not started: ${sent.message}`,
          )
      }
      await queueFact(plan.fact)
      return opened
    },

    /**
     * A paste (`planCardPaste`): the card it replaces trashed, then a card
     * made from a copy where its target resolves to, or a cut card out of a
     * trash by its cutter. One step of the sender's history in the canvas it
     * lands in, so the undo key takes it back. Queued on an idle thread, it
     * is drained.
     */
    async paste(
      writer: WriterId,
      pasted: Extract<Intent, { kind: "paste" }>,
      canvases: CanvasIndex,
    ): Promise<Settled> {
      const plan = planCardPaste({
        ...cardFacts(writer, canvases),
        pasted,
        entryThreads: await marginEntryThreads([pasted.to]),
      })
      return moved(plan, writer, NO_WHY)
    },

    /**
     * A thread copied, in one step of the keeper (`planThreadCopy`), from the
     * source's record and tree: the copy's record, its card and the canvas
     * re-ranked for it, then its name. No entry is written: its first send
     * branches at its fork. An undo leaves the copy's record, with no card
     * and no entry.
     */
    async copyThread(
      writer: WriterId,
      copy: CopyThread,
      canvases: CanvasIndex,
    ): Promise<Settled> {
      const threads = readThreads(session)
      const root = threads.get(copy.source)?.root
      const plan = planThreadCopy({
        ...cardFacts(writer, canvases),
        copy,
        threads,
        index: root === undefined ? null : readTreeIndex(await docs.root(root)),
      })
      return moved(plan, writer, copyRefusal)
    },

    /** Set a card's command, or clear it (`planCardCommandSet`). */
    setCommand(
      writer: WriterId,
      card: CardId,
      command: CardCommand | null,
    ): Promise<Settled> {
      const plan = planCardCommandSet({
        ...cardFacts(writer, NO_CANVAS_INDEX),
        card,
        command,
      })
      return moved(plan, writer, NO_WHY)
    },

    /** A sent card's record goes, then its text (`planCardSpend`). Its `rev` after. */
    async spend(
      writer: WriterId,
      card: TextCardId,
      sent: { readonly sendId: string; readonly send: Send },
    ): Promise<number> {
      const message = await sentMessage(sent)
      const { plan, destroyText } = planCardSpend({
        ...cardFacts(writer, NO_CANVAS_INDEX),
        card,
      })
      const { rev } = await carryPlan(
        plan,
        { kind: "spend", by: writer, message },
        NO_WHY,
      )
      if (destroyText) await deps.cards.destroy(card)
      return rev ?? places.rev()
    },

    /**
     * A chat from a card that found its lane busy: the card is queued behind
     * the others in this step (`planBusyQueue`), so no other send gets
     * between. Null when it cannot be: the chat's `busy` answer stands.
     */
    async queueBusy(
      writer: WriterId,
      outgoing: Send & { card: SentCard },
    ): Promise<Settled | null> {
      const doc = await docs.root(outgoing.root)
      const index = readTreeIndex(doc)
      const facts = cardFacts(writer, NO_CANVAS_INDEX)
      const blank = await deps.cards.blankQueued(facts.cards)
      const plan = planBusyQueue({
        ...facts,
        index,
        lanes: readLanes(
          { doc, live },
          index,
          facts.cards,
          readQueueHolds(session),
          blank,
        ),
        outgoing,
      })
      if (plan.kind !== "steps") return null
      const { rev } = await carryPlan(
        plan,
        { kind: "queued-busy", by: writer },
        NO_WHY,
      )
      return settled({ kind: "queued" }, rev)
    },

    /** Delete the traces the sender has seen. */
    async tracesSeen(
      writer: WriterId,
      ids: readonly string[],
    ): Promise<Settled> {
      await deps.provenance.seen(writer, ids)
      return settled({ kind: "seen" })
    },
  }
}

/** A refused move, as its sender is answered: where the card is now and who put it there. */
export const unmovedOutcome = (refusal: {
  readonly code: Extract<Outcome, { kind: "unmoved" }>["code"]
  readonly now: CardRecord | null
}): Outcome => ({
  kind: "unmoved",
  code: refusal.code,
  place: refusal.now === null ? null : placeKey(refusal.now.place),
  by: refusal.now?.placer ?? null,
})
