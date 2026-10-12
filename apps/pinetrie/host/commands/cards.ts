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
  cardIdOfKind,
  DISCARDED,
  type EntryId,
  ERR,
  historyScope,
  type Intent,
  isTextCardId,
  keyOf,
  type Move,
  type MoveDirection,
  type MoveHistoryScope,
  moveOf,
  type NoteColumnId,
  PERSON_HISTORY,
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
  type ValueWrite,
  type WriterId,
} from "@pinetrie/core"
import type { Outcome } from "@pinetrie/protocol/codec"
import { PLACES_DOC_ID } from "@pinetrie/protocol/messages"
import {
  readCardHistories,
  readLaneRecords,
  readLanes,
  readPlaces,
  readQueueHolds,
  readRoots,
  readRunning,
  readTasks,
  readThreads,
  readTreeIndex,
  readWorkflow,
} from "@pinetrie/reads"
import {
  afterSteps,
  type BoardMove,
  type Cause,
  type CopyPlan,
  type CopyThread,
  cardsOfParts,
  crossesArchive,
  emptiedTasks,
  historyOf,
  type LiftPlan,
  lanesToDrain,
  type MoveStep,
  type MovesStep,
  type OpenPlan,
  type OpenThread,
  planCopy,
  planLiftRoot,
  planMoveCommand,
  planMoveRequest,
  planMoveTargets,
  planOpenThread,
  planPaste,
  planQueueCard,
  planReorder,
  planRootDelete,
  planSetCommand,
  planSpinOff,
  planTasksTrashed,
  planUnqueueAll,
  planWidth,
  type ReorderStep,
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
  /** Name every recorded thread that has none: a copy is named as it is made (ADR-0117). */
  readonly ensureNames: () => Promise<void>
}

/** A lift that deletes no thread: a redo, or an undo of no spin-off. */
const NO_LIFT: LiftPlan = { kind: "lift", delete: [] }

/** Who wrote each entry of a tree, oldest first; null where no person did. */
const writersOf = (index: TreeIndex): readonly (WriterId | null)[] =>
  Object.values(index.entries)
    .toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(e => e.message?.writer ?? null)

/** The card commands (`createCardCommands`). */
export type CardCommands = ReturnType<typeof createCardCommands>

export function createCardCommands(deps: CardCommandDeps) {
  const { docs, live, places, session } = deps.basics
  const running = (lane: ThreadId) => readRunning(deps.basics.live, lane)
  /** A note column's id, for one made for a note with nowhere else to go. */
  const newColumn = (): NoteColumnId =>
    cardIdOfKind("note-column", deps.basics.newId())

  /** A refused move: where the card is now and who put it there. */
  const unmoved = (
    refusal: Extract<MoveStep | ReorderStep, { kind: "refused" }>,
  ): Settled =>
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
    step: MovesStep | MoveStep | ReorderStep,
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
   * The thread of each entry whose margin a move sends a card to (ADR-0126),
   * from its root's index, so `planMoveTargets` can refuse a margin that
   * names another thread. An entry not found is left out.
   */
  async function marginEntryThreads(
    moves: readonly Move[],
  ): Promise<ReadonlyMap<EntryId, ThreadId>> {
    const threads = readThreads(session)
    const found = new Map<EntryId, ThreadId>()
    for (const { to } of moves) {
      if (to.kind !== "margin") continue
      const root = threads.get(to.thread)?.root
      if (root === undefined) continue
      const entry = readTreeIndex(await docs.root(root)).entries[to.entry]
      if (entry !== undefined) found.set(to.entry, entry.thread)
    }
    return found
  }

  /**
   * What an undo of a step does to the threads its cards were spun into
   * (S139): `lifting`, the cards its step moves, read before it is tried,
   * and each thread whose record says it was spun from one of them, as its
   * tree is now.
   */
  async function liftOf(
    lifting: readonly CardId[],
    tasks: TaskIndex,
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
      rootOfThread: tasks.rootOfThread,
      histories: readCardHistories(session),
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
   * The message a send wrote, by its send's id; null before pi holds it.
   */
  async function sentMessage(sent: {
    readonly sendId: string
    readonly chat: Chat
  }): Promise<EntryId | null> {
    const index = readTreeIndex(await docs.root(sent.chat.root))
    return index.bySend.get(sent.sendId) ?? null
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
    // gather. `Discards` names a discard's history (`historyOf`).
    const discards = { tasks, here }
    const entryThreads = await marginEntryThreads(moves)
    const cards = readPlaces(places)
    // plan: each move to a thread's notes to its nearest note column, made
    // first where its task has none, then the moves
    const planned = planMoveRequest(
      cards,
      moves,
      writer,
      running,
      newColumn,
      entryThreads,
      readWorkflow(session),
    )
    // A new tab closed before its first send leaves its task empty: its
    // card goes to the trash in the same step, its closer its placer, in
    // their history outside any task, since the task leaves their view.
    const emptied =
      planned.step.kind === "steps"
        ? emptiedTasks({
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
              ...planTasksTrashed(cards, emptied, writer),
            ],
          }
        : planned.step
    const scope =
      emptied.length > 0
        ? PERSON_HISTORY
        : historyOf(moves, cards, discards, "move")
    // gather the history's stack: nothing writes the places while it loads,
    // on the keeper
    const gesture =
      scope === null ? undefined : await deps.histories.gestureOf(writer, scope)
    // execute
    return carry(step, planned.drain, { kind: "move", by: writer }, gesture)
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
    const scope = historyOf(
      [queued],
      readPlaces(places),
      { tasks, here: null },
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
        task === null
          ? undefined
          : await deps.histories.gestureOf(writer, historyScope(task))
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
      const gesture = await deps.histories.gestureOf(
        writer,
        historyScope(change.at.task),
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
      tasks: TaskIndex,
    ): Promise<Settled> {
      const moves = planUnqueueAll(readPlaces(places), lane)
      return moves.length === 0
        ? Promise.resolve(settled({ kind: "nothing" }))
        : move(writer, moves, null, tasks)
    },

    /**
     * Undo or redo the sender's newest move in `scope`, a task's history or
     * theirs outside any task, whole or refused (ADR-0066). Kyneta writes
     * the revert, then `rev` is raised apart from it (S82).
     */
    async undoMove(
      writer: WriterId,
      scope: MoveHistoryScope,
      direction: MoveDirection,
      tasks: TaskIndex,
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
      const lift = direction === "undo" ? await liftOf(touched, tasks) : NO_LIFT
      if (lift.kind === "replied") return notLifted(lift.by)
      // execute
      const before = deps.provenance.before()
      const result = await deps.histories.step(writer, scope, direction)
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
     * A text card made a thread (ADR-0111, ADR-0126), in one step of the
     * keeper: planned (`planSpinOff`), then the thread's records (its own,
     * spun from the card, and its new task's), its first message, the
     * card's text, sent by `start`, then its card on its task's canvas and
     * the card's move to the trash, in its history's step. A send
     * that took nothing deletes the records again. The answer is the
     * thread's start, its first message's id among it.
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
      const scope = historyOf([move], readPlaces(places), discards, "move")
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
        tasks,
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
      if (!spendsCard(sent)) {
        await deps.records.writeValues(plan.open.records.map(unwritten))
        return settled(sent)
      }
      await carry({ kind: "steps", steps: plan.open.steps }, [], null)
      await deps.ensureNames()
      const moved = await carry(
        plan.step,
        [],
        { kind: "move", by: writer },
        gesture,
      )
      return settled(sent, moved.rev)
    },

    /**
     * A task's card moved on the board (`planBoardMove`'s writes): between
     * states, one step of its sender's history outside any task (ADR-0126);
     * within one, a reorder, in none. Its card's history and traces are
     * written as any move's.
     */
    async placeTask(
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
     * A thread opened as its column opens (ADR-0126), in one step of the
     * keeper: planned (`planOpenThread`) from its root's tree for a branch,
     * then its record (and a new tab's task's), its card on its task's
     * canvas and the canvas re-ranked for it, then its name. No entry is
     * written: its first send is a branch at its fork, or a new root.
     */
    async openThread(writer: WriterId, open: OpenThread): Promise<Settled> {
      // gather
      const index =
        open.at === null ? null : readTreeIndex(await docs.root(open.root))
      // plan
      const plan = planOpenThread({
        open,
        sender: writer,
        cards: readPlaces(places),
        threads: readThreads(session),
        roots: new Set(readRoots(session).keys()),
        tasks: readTasks(places),
        index,
        workflow: readWorkflow(session),
        now: deps.basics.now(),
      })
      if (plan.kind === "refused") return settled(openRefusal(plan.why))
      // execute: the records first, so a reader that finds the card finds
      // its thread's root
      await deps.records.writeValues(plan.records)
      const done = await carry({ kind: "steps", steps: plan.steps }, [], {
        kind: "move",
        by: writer,
      })
      await deps.ensureNames()
      return done
    },

    /**
     * A paste (ADR-0132): the card it replaces discarded, then a card made
     * from a copy where its target resolves to (a thread's nearest notes,
     * made where its task has none; a margin checked against its entry's
     * thread), or a cut card out of a trash by its cutter (`planPaste`). One
     * step of the sender's history in the task it lands in, so the undo key
     * takes it back. Queued on an idle thread, it is drained.
     */
    async paste(
      writer: WriterId,
      pasted: Extract<Intent, { kind: "paste" }>,
      tasks: TaskIndex,
    ): Promise<Settled> {
      // gather: the history's stack, loaded before the places are read
      const discards = { tasks, here: pasted.here }
      const main = {
        card: pasted.paste.card,
        from: pasted.paste.kind === "uncut" ? DISCARDED : null,
        to: pasted.to,
      }
      const moves = [
        ...(pasted.replacing === null
          ? []
          : [{ ...pasted.replacing, to: DISCARDED }]),
        main,
      ]
      const scope = historyOf(moves, readPlaces(places), discards, "paste")
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
        newColumn,
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
     * A thread copied (ADR-0117, ADR-0124), in one step of the keeper:
     * planned (`planCopy`) from the source's record and tree, then the
     * copy's record, its card and the canvas re-ranked for it, then its
     * name. No entry is written: its first send branches at its fork. As a
     * paste is (ADR-0132), it is one step of the copier's history in the
     * task it lands in, or outside any task in an inventory, so the undo key
     * takes it back; an undo leaves the copy's record, with no card and no
     * entry.
     */
    async copyThread(
      writer: WriterId,
      copy: CopyThread,
      tasks: TaskIndex,
    ): Promise<Settled> {
      // gather: the history's stack, loaded before the places are read
      const scope = historyOf(
        [copy.move],
        readPlaces(places),
        { tasks, here: null },
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

    /** Set a card's command, or clear it (ADR-0108). */
    setCommand(card: CardId, command: CardCommand | null): Promise<Settled> {
      return carry(planSetCommand(readPlaces(places), card, command), [], null)
    },

    /** A sent card's record goes, then its text (S64). Its `rev` after. */
    async spend(
      writer: WriterId,
      card: TextCardId,
      sent: { readonly sendId: string; readonly chat: Chat },
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
        now?.kind !== "text"
      )
        return null
      const { step, drain } = planMoveCommand(
        cards,
        [
          moveOf(now, {
            kind: "queued",
            thread: thread.lane.name,
            seen: chat.card.seen,
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
        message: "no such entry, or no such task, to branch in",
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
