// host/commands/cards — the commands that move cards (ADR-0059): a move, a
// reorder and unqueue all (ADR-0048 step 7), an undo of moves (ADR-0066), a
// card's command, a busy chat's card queued, a sent card spent, a card made
// a thread and lifted back (ADR-0111), and traces seen (ADR-0048 step 6).
//
// Each runs inside one step of the documents' keeper, as every command does, so
// it is ordered with a queued card's pop and with every other move: gather the places,
// plan purely, then write through `applyPlaceSteps`. Nothing else writes the
// places while a step awaits a stack loading, or an undo's write landing.
// Every answer that wrote the places document, or refused a move, carries
// its `rev`: a client draws its move until its copy reaches it. Each write
// that moves a card records the cards' history and traces in the same step
// (`carry`, and `undoMove` around Kyneta's revert).

import {
  type CardCommand,
  type CardId,
  type CardRecord,
  type EntryId,
  ERR,
  type Intent,
  isTextCardId,
  keyOf,
  type Move,
  type MoveDirection,
  moveOf,
  type NoteColumnId,
  noteColumnIdFor,
  type QueueHoldChange,
  type QueueMove,
  type Reorder,
  type RootId,
  type SentCard,
  type TaskId,
  type TextCardId,
  type ThreadId,
  type TreeIndex,
  threadOfSend,
  type WriterId,
} from "@pinetrie/core"
import type { Outcome } from "@pinetrie/protocol/codec"
import { PLACES_DOC_ID } from "@pinetrie/protocol/messages"
import {
  readLaneRecords,
  readLanes,
  readPlaces,
  readQueueHolds,
  readRoots,
  readRunning,
  readTreeIndex,
} from "@pinetrie/reads"
import {
  type Cause,
  cardsOfParts,
  historyOf,
  type LiftPlan,
  type MoveStep,
  type MovesStep,
  NO_DISCARDS,
  type PlaceStep,
  planFreshFollow,
  planLiftRoot,
  planMoveCommand,
  planMoveRequest,
  planQueueCard,
  planReorder,
  planRootDelete,
  planSetCommand,
  planSpinOff,
  planUnqueueAll,
  planWidth,
  type SpinOff,
  type SpunThread,
  type TaskIndex,
  taskOfPlace,
  undoAnswer,
} from "@pinetrie/rules"
import type { Basics } from "../basics.ts"
import type { CardPort } from "../cards.ts"
import type { MoveHistories } from "../move-history.ts"
import { applyPlaceSteps, type Gesture, raiseRev } from "../places.ts"
import type { Provenance } from "../provenance.ts"
import type { Records } from "../records.ts"
import { tasksNow } from "../tasks.ts"
import { type Chat, spendsCard } from "./chat.ts"

/**
 * A command's outcome, and the places document's `rev` after its step when
 * the step wrote it or refused a move (ADR-0059).
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
    Basics,
    "docs" | "live" | "places" | "session" | "now" | "newId"
  >
  readonly cards: Pick<
    CardPort,
    "destroy" | "hydrate" | "textNow" | "blankQueued"
  >
  /** Queue a drain of the lane on the documents' keeper, not awaited. */
  readonly drain: (lane: ThreadId) => void
  readonly histories: Pick<
    MoveHistories,
    "gestureOf" | "step" | "top" | "unloadTask"
  >
  /** Each card's history, and traces (ADR-0048 step 6). */
  readonly provenance: Pick<Provenance, "before" | "after" | "seen">
  /** A queue's hold, written with a card queued (ADR-0113). */
  readonly records: Pick<Records, "writeValues">
}

/** A lift that deletes no thread: a redo, or an undo of no spin-off. */
const NO_LIFT: LiftPlan = { kind: "lift", delete: [] }

/** Who wrote each entry of a tree, oldest first; null where no person did. */
const writersOf = (index: TreeIndex): readonly (WriterId | null)[] =>
  Object.values(index.entries)
    .toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(e => e.message?.writer ?? null)

export function createCardCommands(deps: CardCommandDeps) {
  const { docs, live, places, session } = deps.basics
  const running = (lane: ThreadId) => readRunning(deps.basics.live, lane)
  /** A note column's id, for one made for a note with nowhere else to go. */
  const newColumn = (): NoteColumnId => noteColumnIdFor(deps.basics.newId())

  /** A refused move: where the card is now and who put it there. */
  const unmoved = (refusal: Extract<MoveStep, { kind: "refused" }>): Settled =>
    settled(
      {
        kind: "unmoved",
        code: refusal.code,
        place: refusal.now === null ? null : keyOf(refusal.now.place),
        by: refusal.now?.placer ?? null,
      },
      places.rev(),
    )

  /**
   * Carry out steps, as one step of a history of moves when `gesture` is
   * given: writes, and removals whose texts then go (record first, S64),
   * the cards' history and traces `cause` calls for (none for a command,
   * which moves no card), and the drains. A refusal says where the card is
   * now and who put it there.
   */
  async function carry(
    step: MovesStep | MoveStep,
    drain: readonly ThreadId[],
    cause: Cause | null,
    gesture?: Gesture,
  ): Promise<Settled> {
    if (step.kind === "refused") return unmoved(step)
    const steps = step.kind === "steps" ? step.steps : [step]
    const before = cause === null ? null : deps.provenance.before()
    const rev = applyPlaceSteps(places, steps, gesture)
    for (const s of steps)
      if (s.kind === "remove" && isTextCardId(s.id))
        await deps.cards.destroy(s.id)
    if (cause !== null && before !== null)
      await deps.provenance.after(cause, before)
    for (const lane of drain) deps.drain(lane)
    return settled({ kind: "moved" }, rev)
  }

  /**
   * What an undo of `writer`'s newest step in `task` does to the threads its
   * cards were spun into (S139): the cards its step moves, read before it
   * is tried, and each thread they spun off, as its tree is now.
   */
  async function liftOf(
    writer: WriterId,
    task: TaskId,
    tasks: TaskIndex,
  ): Promise<LiftPlan> {
    const top = await deps.histories.top(writer, task, "undo")
    const lifting =
      top === undefined ? [] : cardsOfParts(top.parts, PLACES_DOC_ID)
    const known = readRoots(session)
    const threads = new Map<RootId, SpunThread>()
    for (const card of readPlaces(places)) {
      if (!lifting.includes(card.id)) continue
      if (card.place.kind !== "gone" || card.place.why.kind !== "spun") continue
      const { into } = card.place.why
      const held = known.has(into)
      threads.set(into, {
        thread: into,
        known: held,
        writers: held ? writersOf(readTreeIndex(await docs.root(into))) : [],
      })
    }
    return planLiftRoot({
      lifting,
      cards: readPlaces(places),
      threads,
      lanes: [...readLaneRecords(session).values()],
      rootOfThread: tasks.rootOfThread,
    })
  }

  /** An undo refused because its thread was replied to: nothing reverted. */
  const notLifted = (by: WriterId | null): Settled =>
    settled({ kind: "unmoved", code: "replied", place: null, by }, places.rev())

  /**
   * Delete a thread lifted back into its card (`planRootDelete`): its
   * directory record, its thread's, the task it was spun into, any card
   * still in either, its document, and the task's stacks of moves, which
   * the startup sweep retires.
   */
  async function deleteRoot(root: RootId, thread: ThreadId): Promise<void> {
    const cards = readPlaces(places)
    // Read after the undo wrote: the command's gathered index is older.
    const tasks = tasksNow(deps.basics)
    const task = tasks.taskOfThread.get(thread)
    if (task === undefined) return
    const plan = planRootDelete(root, thread, task, cards, tasks.rootOfThread)
    await deps.records.writeValues(plan.values)
    if (plan.cards.length > 0) {
      applyPlaceSteps(places, plan.cards)
      // Each record first, then its text (S64).
      const gone = plan.cards.flatMap(s =>
        s.kind === "remove" && isTextCardId(s.id) ? [s.id] : [],
      )
      for (const id of gone) await deps.cards.destroy(id)
    }
    await docs.destroy(root)
    await deps.histories.unloadTask(plan.histories)
  }

  /**
   * Where a fresh column's other cards go once its first message is written:
   * that message, by the send's id, on its thread's lane once pi holds it,
   * else on none.
   */
  async function followers(
    writer: WriterId,
    cards: readonly CardRecord[],
    card: CardId,
    sent: { readonly sendId: string; readonly chat: Chat },
  ): Promise<{
    readonly message: EntryId | null
    readonly steps: readonly PlaceStep[]
  }> {
    const { root } = sent.chat
    const index = readTreeIndex(await docs.root(root))
    const at = index.bySend.get(sent.sendId)
    if (at === undefined) return { message: null, steps: [] }
    return {
      message: at,
      steps: planFreshFollow({
        cards,
        sent: card,
        root,
        thread: sent.chat.at.thread,
        newColumn,
        by: writer,
      }),
    }
  }

  /**
   * Handoffs, whole or refused: applied when every card is where its
   * sender saw it. Recorded as one step of the sender's history of moves
   * in the root `historyOf` names, when it names one (ADR-0066).
   */
  async function move(
    writer: WriterId,
    moves: readonly Move[],
    here: TaskId | null,
    tasks: TaskIndex,
  ): Promise<Settled> {
    // gather: the history's stack, loaded before the places are read. One
    // `Discards` names both the history and a discard's gone place.
    const discards = { tasks, here }
    const task = historyOf(moves, readPlaces(places), discards)
    const gesture =
      task === null ? undefined : await deps.histories.gestureOf(writer, task)
    // plan: each move to a thread's notes to its nearest note column, made
    // first where its task has none, then the moves
    const { step, drain } = planMoveRequest(
      readPlaces(places),
      moves,
      writer,
      running,
      discards,
      newColumn,
    )
    // execute
    return carry(step, drain, { kind: "move", by: writer }, gesture)
  }

  /**
   * A card queued, and its queue's hold changed with it (ADR-0113), in one
   * step: planned whole (`planQueueCard`), then the hold written, then the
   * move carried as any move is, so the drain it asks for finds the hold as
   * planned. Recorded in the sender's history as a move is; the hold is not,
   * so an undo puts the card back and leaves the queue held or released.
   */
  async function queueCard(
    writer: WriterId,
    queued: QueueMove,
    hold: QueueHoldChange,
    command: CardCommand | null,
    tasks: TaskIndex,
  ): Promise<Settled> {
    // gather: the history's stack, loaded before the places are read
    // A queueing discards nothing: its history is the queue's task.
    const task = historyOf([queued], readPlaces(places), { tasks, here: null })
    const gesture =
      task === null ? undefined : await deps.histories.gestureOf(writer, task)
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
     * A queued or pinned card moved among its neighbours (ADR-0048 step 7),
     * as one step of the sender's history of moves in its task, so the
     * page can undo it. It changes no lane's turn, so it drains nothing.
     */
    async reorder(
      writer: WriterId,
      reorder: Reorder,
      tasks: TaskIndex,
    ): Promise<Settled> {
      // gather: the history's stack, loaded before the places are read
      const task = taskOfPlace(tasks, reorder.at)
      const gesture =
        task === null ? undefined : await deps.histories.gestureOf(writer, task)
      // plan
      const step = planReorder(readPlaces(places), reorder)
      // execute
      return carry(step, [], { kind: "move", by: writer }, gesture)
    },

    /**
     * A card drawn one column wide or two on its canvas (ADR-0116), as one
     * step of the sender's history of moves in its task, as a reorder is.
     * The width it has already writes nothing.
     */
    async cardWidth(
      writer: WriterId,
      change: Extract<Intent, { kind: "card-width" }>,
    ): Promise<Settled> {
      // gather: the history's stack, loaded before the places are read
      const gesture = await deps.histories.gestureOf(writer, change.at.task)
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
      tasks: TaskIndex,
    ): Promise<Settled> {
      const moves = planUnqueueAll(readPlaces(places), lane)
      return moves.length === 0
        ? Promise.resolve(settled({ kind: "nothing" }))
        : move(writer, moves, null, tasks)
    },

    /**
     * Undo or redo the sender's newest move in `task`, whole or refused
     * (ADR-0066). Kyneta writes the revert, then `rev` is raised apart from
     * it (S82).
     */
    async undoMove(
      writer: WriterId,
      task: TaskId,
      direction: MoveDirection,
      tasks: TaskIndex,
    ): Promise<Settled> {
      // gather and plan: an undo that lifts a thread back into its card
      // happens only while the thread holds its first message alone
      const lift =
        direction === "undo" ? await liftOf(writer, task, tasks) : NO_LIFT
      if (lift.kind === "replied") return notLifted(lift.by)
      // execute
      const before = deps.provenance.before()
      const result = await deps.histories.step(writer, task, direction)
      const answer = undoAnswer(result, readPlaces(places), PLACES_DOC_ID)
      switch (answer.kind) {
        case "nothing":
          return settled({ kind: "nothing" })
        case "refused":
          return unmoved(answer)
        case "undone": {
          for (const { root, thread } of lift.delete)
            await deleteRoot(root, thread)
          const rev = raiseRev(places)
          await deps.provenance.after({ kind: direction, by: writer }, before)
          return settled({ kind: "undone", cards: answer.cards }, rev)
        }
      }
    },

    /**
     * A text card made a thread (ADR-0111), in one step of the keeper:
     * planned (`planSpinOff`), then the new conversation root started by
     * `start` (its first message, the card's text, and its board place),
     * then the card's move to gone, spun into it, in its history's step.
     * The answer is the thread's start, its first message's id among it.
     */
    async spinOff(
      writer: WriterId,
      request: SpinOff,
      start: (chat: Chat) => Promise<Outcome>,
      tasks: TaskIndex,
    ): Promise<Settled> {
      const { move } = request
      const card = move.card
      // Only a text card has a text to start a thread with.
      if (!isTextCardId(card))
        return unmoved({ kind: "refused", code: "no-place", now: null })
      // gather: the card's text, loaded whole, and the history's stack
      await deps.cards.hydrate([card])
      const text = deps.cards.textNow(card)
      const discards = { tasks, here: request.here }
      const task = historyOf([move], readPlaces(places), discards)
      const gesture =
        task === null ? undefined : await deps.histories.gestureOf(writer, task)
      // plan
      const cards = readPlaces(places)
      const plan = planSpinOff({
        cards,
        request,
        sender: writer,
        tasks,
        text,
        roots: new Set(readRoots(session).keys()),
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
      // execute: the thread, then the card's move
      const sent = await start({
        text: plan.text,
        root: plan.root,
        at: {
          kind: "branch",
          thread: plan.thread,
          at: null,
          task: request.task,
        },
        asksAgent: false,
        mentions: plan.mentions,
        card: { id: card, seen: "" },
        pinned: [],
        base: null,
        state: request.state,
      })
      if (!spendsCard(sent)) return settled(sent)
      const moved = await carry(
        plan.step,
        [],
        { kind: "move", by: writer },
        gesture,
      )
      return settled(sent, moved.rev)
    },

    /** Set a card's command, or clear it (ADR-0108). */
    setCommand(card: CardId, command: CardCommand | null): Promise<Settled> {
      return carry(planSetCommand(readPlaces(places), card, command), [], null)
    },

    /**
     * A sent card's record goes, then its text (S64). Sent from a fresh
     * column, the column's other cards follow it to the message it became
     * (`planFreshFollow`), in this step. Its `rev` after.
     */
    async spend(
      writer: WriterId,
      card: TextCardId,
      sent: { readonly sendId: string; readonly chat: Chat },
    ): Promise<number> {
      const cards = readPlaces(places)
      const followed = await followers(writer, cards, card, sent)
      const held = cards.some(c => c.id === card)
      const { rev } = await carry(
        {
          kind: "steps",
          steps: [
            ...followed.steps,
            ...(held ? [{ kind: "remove", id: card } as const] : []),
          ],
        },
        [],
        { kind: "spend", by: writer, message: followed.message },
      )
      // A card the host no longer holds may still have a text.
      if (!held) await deps.cards.destroy(card)
      return rev ?? places.rev()
    },

    /**
     * A chat from a card that found its lane busy: the card is queued behind
     * the others in this step, so no other send gets between (ADR-0059).
     * Null when it cannot be: the chat's `busy` answer stands.
     */
    async queueBusy(
      writer: WriterId,
      chat: Chat & { card: SentCard },
    ): Promise<Settled | null> {
      const doc = await docs.root(chat.root)
      const index = readTreeIndex(doc)
      const cards = readPlaces(places)
      const blank = await deps.cards.blankQueued(cards)
      const thread = threadOfSend(
        index,
        readLanes({ doc, live }, index, cards, readQueueHolds(session), blank),
        { at: chat.at, me: writer },
      )
      const now = cards.find(c => c.id === chat.card.id)
      if (
        thread.kind !== "thread" ||
        thread.lane.kind !== "lane" ||
        now === undefined
      )
        return null
      const { step, drain } = planMoveCommand(
        cards,
        [
          moveOf(now, {
            kind: "queued",
            at: thread.end,
            thread: thread.lane.name,
            seen: chat.card.seen,
          }),
        ],
        writer,
        running,
        NO_DISCARDS,
      )
      if (step.kind !== "steps") return null
      const { rev } = await carry(step, drain, {
        kind: "queued-busy",
        by: writer,
      })
      return settled({ kind: "queued" }, rev)
    },

    /** Delete the traces the sender has seen (ADR-0048). */
    async tracesSeen(
      writer: WriterId,
      ids: readonly string[],
    ): Promise<Settled> {
      await deps.provenance.seen(writer, ids)
      return settled({ kind: "seen" })
    },
  }
}
