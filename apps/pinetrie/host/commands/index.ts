// host/commands — one command from one writer: decoded, checked against the
// archive, and routed to its module, in the place it runs
// (`placeOfCommand`, ADR-0065): a step on the documents' keeper, straight
// through to the owner of your repo, or a board move's three parts.

import { ERR, type Intent, type RootId, type WriterId } from "@pinetrie/core"
import type { Agent } from "@pinetrie/pi"
import {
  decodeCommand,
  encodeOutcome,
  type Outcome,
  type WireCommand,
} from "@pinetrie/protocol/codec"
import {
  readArchived,
  readBoardPlaces,
  readParticipantNames,
  readWorkflow,
} from "@pinetrie/reads"
import {
  archivedIn,
  BOARD,
  displayName,
  PARTICIPANT,
  placeStarted,
  setRecord,
  writesIn,
} from "@pinetrie/rules"
import { type Basics, failed, type HostKeeper, messageOf } from "../basics.ts"
import type { ControlSender } from "../control.ts"
import type { Names } from "../names.ts"
import type { Titles } from "../titles.ts"
import { type BoardDeps, handleRootMove, handleWorkflow } from "./board.ts"
import {
  type CardCommandDeps,
  createCardCommands,
  type Settled,
  settled,
} from "./cards.ts"
import { type Chat, type ChatDeps, sendChat, spendsCard } from "./chat.ts"
import {
  actOnLine,
  actOnOffer,
  handleCarryOn,
  handleQueueHold,
  handleStop,
  type LaneDeps,
} from "./lane.ts"
import { handleMark, type MarkDeps } from "./mark.ts"

export interface CommandDeps {
  readonly basics: ChatDeps["basics"]
  readonly agent: ChatDeps["agent"] &
    BoardDeps["agent"] &
    MarkDeps["agent"] &
    LaneDeps["agent"] &
    Pick<Agent, "writeValues">
  readonly work: ChatDeps["work"] & BoardDeps["work"] & LaneDeps["work"]
  readonly blobs: ChatDeps["blobs"]
  readonly cards: ChatDeps["cards"] & CardCommandDeps["cards"]
  readonly start: ChatDeps["start"]
  readonly cancel: LaneDeps["cancel"]
  readonly names: Pick<Names, "reserve">
  readonly titles: ChatDeps["titles"] & Pick<Titles, "asked">
  readonly drain: CardCommandDeps["drain"]
  readonly histories: CardCommandDeps["histories"]
  readonly provenance: CardCommandDeps["provenance"]
  /** The documents' keeper: a `documents` command is one step on it. */
  readonly keeper: Pick<HostKeeper, "run" | "track">
}

/**
 * Where a command runs (ADR-0065). An offer action and a `line` command act
 * on your repo only: they go straight to its owner, and hold no other
 * command. A move on the board is up to three parts (`handleRootMove`).
 * Everything else is one step on the documents' keeper.
 */
export function placeOfCommand(intent: Intent): "documents" | "repo" | "board" {
  switch (intent.kind) {
    case "offer":
    case "line":
      return "repo"
    case "move-root":
      return "board"
    default:
      return "documents"
  }
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
   * A queued card the host popped, sent as its queuer's message: the archive
   * gate, then `sendChat`, as a `chat` command goes.
   */
  sendPoppedQueuedCard(
    writer: WriterId,
    sendId: string,
    chat: Chat,
  ): Promise<Outcome>
}

export function createCommands(deps: CommandDeps): Commands {
  const { agent } = deps
  const { newId } = deps.basics
  const cardCommands = createCardCommands(deps)

  async function handle(
    sender: Pick<ControlSender, "send">,
    writer: WriterId | undefined,
    wire: WireCommand,
  ): Promise<void> {
    const id = typeof wire.id === "string" ? wire.id : ""
    const done = await outcomeOf(writer, wire, id).catch(
      (error: unknown): Settled => {
        const kind = typeof wire.kind === "string" ? wire.kind : "malformed"
        failed(deps.basics, `a ${kind} command`)(error)
        return settled({ kind: "failed", message: messageOf(error) })
      },
    )
    // Sent here alone, after the catch: a send that throws gets no second reply.
    sender.send(encodeOutcome(id, done.outcome, done.rev))
  }

  /** Decode, check and carry out one command, and say what came of it. */
  async function outcomeOf(
    writer: WriterId | undefined,
    wire: WireCommand,
    id: string,
  ): Promise<Settled> {
    if (writer === undefined)
      return settled({
        kind: "refused",
        code: ERR.INVALID_IDENTITY,
        message: "connect with your email as your principal",
      })

    const intent = decodeCommand(wire)
    if (intent.kind === "refused") return settled(intent)
    switch (placeOfCommand(intent)) {
      case "documents":
        return deps.keeper.run(() => carry(writer, intent, id))
      case "repo":
      case "board":
        // The archive gate is a synchronous read, so it needs no keeper.
        return carry(writer, intent, id)
    }
  }

  /** Check one decoded command against the archive, and carry it out. */
  async function carry(
    writer: WriterId,
    intent: Intent,
    id: string,
  ): Promise<Settled> {
    const archived = refuseInArchive(
      deps.basics,
      writesIn(intent, deps.basics.docs.rootOfLane),
    )
    if (archived !== null) return settled(archived)
    switch (intent.kind) {
      case "chat": {
        // The command's id is the send's id: its column finds its message by it.
        const sendId = id === "" ? newId() : id
        const sent = await sendChat(deps, writer, sendId, intent)
        // A thread at the root that was written started a root: it takes its
        // place on the board in the same step (ADR-0085).
        if (intent.at.kind === "root" && spendsCard(sent))
          await placeNewRoot(deps, writer, intent)
        const card = intent.card
        if (card === null) return settled(sent)
        if (spendsCard(sent))
          return settled(
            sent,
            await cardCommands.spend(writer, card.id, { sendId, chat: intent }),
          )
        if (sent.kind === "busy")
          return (
            (await cardCommands.queueBusy(writer, { ...intent, card })) ??
            settled(sent)
          )
        return settled(sent)
      }
      case "move":
        return cardCommands.move(writer, intent.moves)
      case "reorder":
        return cardCommands.reorder(writer, intent.reorder)
      case "unqueue-all":
        return cardCommands.unqueueAll(writer, intent.lane)
      case "queue-hold":
        return settled(
          await handleQueueHold(deps, intent.lane, intent.held, writer),
        )
      case "undo-move":
        return cardCommands.undoMove(writer, intent.root, intent.direction)
      case "set-command":
        return cardCommands.setCommand(intent.card, intent.command)
      case "traces-seen":
        return cardCommands.tracesSeen(writer, intent.traces)
      case "name":
        await agent.writeValues([
          setRecord(PARTICIPANT, { writer, name: intent.name }),
        ])
        return settled({ kind: "named" })
      case "stop":
        return settled(await handleStop(deps, intent.lane, writer))
      case "carry-on":
        return settled(await handleCarryOn(deps, intent.lane, writer))
      case "move-root":
        return settled(await handleRootMove(deps, writer, intent))
      case "workflow":
        return settled(await handleWorkflow(deps, intent))
      case "mark":
        return settled(await handleMark(deps, writer, intent))
      case "retitle":
        return settled(await deps.titles.asked(intent.root, writer))
      case "offer":
        return settled(await actOnOffer(deps, intent, writer))
      case "line":
        return settled(await actOnLine(deps, intent.action))
      case "reserve":
        return settled(
          (await deps.names.reserve(intent.lane)) === "held"
            ? {
                kind: "refused",
                code: ERR.LANE_ID_IN_USE,
                message: "that thread has started",
              }
            : { kind: "reserved" },
        )
    }
  }

  return {
    handle,
    async sendPoppedQueuedCard(writer, sendId, chat) {
      return (
        refuseInArchive(
          deps.basics,
          chat.at.kind === "root" ? [] : [chat.root],
        ) ?? (await sendChat(deps, writer, sendId, chat))
      )
    },
  }
}

/** A root a chat started, put at the end of the state its sender chose (ADR-0085). */
async function placeNewRoot(
  deps: Pick<CommandDeps, "basics" | "agent">,
  writer: WriterId,
  chat: Chat,
): Promise<void> {
  const { session, now } = deps.basics
  const workflow = readWorkflow(session)
  if (workflow === null) return
  await deps.agent.writeValues([
    setRecord(
      BOARD,
      placeStarted({
        root: chat.root,
        state: chat.state,
        by: writer,
        now: now(),
        workflow,
        places: readBoardPlaces(session),
      }),
    ),
  ])
}

/**
 * A command that would write in an archived root, one in the closed
 * workflow state, is refused, naming who moved it there (ADR-0029, ADR-0085). `sendChat`'s only callers are this dispatcher and
 * `sendPoppedQueuedCard`, both behind it, so it needs no check of its own.
 * `root` is the roots the command writes in (`writesIn`), which names them,
 * so no root's document is opened to check. Null when the command may go on.
 */
function refuseInArchive(
  basics: Pick<Basics, "session">,
  roots: readonly RootId[],
): Outcome | null {
  const { session } = basics
  const archived = readArchived(session)
  if (archived.size === 0) return null
  const record = archivedIn(roots, archived)
  if (record === null) return null
  const names = readParticipantNames(session)
  return {
    kind: "refused",
    code: ERR.ARCHIVED,
    message: `archived by ${displayName(record.by, names.get(record.by))}`,
  }
}
