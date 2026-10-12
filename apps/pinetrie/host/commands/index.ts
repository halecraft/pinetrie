// host/commands — one command from one writer: decoded, checked against the
// archive, and routed to its module, in the place it runs
// (`placeOfCommand`, ADR-0065): a step on the documents' keeper, straight
// through to the owner of your repo, or a board move's three parts.

import {
  ERR,
  errorText,
  historyScope,
  type Intent,
  type RootId,
  type TaskId,
  type TreeIndex,
  threadAt,
  type WriterId,
} from "@pinetrie/core"
import {
  decodeCommand,
  encodeOutcome,
  type Outcome,
  type WireCommand,
} from "@pinetrie/protocol/codec"
import {
  readArchived,
  readParticipantNames,
  readPlaces,
  readRunning,
  readTreeIndex,
} from "@pinetrie/reads"
import {
  archivedIn,
  displayName,
  heldIn,
  holdingWords,
  PARTICIPANT,
  type QueuePop,
  runsIn,
  setRecord,
  writesIn,
} from "@pinetrie/rules"
import { type Basics, failed, type HostKeeper } from "../basics.ts"
import type { ControlSender } from "../control.ts"
import type { Names } from "../names.ts"
import type { Provenance } from "../provenance.ts"
import type { Records } from "../records.ts"
import { tasksNow } from "../tasks.ts"
import type { Titles } from "../titles.ts"
import { type BoardDeps, handleTaskMove, handleWorkflow } from "./board.ts"
import {
  type CardCommandDeps,
  createCardCommands,
  type Settled,
  settled,
} from "./cards.ts"
import { type Chat, type ChatDeps, sendChat, spendsCard } from "./chat.ts"
import {
  actOnAccepted,
  actOnOffer,
  handleCarryOn,
  handleQueueHold,
  handleStop,
  type LaneDeps,
} from "./lane.ts"
import { handleMark, type MarkDeps } from "./mark.ts"
import { handlePicture, type PictureDeps } from "./picture.ts"

export interface CommandDeps {
  readonly basics: ChatDeps["basics"]
  readonly agent: ChatDeps["agent"] & LaneDeps["agent"]
  readonly scribe: ChatDeps["scribe"]
  readonly records: BoardDeps["records"] &
    MarkDeps["records"] &
    LaneDeps["records"] &
    Pick<Records, "writeValues">
  readonly piSetup: ChatDeps["piSetup"]
  readonly work: ChatDeps["work"] & BoardDeps["work"] & LaneDeps["work"]
  readonly blobs: ChatDeps["blobs"] & PictureDeps["blobs"]
  readonly fitImage: PictureDeps["fitImage"]
  readonly cards: ChatDeps["cards"] &
    CardCommandDeps["cards"] &
    LaneDeps["cards"] &
    BoardDeps["cards"]
  readonly start: ChatDeps["start"]
  readonly cancel: LaneDeps["cancel"]
  readonly names: Pick<Names, "reserve" | "ensure">
  readonly titles: ChatDeps["titles"] & Pick<Titles, "asked">
  readonly drain: CardCommandDeps["drain"]
  readonly histories: CardCommandDeps["histories"]
  readonly provenance: CardCommandDeps["provenance"] &
    Pick<Provenance, "onTaken">
  /** The documents' keeper: a `documents` command is one step on it. */
  readonly keeper: Pick<HostKeeper, "run" | "track">
  readonly relays: ChatDeps["relays"]
}

/**
 * Where a command runs (ADR-0065). An offer action and a setup or publish act
 * on your repo only: they go straight to its owner, and hold no other
 * command. A move on the board is up to three parts (`handleTaskMove`).
 * Everything else is one step on the documents' keeper.
 */
export function placeOfCommand(intent: Intent): "documents" | "repo" | "board" {
  switch (intent.kind) {
    case "offer":
    case "setup":
    case "publish":
      return "repo"
    case "move-task":
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
  const { records } = deps
  const { newId } = deps.basics
  const cardCommands = createCardCommands({
    ...deps,
    ensureNames: () => deps.names.ensure(),
  })
  // A change that takes a thread into an inventory stops its run, as the
  // taker's own stop, whatever wrote it (ADR-0124).
  deps.provenance.onTaken(async (threads, by) => {
    for (const lane of threads)
      if (readRunning(deps.basics.live, lane)) await handleStop(deps, lane, by)
  })

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
        return settled({ kind: "failed", message: errorText(error) })
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
    // gather: the task index once, for the gate and every card command
    const tasks = tasksNow(deps.basics)
    const archived = refuseInArchive(
      deps.basics,
      writesIn(intent, tasks, readPlaces(deps.basics.places)),
    )
    if (archived !== null) return settled(archived)
    const held = await refuseHeld(deps.basics, intent)
    if (held !== null) return settled(held)
    switch (intent.kind) {
      case "chat": {
        // The command's id is the send's id: its column finds its message by it.
        const sendId = id === "" ? newId() : id
        const sent = await sendChat(deps, writer, sendId, intent)
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
        return cardCommands.move(writer, intent.moves, intent.here, tasks)
      case "copy-thread":
        return cardCommands.copyThread(writer, intent, tasks)
      case "open-thread":
        return cardCommands.openThread(writer, intent)
      case "paste":
        return cardCommands.paste(writer, intent, tasks)
      case "spin-off":
        return cardCommands.spinOff(
          writer,
          intent,
          chat => sendChat(deps, writer, newId(), chat),
          tasks,
        )
      case "queue-card":
        return cardCommands.queueCard(
          writer,
          intent.move,
          intent.hold,
          intent.command,
          tasks,
        )
      case "reorder":
        return cardCommands.reorder(writer, intent.reorder, tasks)
      case "card-width":
        return cardCommands.cardWidth(writer, intent)
      case "unqueue-all":
        return cardCommands.unqueueAll(writer, intent.lane, tasks)
      case "queue-hold":
        return settled(
          await handleQueueHold(deps, intent.lane, intent.held, writer),
        )
      case "undo-move":
        return cardCommands.undoMove(
          writer,
          historyScope(intent.task),
          intent.direction,
          tasks,
        )
      case "set-command":
        return cardCommands.setCommand(intent.card, intent.command)
      case "traces-seen":
        return cardCommands.tracesSeen(writer, intent.traces)
      case "name":
        await records.writeValues([
          setRecord(PARTICIPANT, { writer, name: intent.name }),
        ])
        return settled({ kind: "named" })
      case "picture":
        return settled(await handlePicture(deps, writer, intent))
      case "stop":
        return settled(await handleStop(deps, intent.lane, writer))
      case "carry-on":
        return settled(await handleCarryOn(deps, intent.lane, writer))
      case "move-task":
        return handleTaskMove({ ...deps, moves: cardCommands }, writer, intent)
      case "workflow":
        return settled(await handleWorkflow(deps, intent))
      case "mark":
        return settled(await handleMark(deps, writer, intent))
      case "retitle":
        return settled(await deps.titles.asked(intent.task, writer))
      case "offer":
        return settled(await actOnOffer(deps, intent, writer))
      case "setup":
      case "publish":
        return settled(await actOnAccepted(deps, intent.kind))
      case "reserve":
        return settled(
          (await deps.names.reserve(intent.lane)) === "held"
            ? {
                kind: "refused",
                code: ERR.THREAD_TAKEN,
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
          chat.at.kind === "queue"
            ? [tasksNow(deps.basics).taskOfThread.get(chat.at.thread)].filter(
                (t): t is TaskId => t !== undefined,
              )
            : [],
        ) ??
        (chat.at.kind === "queue"
          ? await refuseHeld(deps.basics, {
              kind: "pop",
              thread: chat.at.thread,
            })
          : null) ??
        (await sendChat(deps, writer, sendId, chat))
      )
    },
  }
}

/**
 * A command that would write in an archived task, or move a card out of
 * one, is refused, naming who archived it (ADR-0029, ADR-0122, ADR-0116).
 * `sendChat`'s only callers are this dispatcher and `sendPoppedQueuedCard`,
 * both behind it, so it needs no check of its own. `tasks` is the tasks the
 * command writes in (`writesIn`), so no root's document is opened to check.
 * Null when the command may go on.
 */
/**
 * A command that would run, or write a message, in a thread someone holds
 * in their inventory, or one trashed, is refused: `runsIn` says where each
 * kind of command runs, and a branch's fork is read from its root's tree.
 * Null when the command may go on.
 */
async function refuseHeld(
  basics: Pick<Basics, "places" | "docs" | "session">,
  command: Intent | QueuePop,
): Promise<Outcome | null> {
  const at = runsIn(command)
  if (at.length === 0) return null
  // gather: the trees of the roots a branch forks in
  const trees = new Map<RootId, TreeIndex>()
  for (const a of at)
    if (a.kind === "entry" && !trees.has(a.root))
      trees.set(a.root, readTreeIndex(await basics.docs.root(a.root)))
  const held = heldIn(
    at,
    readPlaces(basics.places),
    (root, entry) => {
      const index = trees.get(root)
      return index === undefined ? null : threadAt(index, entry)
    },
    tasksNow(basics).forkOf,
  )
  return held === null
    ? null
    : {
        kind: "refused",
        code: ERR.REFUSED,
        message: holdingWords(held.holding),
      }
}

function refuseInArchive(
  basics: Pick<Basics, "session" | "places">,
  tasks: readonly TaskId[],
): Outcome | null {
  const { session, places } = basics
  const archived = readArchived(session, places)
  if (archived.size === 0) return null
  const record = archivedIn(tasks, archived)
  if (record === null) return null
  const names = readParticipantNames(session)
  return {
    kind: "refused",
    code: ERR.TASK_ARCHIVED,
    message: `archived by ${displayName(record.by, names.get(record.by))}: restore the task first`,
  }
}
