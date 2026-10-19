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

import {
  type BlobStore,
  type BranchOut,
  branchesByProposal,
  type CanvasId,
  type CardCommand,
  type CardId,
  cardMove,
  type EntryId,
  ERR,
  entryThread,
  historyScope,
  type Intent,
  indexAsks,
  isTextCardId,
  MAX_TITLE,
  type Move,
  type MoveDirection,
  type MoveHistoryScope,
  messageWriter,
  PERSON_HISTORY,
  parseTitle,
  placeKey,
  type QueuedFact,
  type QueueHoldChange,
  type QueueMove,
  type Reorder,
  type RootId,
  refused,
  runPrompt,
  type Send,
  type SentCard,
  type Sha256,
  type TextCardId,
  type ThreadId,
  TRASH_PLACE,
  type TreeIndex,
  threadEnd,
  threadOfSend,
  type ValueWrite,
  type WriterId,
} from "@pinetrie/core"
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
  readRunning,
  readThreads,
  readTreeIndex,
  readWorkflow,
} from "@pinetrie/reads"
import {
  afterSteps,
  type BoardMove,
  type BranchOutRefusal,
  CARD_TITLE,
  type CanvasIndex,
  type CopyPlan,
  type CopyThread,
  canvasOfPlace,
  canvasOfTarget,
  cardsOfParts,
  crossesArchive,
  emptiedCanvases,
  type GatheredStart,
  type LiftPlan,
  lanesToDrain,
  type MoveStep,
  type MovesStep,
  mintContainer,
  mintWith,
  movesHistory,
  type NewImage,
  type Opening,
  type OpenPlan,
  type OpenThread,
  planBranchOut,
  planCanvasesTrashed,
  planCopy,
  planLiftRoot,
  planMoveCommand,
  planMoveRequest,
  planMoveTargets,
  planOpenThread,
  planPaste,
  planPutImages,
  planQueueCard,
  planReorder,
  planRootDelete,
  planSetCommand,
  planSpinOff,
  planUnqueueAll,
  planVersion,
  planWidth,
  type ReorderStep,
  type SpinOff,
  type SpunThread,
  setRecord,
  undoAnswer,
  type VersionBlobs,
} from "@pinetrie/rules"
import type { StepBasics } from "../basics.ts"
import { canvasesNow } from "../canvases.ts"
import type { CardPort } from "../cards.ts"
import type { MoveHistories } from "../move-history.ts"
import type { Gesture, OpenChange, PersonCause, Places } from "../places.ts"
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

/** A lift that deletes no thread: a redo, or an undo of no spin-off. */
const NO_LIFT: LiftPlan = { kind: "lift", delete: [] }

/** Who wrote each entry of a tree, oldest first; null where no person did. */
const writersOf = (index: TreeIndex): readonly (WriterId | null)[] =>
  Object.values(index.entries)
    .toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(e => messageWriter(e.message) ?? null)

/** The card commands (`createCardCommands`). */
export type CardCommands = ReturnType<typeof createCardCommands>

/**
 * The card commands of one step of the documents' keeper: made in each step,
 * with its documents (`basics.roots`).
 */
export function createCardCommands(deps: CardCommandDeps) {
  const { roots, live, places, session } = deps.basics
  const docs = roots
  const running = (lane: ThreadId) => readRunning(deps.basics.live, lane)
  /** A column's id, for one made for a card dropped where its kind is not taken. */
  const newContainer = mintContainer(deps.basics.newId)

  /**
   * A version's blobs from the store: the fitted copy drawn and the original
   * kept, or why there are none.
   */
  function versionBlobs(
    sha: Sha256,
  ):
    | { readonly kind: "blobs"; readonly blobs: VersionBlobs }
    | ReturnType<typeof refused> {
    const ref = deps.blobs.ref(sha)
    if (ref === undefined)
      return refused(ERR.IMAGE_MISSING, `no blob is stored as ${sha}`)
    if (ref.width === null)
      return refused(ERR.NOT_AN_IMAGE, "only images go in a media column")
    return {
      kind: "blobs",
      blobs: { ...(deps.blobs.fitted(sha) ?? ref), original: sha },
    }
  }

  /** A refused move: where the card is now and who put it there. */
  const unmoved = (
    refusal: Extract<MoveStep | ReorderStep, { kind: "refused" }>,
  ): Settled =>
    settled(
      {
        kind: "unmoved",
        code: refusal.code,
        place: refusal.now === null ? null : placeKey(refusal.now.place),
        by: refusal.now?.placer ?? null,
      },
      places.rev(),
    )

  /**
   * One or more threads' opening written: the records first, so a reader
   * that finds a card finds its thread's root; then every card in one
   * change of the opener's; then each thread's name.
   */
  async function executeOpening(
    writer: WriterId,
    opening: Opening,
  ): Promise<Settled> {
    await deps.records.writeValues(opening.records)
    const done = await carry({ kind: "steps", steps: opening.steps }, [], {
      kind: "move",
      by: writer,
    })
    await deps.ensureNames()
    return done
  }

  /**
   * Carry out steps as one change under `cause`, as one step of a history of
   * moves when `gesture` is given; then the drains. A refusal says where the
   * card is now and who put it there.
   */
  async function carry(
    step: MovesStep | MoveStep | ReorderStep,
    drain: readonly ThreadId[],
    cause: PersonCause,
    gesture?: Gesture,
  ): Promise<Settled> {
    if (step.kind === "refused") return unmoved(step)
    const steps = step.kind === "steps" ? step.steps : [step]
    const rev = await deps.placesWriter.change(
      cause,
      open => open.apply(steps, gesture),
      roots,
    )
    for (const lane of drain) deps.drain(lane)
    return settled({ kind: "moved" }, rev)
  }

  /**
   * The thread of each entry whose margin a move sends a card to, from its
   * root's index, so `planMoveTargets` can refuse a margin that names another
   * thread. An entry not found is left out.
   */
  async function marginEntryThreads(
    moves: readonly Move[],
  ): Promise<ReadonlyMap<EntryId, ThreadId>> {
    const threads = readThreads(session)
    const found = new Map<EntryId, ThreadId>()
    for (const { to } of moves) {
      if (to.kind !== "margin" || to.on.kind !== "entry") continue
      const { on } = to
      const root = threads.get(on.thread)?.root
      if (root === undefined) continue
      const entry = readTreeIndex(await docs.root(root)).entries[on.entry]
      if (entry !== undefined) found.set(on.entry, entry.thread)
    }
    return found
  }

  /**
   * What an undo of a step does to the threads its cards were spun into:
   * `lifting`, the cards its step moves, read before it is tried, and each
   * thread whose record says it was spun from one of them, as its tree is now.
   */
  async function liftOf(
    lifting: readonly CardId[],
    canvases: CanvasIndex,
  ): Promise<LiftPlan> {
    const known = readRoots(session)
    const spun: SpunThread[] = []
    for (const [thread, record] of readThreads(session)) {
      const { origin, root } = record
      if (origin.kind !== "spun" || !lifting.includes(origin.card)) continue
      const held = known.has(root)
      spun.push({
        thread,
        root,
        known: held,
        writers: held ? writersOf(readTreeIndex(await docs.root(root))) : [],
      })
    }
    return planLiftRoot({
      lifting,
      spun,
      cards: readPlaces(places),
      lanes: [...readLaneRecords(session).values()],
      rootOfThread: canvases.rootOfThread,
      histories: readCardHistories(session),
    })
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
   * it. Recorded as one step of the sender's history of moves in the root
   * `movesHistory` names, when it names one.
   */
  async function move(
    writer: WriterId,
    moves: readonly Move[],
    here: CanvasId | null,
    canvases: CanvasIndex,
  ): Promise<Settled> {
    // gather. `Trashes` names trashing's history (`movesHistory`).
    const trashes = { canvases, here }
    const entryThreads = await marginEntryThreads(moves)
    const cards = readPlaces(places)
    // plan: each move to a thread's notes to its nearest note column, made
    // first where its canvas has none, then the moves
    const planned = planMoveRequest(
      cards,
      moves,
      writer,
      running,
      newContainer,
      entryThreads,
      readWorkflow(session),
    )
    // A new canvas closed before its first send leaves its canvas empty: its
    // card goes to the trash in the same step, its closer its placer, in
    // their history outside any canvas, since the canvas leaves their view.
    const emptied =
      planned.step.kind === "steps"
        ? emptiedCanvases({
            before: cards,
            after: afterSteps(cards, planned.step.steps),
            threads: readThreads(session),
            started: new Set(readRoots(session).keys()),
          })
        : []
    const step: MovesStep =
      planned.step.kind === "steps" && emptied.length > 0
        ? {
            kind: "steps",
            steps: [
              ...planned.step.steps,
              ...planCanvasesTrashed(cards, emptied, writer),
            ],
          }
        : planned.step
    const scope =
      emptied.length > 0
        ? PERSON_HISTORY
        : movesHistory(moves, cards, trashes, "move")
    // gather the history's stack: nothing writes the places while it loads,
    // on the keeper
    const gesture =
      scope === null ? undefined : await deps.histories.gestureOf(writer, scope)
    // execute
    return carry(step, planned.drain, { kind: "move", by: writer }, gesture)
  }

  /**
   * A card queued, and its queue's hold changed with it, in one step: planned
   * whole (`planQueueCard`), then the hold written, then the move carried as
   * any move is, so the drain it asks for finds the hold as planned. Recorded
   * in the sender's history as a move is; the hold is not, so an undo puts the
   * card back and leaves the queue held or released.
   */
  async function queueCard(
    writer: WriterId,
    queued: QueueMove,
    hold: QueueHoldChange,
    command: CardCommand | null,
    canvases: CanvasIndex,
  ): Promise<Settled> {
    // gather: the history's stack, loaded before the places are read
    // A queueing trashes nothing: its history is the queue's canvas.
    const scope = movesHistory(
      [queued],
      readPlaces(places),
      { canvases, here: null },
      "move",
    )
    const gesture =
      scope === null ? undefined : await deps.histories.gestureOf(writer, scope)
    // plan
    const plan = planQueueCard({
      cards: readPlaces(places),
      holds: readQueueHolds(session),
      move: queued,
      hold,
      command,
      by: writer,
      now: deps.basics.now(),
      running,
    })
    // execute
    if (plan.holds.length > 0) await deps.records.writeValues(plan.holds)
    return carry(plan.step, plan.drain, { kind: "move", by: writer }, gesture)
  }

  return {
    move,
    queueCard,

    /**
     * A queued or pinned card moved among its neighbours, as one step of the
     * sender's history of moves in its canvas, so the page can undo it. It
     * changes no lane's turn, so it drains nothing.
     */
    async reorder(
      writer: WriterId,
      reorder: Reorder,
      canvases: CanvasIndex,
    ): Promise<Settled> {
      // gather: the history's stack, loaded before the places are read
      const canvas = canvasOfPlace(canvases, reorder.at)
      const gesture =
        canvas === null
          ? undefined
          : await deps.histories.gestureOf(writer, historyScope(canvas))
      // plan
      const step = planReorder(readPlaces(places), reorder)
      // execute
      return carry(step, [], { kind: "move", by: writer }, gesture)
    },

    /**
     * New images in a media column, as one step of the sender's history in
     * the canvas they land in: each blob read from the store first (its
     * fitted copy drawn, its original kept), then `planPutImages`, then each
     * image titled by its file's name. Refused for a blob the store does not
     * hold, or one it sorted as text or opaque.
     */
    async putImages(
      writer: WriterId,
      put: Extract<Intent, { kind: "put-images" }>,
      canvases: CanvasIndex,
    ): Promise<Settled> {
      // gather: each blob as stored, then the history's stack, loaded
      // before the places are read
      const images: NewImage[] = []
      for (const image of put.images) {
        const version = versionBlobs(image.sha256)
        if (version.kind === "refused") return settled(version)
        images.push({ card: image.card, image: version.blobs })
      }
      const canvas = canvasOfTarget(canvases, put.to)
      const gesture =
        canvas === null
          ? undefined
          : await deps.histories.gestureOf(writer, historyScope(canvas))
      // plan
      const now = deps.basics.now()
      const step = planPutImages({
        cards: readPlaces(places),
        images,
        to: put.to,
        sender: writer,
        now,
        newContainer: mintWith(newContainer, put.made),
      })
      const titles = put.images.flatMap(i => {
        const title = parseTitle(i.name.slice(0, MAX_TITLE))
        return title.kind === "set"
          ? [
              setRecord(CARD_TITLE, {
                card: i.card,
                title: title.title,
                by: writer,
                at: now,
              }),
            ]
          : []
      })
      // execute: the images, then their titles
      const done = await carry(step, [], { kind: "move", by: writer }, gesture)
      if (done.outcome.kind === "moved") await deps.records.writeValues(titles)
      return done
    },

    /**
     * A new version of an image, from a blob the store holds, as one step of
     * the sender's history in the image's canvas (`planVersion`).
     */
    async version(
      writer: WriterId,
      change: Extract<Intent, { kind: "version" }>,
      canvases: CanvasIndex,
    ): Promise<Settled> {
      // gather
      const version = versionBlobs(change.sha256)
      if (version.kind === "refused") return settled(version)
      const canvas = canvases.canvasOfCard.get(change.image)
      const gesture =
        canvas === undefined
          ? undefined
          : await deps.histories.gestureOf(writer, historyScope(canvas))
      // plan
      const step = planVersion({
        cards: readPlaces(places),
        image: change.image,
        version: version.blobs,
        sender: writer,
        now: deps.basics.now(),
      })
      // execute
      return carry(step, [], { kind: "move", by: writer }, gesture)
    },

    /**
     * A card drawn one column wide or two on its canvas, as one step of the
     * sender's history of moves in its canvas, as a reorder is. The width it has
     * already writes nothing.
     */
    async cardWidth(
      writer: WriterId,
      change: Extract<Intent, { kind: "card-width" }>,
    ): Promise<Settled> {
      // gather: the history's stack, loaded before the places are read
      const gesture = await deps.histories.gestureOf(
        writer,
        historyScope(change.at.canvas),
      )
      // plan
      const step = planWidth(readPlaces(places), change)
      // execute
      return step === null
        ? settled({ kind: "nothing" })
        : carry(step, [], { kind: "move", by: writer }, gesture)
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
     * theirs outside any canvas, whole or refused. Kyneta writes the revert, then
     * `rev` is raised apart from it.
     */
    async undoMove(
      writer: WriterId,
      scope: MoveHistoryScope,
      direction: MoveDirection,
      canvases: CanvasIndex,
    ): Promise<Settled> {
      // gather and plan: no undo crosses the archive's edge, and one that
      // lifts a thread back into its card happens only while the thread
      // holds its first message alone
      const top = await deps.histories.top(writer, scope, direction)
      const touched =
        top === undefined ? [] : cardsOfParts(top.parts, PLACES_DOC_ID)
      if (
        crossesArchive(
          touched,
          readCardHistories(session),
          readWorkflow(session),
        )
      ) {
        const card = readPlaces(places).find(c => c.id === touched[0]) ?? null
        return unmoved({ kind: "refused", code: "archived", now: card })
      }
      const lift =
        direction === "undo" ? await liftOf(touched, canvases) : NO_LIFT
      if (lift.kind === "replied") return notLifted(lift.by)
      // execute: Kyneta writes the revert, in one change with the threads
      // it lifts
      return deps.placesWriter.change(
        { kind: direction, by: writer },
        async open => {
          const reverted = await open.revert(touched, () =>
            deps.histories.step(writer, scope, direction),
          )
          const answer = undoAnswer(
            reverted.result,
            readPlaces(places),
            PLACES_DOC_ID,
          )
          switch (answer.kind) {
            case "nothing":
              return settled({ kind: "nothing" })
            case "refused":
              return unmoved(answer)
            case "undone": {
              for (const { root, thread } of lift.delete)
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
     * A text card made a thread, in one step of the keeper: planned
     * (`planSpinOff`), then the thread's records (its own, spun from the card,
     * and its new canvas's), its first message, the card's text, sent by `start`
     * (through the gate, as every send is), then its card on its canvas's
     * canvas and the card's move to the trash, in its history's step. A send that took nothing deletes the records again.
     * The answer is the thread's start, its first message's id among it.
     */
    async spinOff(
      writer: WriterId,
      request: SpinOff,
      start: (outgoing: Send) => Promise<Outcome>,
      canvases: CanvasIndex,
    ): Promise<Settled> {
      const { move } = request
      const card = move.card
      // Only a text card has a text to start a thread with.
      if (!isTextCardId(card))
        return unmoved({ kind: "refused", code: "no-place", now: null })
      // gather: the card's text, loaded whole, and the history's stack
      await deps.cards.hydrate([card])
      const text = deps.cards.textNow(card)
      const trashes = { canvases, here: request.here }
      const scope = movesHistory([move], readPlaces(places), trashes, "move")
      const gesture =
        scope === null
          ? undefined
          : await deps.histories.gestureOf(writer, scope)
      // plan
      const cards = readPlaces(places)
      const plan = planSpinOff({
        cards,
        request,
        sender: writer,
        canvases,
        text,
        roots: new Set(readRoots(session).keys()),
        threads: new Set(readThreads(session).keys()),
        opens: {
          state: request.state,
          workflow: readWorkflow(session),
        },
        now: deps.basics.now(),
      })
      switch (plan.kind) {
        case "refused":
          return unmoved({
            kind: "refused",
            code: plan.code,
            now: cards.find(c => c.id === move.card) ?? null,
          })
        case "blank":
          return settled({
            kind: "refused",
            code: ERR.REFUSED,
            message: "nothing in the card to start a thread with",
          })
        case "root-in-use":
          return settled({
            kind: "refused",
            code: ERR.ROOT_ID_IN_USE,
            message: "that root's id is in use",
          })
      }
      // execute: the thread's records, its first message, then its card and
      // the card's move; a send that took nothing takes its records back
      await deps.records.writeValues(plan.open.records)
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
        card: { id: card, seen: "" },
        pinned: [],
        base: null,
        state: request.state,
      })
      if (!spendsCard(sent)) {
        await deps.records.writeValues(plan.open.records.map(unwritten))
        return settled(sent)
      }
      // The thread's card outside the history, the card's move to the trash
      // in it: one change, its sender's.
      const rev = await deps.placesWriter.change(
        { kind: "move", by: writer },
        async open => {
          open.apply(plan.open.steps)
          await deps.ensureNames()
          return open.apply([plan.step], gesture)
        },
        roots,
      )
      return settled(sent, rev)
    },

    /**
     * A canvas's card moved on the board (`planBoardMove`'s writes): between
     * states, one step of its sender's history outside any canvas; within one, a
     * reorder, in none. Its card's history and traces are written as any
     * move's.
     */
    async placeCanvas(
      writer: WriterId,
      move: Extract<BoardMove, { kind: "move" | "reorder" }>,
    ): Promise<Settled> {
      const gesture =
        move.kind === "move"
          ? await deps.histories.gestureOf(writer, PERSON_HISTORY)
          : undefined
      return carry(
        { kind: "steps", steps: move.steps },
        [],
        { kind: "move", by: writer },
        gesture,
      )
    },

    /**
     * A thread opened as its column opens, in one step of the keeper: planned
     * (`planOpenThread`) from its root's tree for a branch, then its record
     * (and a new canvas's), its card on its canvas and the canvas
     * re-ranked for it, then its name. No entry is written: its first send is a
     * branch at its fork, or a new root.
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
      // plan
      const plan = planOpenThread({
        open,
        start,
        sender: writer,
        cards: readPlaces(places),
        threads: readThreads(session),
        roots: new Set(readRoots(session).keys()),
        canvases: readCanvases(places),
        workflow: readWorkflow(session),
        now: deps.basics.now(),
      })
      if (plan.kind === "refused") return settled(openRefusal(plan.why))
      return executeOpening(writer, plan)
    },

    /**
     * A press on an agent's proposal, in one step of the keeper: planned
     * (`planBranchOut`) from its root's tree, the thread records and whether
     * the proposing lane runs; every branch opened in one change; for Start,
     * each branch's message sent in order through `start`, which clears it
     * as any send; then the press's fact. A refused send is logged and leaves
     * its thread opened, unsent. The answer is the opening's.
     */
    async branchOut(
      writer: WriterId,
      press: BranchOut,
      canvases: CanvasIndex,
      start: (outgoing: Send) => Promise<Outcome>,
      queueFact: (fact: QueuedFact) => Promise<void>,
    ): Promise<Settled> {
      // gather
      const index = readTreeIndex(await docs.root(press.root))
      const threads = readThreads(session)
      const lane = entryThread(index, press.proposal)
      const runningAsk =
        lane !== null && running(lane)
          ? runPrompt(index, threadEnd(index, lane))
          : null
      // plan
      const plan = planBranchOut({
        press,
        index,
        asks: indexAsks(index),
        branches: branchesByProposal(threads),
        runningAsk,
        sender: writer,
        cards: readPlaces(places),
        threads,
        canvasOfThread: canvases.canvasOfThread,
        canvases: readCanvases(places),
        now: deps.basics.now(),
      })
      if ("kind" in plan) return settled(branchOutRefusal(plan.why))
      // execute
      const opened = await executeOpening(writer, plan.opening)
      if (plan.how === "start")
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
     * A paste: the card it replaces trashed, then a card made from a copy
     * where its target resolves to (a thread's nearest notes, made where its
     * canvas has none; a margin checked against its entry's thread), or a cut
     * card out of a trash by its cutter (`planPaste`). One step of the sender's
     * history in the canvas it lands in, so the undo key takes it back. Queued on
     * an idle thread, it is drained.
     */
    async paste(
      writer: WriterId,
      pasted: Extract<Intent, { kind: "paste" }>,
      canvases: CanvasIndex,
    ): Promise<Settled> {
      // gather: the history's stack, loaded before the places are read
      const trashes = { canvases, here: pasted.here }
      const main = {
        card: pasted.paste.card,
        from: pasted.paste.kind === "uncut" ? TRASH_PLACE : null,
        to: pasted.to,
      }
      const moves = [
        ...(pasted.replacing === null
          ? []
          : [{ ...pasted.replacing, to: TRASH_PLACE }]),
        main,
      ]
      const scope = movesHistory(moves, readPlaces(places), trashes, "paste")
      const gesture =
        scope === null
          ? undefined
          : await deps.histories.gestureOf(writer, scope)
      const entryThreads = await marginEntryThreads([main])
      // plan
      const cards = readPlaces(places)
      const resolved = planMoveTargets({
        cards,
        moves: [main],
        sender: writer,
        newContainer,
        entryThreads,
      })
      if (resolved.kind === "refused") return unmoved(resolved)
      const [move] = resolved.moves
      if (move === undefined) return settled({ kind: "nothing" })
      const step = planPaste(
        afterSteps(cards, resolved.first),
        pasted.paste,
        move,
        pasted.replacing,
        writer,
      )
      if (step.kind === "refused") return unmoved(step)
      const steps = [...resolved.first, ...step.steps]
      // execute: a card queued on an idle thread is popped at once
      return carry(
        { kind: "steps", steps },
        lanesToDrain(cards, steps, running),
        { kind: "move", by: writer },
        gesture,
      )
    },

    /**
     * A thread copied, in one step of the keeper: planned (`planCopy`) from the
     * source's record and tree, then the copy's record, its card and the canvas
     * re-ranked for it, then its name. No entry is written: its first send
     * branches at its fork. As a paste is, it is one step of the copier's
     * history in the canvas it lands in, or outside any canvas in an inventory, so
     * the undo key takes it back; an undo leaves the copy's record, with no
     * card and no entry.
     */
    async copyThread(
      writer: WriterId,
      copy: CopyThread,
      canvases: CanvasIndex,
    ): Promise<Settled> {
      // gather: the history's stack, loaded before the places are read
      const scope = movesHistory(
        [copy.move],
        readPlaces(places),
        { canvases, here: null },
        "paste",
      )
      const gesture =
        scope === null
          ? undefined
          : await deps.histories.gestureOf(writer, scope)
      const threads = readThreads(session)
      const root = threads.get(copy.source)?.root
      const index =
        root === undefined ? null : readTreeIndex(await docs.root(root))
      const cards = readPlaces(places)
      // plan
      const plan =
        index === null
          ? ({ kind: "refused", why: "unknown" } as const)
          : planCopy({
              copy,
              sender: writer,
              cards,
              threads,
              index,
              now: deps.basics.now(),
            })
      if (plan.kind === "refused") return settled(copyRefusal(plan.why))
      // execute: the record first, so a reader that finds the card finds
      // its thread's root
      await deps.records.writeValues(plan.records)
      const done = await carry(
        { kind: "steps", steps: plan.steps },
        [],
        { kind: "move", by: writer },
        gesture,
      )
      await deps.ensureNames()
      return done
    },

    /** Set a card's command, or clear it. */
    setCommand(
      writer: WriterId,
      card: CardId,
      command: CardCommand | null,
    ): Promise<Settled> {
      return carry(planSetCommand(readPlaces(places), card, command), [], {
        kind: "move",
        by: writer,
      })
    },

    /** A sent card's record goes, then its text. Its `rev` after. */
    async spend(
      writer: WriterId,
      card: TextCardId,
      sent: { readonly sendId: string; readonly send: Send },
    ): Promise<number> {
      const message = await sentMessage(sent)
      const held = readPlaces(places).some(c => c.id === card)
      const { rev } = await carry(
        {
          kind: "steps",
          steps: held ? [{ kind: "remove", id: card }] : [],
        },
        [],
        { kind: "spend", by: writer, message },
      )
      // A card the host no longer holds may still have a text.
      if (!held) await deps.cards.destroy(card)
      return rev ?? places.rev()
    },

    /**
     * A chat from a card that found its lane busy: the card is queued behind
     * the others in this step, so no other send gets between. Null when it
     * cannot be: the chat's `busy` answer stands.
     */
    async queueBusy(
      writer: WriterId,
      outgoing: Send & { card: SentCard },
    ): Promise<Settled | null> {
      const doc = await docs.root(outgoing.root)
      const index = readTreeIndex(doc)
      const cards = readPlaces(places)
      const blank = await deps.cards.blankQueued(cards)
      const thread = threadOfSend(
        index,
        readLanes({ doc, live }, index, cards, readQueueHolds(session), blank),
        { at: outgoing.at, me: writer },
      )
      const now = cards.find(c => c.id === outgoing.card.id)
      if (
        thread.kind !== "thread" ||
        thread.lane.kind !== "lane" ||
        now?.kind !== "text"
      )
        return null
      const { step, drain } = planMoveCommand(
        cards,
        [
          cardMove(now, {
            kind: "queued",
            thread: thread.lane.name,
            seen: outgoing.card.seen,
          }),
        ],
        writer,
        running,
      )
      if (step.kind !== "steps") return null
      const { rev } = await carry(step, drain, {
        kind: "queued-busy",
        by: writer,
      })
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

/** A record's write undone: the same record deleted. */
const unwritten = (write: ValueWrite): ValueWrite =>
  write.kind === "set"
    ? {
        kind: "delete",
        target: write.target,
        namespace: write.namespace,
        key: write.key,
      }
    : write

/** Why an opening was refused, as its sender is answered. */
function openRefusal(
  why: Extract<OpenPlan, { kind: "refused" }>["why"],
): Outcome {
  switch (why) {
    case "unknown":
      return {
        kind: "refused",
        code: ERR.UNKNOWN_TARGET,
        message: "no such entry, or no such canvas, to branch in",
      }
    case "taken":
      return {
        kind: "refused",
        code: ERR.THREAD_TAKEN,
        message: "that thread has started already",
      }
    default:
      return { kind: "unmoved", code: why, place: null, by: null }
  }
}

/** Why a press on a proposal was refused, as its sender is answered. */
function branchOutRefusal(why: BranchOutRefusal): Outcome {
  switch (why) {
    case "no-proposal":
      return {
        kind: "refused",
        code: ERR.UNKNOWN_TARGET,
        message: "no proposal at that entry",
      }
    case "running":
      return {
        kind: "refused",
        code: ERR.REFUSED,
        message: "the run that proposed these has not ended",
      }
    case "spent":
      return {
        kind: "refused",
        code: ERR.REFUSED,
        message: "someone has already opened these branches",
      }
    case "no-row":
      return {
        kind: "refused",
        code: ERR.UNKNOWN_TARGET,
        message: "the proposal has no such row",
      }
    default:
      return openRefusal(why)
  }
}

/** Why a copy was refused, as its sender is answered. */
function copyRefusal(
  why: Extract<CopyPlan, { kind: "refused" }>["why"],
): Outcome {
  switch (why) {
    case "unknown":
      return {
        kind: "refused",
        code: ERR.UNKNOWN_TARGET,
        message: "no such thread, or no such end of it, to copy",
      }
    case "taken":
      return {
        kind: "refused",
        code: ERR.THREAD_TAKEN,
        message: "that copy's thread has started already",
      }
    case "held":
      return {
        kind: "refused",
        code: ERR.REFUSED,
        message: "someone else holds that thread",
      }
    default:
      return { kind: "unmoved", code: why, place: null, by: null }
  }
}
