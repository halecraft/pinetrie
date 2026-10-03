// host/commands/cards — the commands that move cards (ADR-0059): a move, a
// card's command, a busy chat's card queued, and a sent card spent.
//
// Each runs inside one step of the host's `Serial`, as every command does, so
// it is ordered with the take and with every other move: gather the places,
// plan purely, then write through `applyPlaceStep`. Every answer that wrote
// the places document, or refused a move, carries its `rev`: a client draws
// its move until its copy reaches it.

import {
  type CardCommand,
  type CardId,
  type CardRecord,
  keyOf,
  type LaneName,
  type Move,
  type SentCard,
  threadOf,
  type WriterId,
} from "@pineta/core"
import {
  type MoveStep,
  planFreshFollow,
  planMoveCommand,
  planSetCommand,
} from "@pineta/marginalia"
import type { Outcome } from "@pineta/protocol/codec"
import {
  readLanes,
  readPlaces,
  readRunning,
  readTreeIndex,
} from "@pineta/reads"
import type { Basics } from "../basics.ts"
import type { CardPort } from "../cards.ts"
import { applyPlaceStep } from "../places.ts"
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
  /** Queue a drain of the lane on the host's `Serial`, not awaited. */
  readonly drain: (lane: LaneName) => void
}

export function createCardCommands(deps: CardCommandDeps) {
  const { docs, live, places } = deps.basics
  const running = (lane: LaneName) => readRunning(deps.basics.live, lane)

  /**
   * Carry out a step: a write, or a removal whose text then goes (record
   * first, S64), and the drain it calls for. A refusal says where the card is
   * now and who put it there.
   */
  async function carry(
    step: MoveStep,
    drain: LaneName | null,
  ): Promise<Settled> {
    if (step.kind === "refused")
      return settled(
        {
          kind: "unmoved",
          code: step.code,
          place: step.now === null ? null : keyOf(step.now.place),
          by: step.now?.placer ?? null,
        },
        places.rev(),
      )
    const rev = applyPlaceStep(places, step)
    if (step.kind === "remove") await deps.cards.destroy(step.id)
    if (drain !== null) deps.drain(drain)
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
    /** A handoff: applied when the card is where its sender saw it, else refused. */
    move(writer: WriterId, move: Move): Promise<Settled> {
      const { step, drain } = planMoveCommand(
        readPlaces(places),
        move,
        writer,
        running,
      )
      return carry(step, drain)
    },

    /** Set a card's command, or clear it (ADR-0055). */
    setCommand(card: CardId, command: CardCommand | null): Promise<Settled> {
      return carry(planSetCommand(readPlaces(places), card, command), null)
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
      for (const step of await followers(cards, card, sent))
        applyPlaceStep(places, step)
      const rev = cards.some(c => c.id === card)
        ? applyPlaceStep(places, { kind: "remove", id: card })
        : places.rev()
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
        writer,
        running,
      )
      if (step.kind !== "write") return null
      const { rev } = await carry(step, drain)
      return settled({ kind: "queued" }, rev)
    },
  }
}
