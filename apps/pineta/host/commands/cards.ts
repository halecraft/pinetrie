// host/commands/cards — the commands that move cards (ADR-0059): a move, an
// undo of moves (ADR-0066), a card's command, a busy chat's card queued, and
// a sent card spent.
//
// Each runs inside one step of the documents' keeper, as every command does, so
// it is ordered with the take and with every other move: gather the places,
// plan purely, then write through `applyPlaceSteps`. Nothing else writes the
// places while a step awaits a stack loading, or an undo's write landing.
// Every answer that wrote the places document, or refused a move, carries
// its `rev`: a client draws its move until its copy reaches it.

import {
  type CardCommand,
  type CardId,
  type CardRecord,
  keyOf,
  type LaneName,
  type Move,
  type MoveDirection,
  type RootId,
  type SentCard,
  threadOf,
  type WriterId,
} from "@pineta/core"
import {
  historyOf,
  type MoveStep,
  type MovesStep,
  type PlaceStep,
  planFreshFollow,
  planMoveCommand,
  planSetCommand,
  undoAnswer,
} from "@pineta/marginalia"
import type { Outcome } from "@pineta/protocol/codec"
import { PLACES_DOC_ID } from "@pineta/protocol/messages"
import {
  readLanes,
  readPlaces,
  readRunning,
  readTreeIndex,
} from "@pineta/reads"
import type { Basics } from "../basics.ts"
import type { CardPort } from "../cards.ts"
import type { MoveHistories } from "../move-history.ts"
import { applyPlaceSteps, type Gesture, raiseRev } from "../places.ts"
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
  readonly basics: Pick<Basics, "docs" | "live" | "places">
  readonly cards: Pick<CardPort, "destroy">
  /** Queue a drain of the lane on the documents' keeper, not awaited. */
  readonly drain: (lane: LaneName) => void
  readonly histories: Pick<MoveHistories, "gestureOf" | "step">
}

export function createCardCommands(deps: CardCommandDeps) {
  const { docs, live, places } = deps.basics
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
   * given: writes, and removals whose texts then go (record first, S64), and
   * the drains they call for. A refusal says where the card is now and who
   * put it there.
   */
  async function carry(
    step: MovesStep | MoveStep,
    drain: readonly LaneName[],
    gesture?: Gesture,
  ): Promise<Settled> {
    if (step.kind === "refused") return unmoved(step)
    const steps = step.kind === "steps" ? step.steps : [step]
    const rev = applyPlaceSteps(places, steps, gesture)
    for (const s of steps)
      if (s.kind === "remove") await deps.cards.destroy(s.id)
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
  ) {
    const { root } = sent.chat
    const doc = await docs.root(root)
    const index = readTreeIndex(doc)
    const at = index.bySend.get(sent.sendId)
    if (at === undefined) return []
    const { lane, reserved } = sent.chat
    const held =
      reserved !== null &&
      readLanes({ doc, live }, index, cards).some(l => l.name === reserved)
    return planFreshFollow(
      cards,
      card,
      root,
      at,
      lane ?? (held ? reserved : null),
    )
  }

  return {
    /**
     * Handoffs, whole or refused: applied when every card is where its
     * sender saw it. Recorded as one step of the sender's history of moves
     * in the root `historyOf` names, when it names one (ADR-0066).
     */
    async move(writer: WriterId, moves: readonly Move[]): Promise<Settled> {
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
      return carry(step, drain, gesture)
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
      const result = await deps.histories.step(writer, root, direction)
      const answer = undoAnswer(result, readPlaces(places), PLACES_DOC_ID)
      switch (answer.kind) {
        case "nothing":
          return settled({ kind: "nothing" })
        case "refused":
          return unmoved(answer)
        case "undone":
          return settled(
            { kind: "undone", cards: answer.cards },
            raiseRev(places),
          )
      }
    },

    /** Set a card's command, or clear it (ADR-0055). */
    setCommand(card: CardId, command: CardCommand | null): Promise<Settled> {
      return carry(planSetCommand(readPlaces(places), card, command), [])
    },

    /**
     * A sent card's record goes, then its text (S64). Sent from a fresh
     * column, the column's other cards follow it to the message it became
     * (`planFreshFollow`), in this step. Its `rev` after.
     */
    async spend(
      card: CardId,
      sent: { readonly sendId: string; readonly chat: Chat },
    ): Promise<number> {
      const cards = readPlaces(places)
      const followed = await followers(cards, card, sent)
      const removed: readonly PlaceStep[] = cards.some(c => c.id === card)
        ? [{ kind: "remove", id: card }]
        : []
      const rev = applyPlaceSteps(places, [...followed, ...removed])
      await deps.cards.destroy(card)
      return rev
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
      const thread = threadOf(index, readLanes({ doc, live }, index, cards), {
        at: chat.at,
        mode: chat.mode,
        lane: chat.lane,
        me: writer,
      })
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
          {
            card: chat.card.id,
            from: keyOf(now.place),
            to: {
              kind: "queued",
              root: chat.root,
              at: chat.at,
              lane: thread.lane.name,
              seen: chat.card.seen,
            },
          },
        ],
        writer,
        running,
      )
      if (step.kind !== "steps") return null
      const { rev } = await carry(step, drain)
      return settled({ kind: "queued" }, rev)
    },
  }
}
