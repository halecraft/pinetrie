// host/commands/cards — the commands that move cards (ADR-0059): a move, a
// reorder and unqueue all (ADR-0048 step 7), an undo of moves (ADR-0066), a
// card's command, a busy chat's card queued, a sent card spent, and traces
// seen (ADR-0048 step 6).
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
  keyOf,
  type LaneName,
  type Move,
  type MoveDirection,
  moveOf,
  type Reorder,
  type RootId,
  type SentCard,
  threadOf,
  type WriterId,
} from "@pineta/core"
import type { Outcome } from "@pineta/protocol/codec"
import { PLACES_DOC_ID } from "@pineta/protocol/messages"
import {
  readLanes,
  readPlaces,
  readQueueHolds,
  readRunning,
  readTreeIndex,
} from "@pineta/reads"
import {
  type Cause,
  historyOf,
  type MoveStep,
  type MovesStep,
  type PlaceStep,
  planFreshFollow,
  planMoveCommand,
  planReorder,
  planSetCommand,
  planUnqueueAll,
  undoAnswer,
} from "@pineta/rules"
import type { Basics } from "../basics.ts"
import type { CardPort } from "../cards.ts"
import type { MoveHistories } from "../move-history.ts"
import { applyPlaceSteps, type Gesture, raiseRev } from "../places.ts"
import type { Provenance } from "../provenance.ts"
import type { Chat } from "./chat.ts"

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
  readonly basics: Pick<Basics, "docs" | "live" | "places" | "session">
  readonly cards: Pick<CardPort, "destroy">
  /** Queue a drain of the lane on the documents' keeper, not awaited. */
  readonly drain: (lane: LaneName) => void
  readonly histories: Pick<MoveHistories, "gestureOf" | "step">
  /** Each card's history, and traces (ADR-0048 step 6). */
  readonly provenance: Pick<Provenance, "before" | "after" | "seen">
}

export function createCardCommands(deps: CardCommandDeps) {
  const { docs, live, places, session } = deps.basics
  const running = (lane: LaneName) => readRunning(deps.basics.live, lane)

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
    drain: readonly LaneName[],
    cause: Cause | null,
    gesture?: Gesture,
  ): Promise<Settled> {
    if (step.kind === "refused") return unmoved(step)
    const steps = step.kind === "steps" ? step.steps : [step]
    const before = cause === null ? null : deps.provenance.before()
    const rev = applyPlaceSteps(places, steps, gesture)
    for (const s of steps)
      if (s.kind === "remove") await deps.cards.destroy(s.id)
    if (cause !== null && before !== null)
      await deps.provenance.after(cause, before)
    for (const lane of drain) deps.drain(lane)
    return settled({ kind: "moved" }, rev)
  }

  /**
   * Where a fresh column's other cards go once its first message is written:
   * that message, by the send's id, on the column's lane, or the lane its send
   * reserved once pi holds it, else none.
   */
  async function followers(
    cards: readonly CardRecord[],
    card: CardId,
    sent: { readonly sendId: string; readonly chat: Chat },
  ): Promise<{
    readonly message: EntryId | null
    readonly steps: readonly PlaceStep[]
  }> {
    const { root } = sent.chat
    const doc = await docs.root(root)
    const index = readTreeIndex(doc)
    const at = index.bySend.get(sent.sendId)
    if (at === undefined) return { message: null, steps: [] }
    const { lane, reserved } = sent.chat
    const held =
      reserved !== null &&
      readLanes({ doc, live }, index, cards, readQueueHolds(session)).some(
        l => l.name === reserved,
      )
    return {
      message: at,
      steps: planFreshFollow(
        cards,
        card,
        root,
        at,
        lane ?? (held ? reserved : null),
      ),
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
  ): Promise<Settled> {
    // gather: the history's stack, loaded before the places are read
    const root = historyOf(moves, readPlaces(places))
    const gesture =
      root === null ? undefined : await deps.histories.gestureOf(writer, root)
    // plan
    const { step, drain } = planMoveCommand(
      readPlaces(places),
      moves,
      writer,
      running,
    )
    // execute
    return carry(step, drain, { kind: "move", by: writer }, gesture)
  }

  return {
    move,

    /**
     * A queued or pinned card moved among its neighbours (ADR-0048 step 7),
     * as one step of the sender's history of moves in its root, so the
     * page can undo it. It changes no lane's turn, so it drains nothing.
     */
    async reorder(writer: WriterId, reorder: Reorder): Promise<Settled> {
      // gather: the history's stack, loaded before the places are read
      const gesture = await deps.histories.gestureOf(writer, reorder.at.root)
      // plan
      const step = planReorder(readPlaces(places), reorder)
      // execute
      return carry(step, [], { kind: "move", by: writer }, gesture)
    },

    /**
     * Every message card queued on `lane` back below the line, as the queue
     * is now (`planUnqueueAll`): one move, so one undo queues them again.
     * `nothing` when none is queued.
     */
    unqueueAll(writer: WriterId, lane: LaneName): Promise<Settled> {
      const moves = planUnqueueAll(readPlaces(places), lane)
      return moves.length === 0
        ? Promise.resolve(settled({ kind: "nothing" }))
        : move(writer, moves)
    },

    /**
     * Undo or redo the sender's newest move in `root`, whole or refused
     * (ADR-0066). Kyneta writes the revert, then `rev` is raised apart from
     * it (S82).
     */
    async undoMove(
      writer: WriterId,
      root: RootId,
      direction: MoveDirection,
    ): Promise<Settled> {
      const before = deps.provenance.before()
      const result = await deps.histories.step(writer, root, direction)
      const answer = undoAnswer(result, readPlaces(places), PLACES_DOC_ID)
      switch (answer.kind) {
        case "nothing":
          return settled({ kind: "nothing" })
        case "refused":
          return unmoved(answer)
        case "undone": {
          const rev = raiseRev(places)
          await deps.provenance.after({ kind: direction, by: writer }, before)
          return settled({ kind: "undone", cards: answer.cards }, rev)
        }
      }
    },

    /** Set a card's command, or clear it (ADR-0055). */
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
      card: CardId,
      sent: { readonly sendId: string; readonly chat: Chat },
    ): Promise<number> {
      const cards = readPlaces(places)
      const followed = await followers(cards, card, sent)
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
      const thread = threadOf(
        index,
        readLanes({ doc, live }, index, cards, readQueueHolds(session)),
        {
          at: chat.at,
          mode: chat.mode,
          lane: chat.lane,
          me: writer,
        },
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
            root: chat.root,
            at: chat.at,
            lane: thread.lane.name,
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
