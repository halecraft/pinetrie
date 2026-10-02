// host/commands — one command from one writer: decoded, checked against the
// archive, and routed to its module.

import { ERR, type LaneView, type WriterId } from "@pineta/core"
import { archivedAt, displayName, writesAt } from "@pineta/marginalia"
import type { Agent } from "@pineta/pi"
import {
  decodeCommand,
  encodeOutcome,
  type Outcome,
  type WireCommand,
} from "@pineta/protocol/codec"
import {
  readArchive,
  readCards,
  readLanes,
  readParticipantNames,
  readTreeIndex,
} from "@pineta/reads"
import type { CardsDocHandle, SessionDocHandle } from "@pineta/schema"
import { failed, messageOf } from "../basics.ts"
import type { CardPort } from "../cards.ts"
import type { ControlSender } from "../control.ts"
import type { Names } from "../names.ts"
import { type ArchiveDeps, handleArchive } from "./archive.ts"
import { type Chat, type ChatDeps, sendChat, spendsCard } from "./chat.ts"
import { actOnOffer, handleStop, type LaneDeps } from "./lane.ts"
import { handleMark, type MarkDeps } from "./mark.ts"

export interface CommandDeps {
  readonly basics: ChatDeps["basics"]
  readonly agent: ChatDeps["agent"] &
    ArchiveDeps["agent"] &
    MarkDeps["agent"] &
    LaneDeps["agent"] &
    Pick<Agent, "setParticipantName">
  readonly work: ChatDeps["work"] & ArchiveDeps["work"] & LaneDeps["work"]
  readonly blobs: ChatDeps["blobs"]
  readonly cards: ChatDeps["cards"] & Pick<CardPort, "spend">
  readonly start: ChatDeps["start"]
  readonly names: Pick<Names, "reserve">
}

export interface Commands {
  /**
   * One command from one writer. The command is UNTRUSTED text off a socket,
   * so it is decoded first; the codec owns every shape rule. A sender whose
   * principal names nobody (`writer` undefined) is refused whatever it sends.
   * Every command gets exactly one reply: one that throws is logged and
   * answered `failed`.
   */
  handle(
    sender: Pick<ControlSender, "send">,
    writer: WriterId | undefined,
    wire: WireCommand,
  ): Promise<void>
  /**
   * A queued card the host took, sent as its queuer's message: the archive
   * gate, then `sendChat`, as a `chat` command goes.
   */
  sendTaken(writer: WriterId, sendId: string, chat: Chat): Promise<Outcome>
}

export function createCommands(deps: CommandDeps): Commands {
  const { agent } = deps
  const { doc, cards, newId } = deps.basics

  async function handle(
    sender: Pick<ControlSender, "send">,
    writer: WriterId | undefined,
    wire: WireCommand,
  ): Promise<void> {
    const id = typeof wire.id === "string" ? wire.id : ""
    const outcome = await outcomeOf(writer, wire, id).catch(
      (error: unknown): Outcome => {
        const kind = typeof wire.kind === "string" ? wire.kind : "malformed"
        failed(deps.basics, `a ${kind} command`)(error)
        return { kind: "failed", message: messageOf(error) }
      },
    )
    // Sent here alone, after the catch: a send that throws gets no second reply.
    sender.send(encodeOutcome(id, outcome))
  }

  /** Decode, check and carry out one command, and say what came of it. */
  async function outcomeOf(
    writer: WriterId | undefined,
    wire: WireCommand,
    id: string,
  ): Promise<Outcome> {
    if (writer === undefined)
      return {
        kind: "refused",
        code: ERR.INVALID_IDENTITY,
        message: "connect with your email as your principal",
      }

    const intent = decodeCommand(wire)
    if (intent.kind === "refused") return intent
    const archived = refuseInArchive(doc, cards, lanes =>
      writesAt(intent, lanes),
    )
    if (archived !== null) return archived
    switch (intent.kind) {
      case "chat": {
        // The command's id is the send's id: its column finds its message by it.
        const sent = await sendChat(
          deps,
          writer,
          id === "" ? newId() : id,
          intent,
        )
        if (intent.card !== null && spendsCard(sent))
          await deps.cards.spend(intent.card)
        return sent
      }
      case "name":
        await agent.setParticipantName(writer, intent.name)
        return { kind: "named" }
      case "stop":
        return handleStop(deps, intent.lane, writer)
      case "archive":
        return handleArchive(deps, writer, intent)
      case "mark":
        return handleMark(deps, writer, intent)
      case "offer":
        return actOnOffer(deps, intent.lane, intent.action, writer)
      case "reserve":
        return (await deps.names.reserve(intent.lane)) === "held"
          ? {
              kind: "refused",
              code: ERR.LANE_TAKEN,
              message: "that thread has started",
            }
          : { kind: "reserved" }
    }
  }

  return {
    handle,
    async sendTaken(writer, sendId, chat) {
      return (
        refuseInArchive(doc, cards, () =>
          chat.at.kind === "root" ? null : chat.at.id,
        ) ?? (await sendChat(deps, writer, sendId, chat))
      )
    },
  }
}

/**
 * A command that would write in an archived root is refused, naming who
 * archived it (ADR-0029). `sendChat`'s only callers are this dispatcher and
 * `sendTaken`, both behind it, so it needs no check of its own. `writes` is
 * the entry the command writes at, from the lanes; read only when something
 * is archived. Null when the command may go on.
 */
function refuseInArchive(
  doc: SessionDocHandle,
  cards: CardsDocHandle,
  writes: (lanes: readonly LaneView[]) => string | null,
): Outcome | null {
  const archive = readArchive(doc)
  if (archive.size === 0) return null
  const index = readTreeIndex(doc)
  const at = writes(readLanes(doc, index, readCards(cards)))
  const record = archivedAt(index, archive, at)
  if (record === null) return null
  const names = readParticipantNames(doc)
  return {
    kind: "refused",
    code: ERR.ARCHIVED,
    message: `archived by ${displayName(record.by, names.get(record.by))}`,
  }
}
