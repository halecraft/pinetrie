// host/commands — one command from one writer: decoded, cleared through the
// gate (`gate.ts`), and routed to its module, in the place it runs
// (`placeOfCommand`): a step on the documents' keeper, straight through to the
// owner of your repo, or a board move's three parts.

import {
  ERR,
  errorText,
  historyScope,
  type Intent,
  type Send,
  type WriterId,
} from "@pinetrie/core"
import {
  decodeCommand,
  encodeOutcome,
  type Outcome,
  type WireCommand,
} from "@pinetrie/protocol/codec"
import { readRunning } from "@pinetrie/reads"
import {
  type CanvasIndex,
  type Cleared,
  PARTICIPANT,
  setRecord,
} from "@pinetrie/rules"
import { failed, type HostKeeper } from "../basics.ts"
import { canvasesNow } from "../canvases.ts"
import type { ControlSender } from "../control.ts"
import { queueFact } from "../facts.ts"
import type { Names } from "../names.ts"
import type { Places } from "../places.ts"
import type { Provenance } from "../provenance.ts"
import type { Records } from "../records.ts"
import type { Titles } from "../titles.ts"
import { type BoardDeps, handleCanvasMove, handleWorkflow } from "./board.ts"
import {
  type CardCommandDeps,
  createCardCommands,
  type Settled,
  settled,
} from "./cards.ts"
import { clear } from "./gate.ts"
import {
  actOnAccepted,
  actOnProposedChanges,
  handleCarryOn,
  handleQueueHold,
  handleSshAccess,
  handleStop,
  type LaneDeps,
} from "./lane.ts"
import { handleMark, type MarkDeps } from "./mark.ts"
import { handlePicture, type PictureDeps } from "./picture.ts"
import { type SendDeps, sendMessage, spendsCard } from "./send.ts"

export interface CommandDeps {
  readonly basics: SendDeps["basics"]
  readonly agent: SendDeps["agent"] & LaneDeps["agent"]
  readonly scribe: SendDeps["scribe"]
  readonly records: BoardDeps["records"] &
    MarkDeps["records"] &
    LaneDeps["records"] &
    Pick<Records, "writeValues">
  readonly piSetup: SendDeps["piSetup"]
  readonly work: SendDeps["work"] & BoardDeps["work"] & LaneDeps["work"]
  readonly blobs: SendDeps["blobs"] & PictureDeps["blobs"]
  readonly quoteBytes: SendDeps["quoteBytes"]
  readonly fitImage: PictureDeps["fitImage"]
  readonly cards: SendDeps["cards"] &
    CardCommandDeps["cards"] &
    LaneDeps["cards"] &
    BoardDeps["cards"]
  readonly start: SendDeps["start"]
  readonly cancel: LaneDeps["cancel"]
  readonly names: Pick<Names, "reserve" | "ensure">
  readonly titles: SendDeps["titles"] & Pick<Titles, "asked">
  readonly drain: CardCommandDeps["drain"]
  readonly histories: CardCommandDeps["histories"]
  /** The writer of the places. */
  readonly placesWriter: Places
  readonly provenance: CardCommandDeps["provenance"] &
    Pick<Provenance, "onTaken">
  /** The documents' keeper: a `documents` command is one step on it. */
  readonly keeper: Pick<HostKeeper, "run" | "track">
  /** The fact of an action on proposed changes is a late write. */
  readonly later: LaneDeps["later"]
  readonly relays: SendDeps["relays"]
}

/** Where a command runs: a step on the documents' keeper, your repo's owner, or a board move's three parts. */
type CommandPlace = "documents" | "repo" | "board"

/**
 * Where each kind of command runs. An action on proposed changes and a setup or
 * publish act on your repo only: they go straight to its owner, and hold no
 * other command. A move on the board is up to three parts (`handleCanvasMove`).
 * Everything else is one step on the documents' keeper. A kind with no place
 * does not compile.
 */
const COMMAND_PLACE = {
  send: "documents",
  reserve: "documents",
  name: "documents",
  picture: "documents",
  stop: "documents",
  "carry-on": "documents",
  "ssh-access": "documents",
  "queue-hold": "documents",
  "queue-card": "documents",
  "unqueue-all": "documents",
  move: "documents",
  "copy-thread": "documents",
  "open-thread": "documents",
  "branch-out": "documents",
  paste: "documents",
  "spin-off": "documents",
  reorder: "documents",
  "card-width": "documents",
  "undo-move": "documents",
  "set-command": "documents",
  "traces-seen": "documents",
  workflow: "documents",
  mark: "documents",
  retitle: "documents",
  proposed: "repo",
  setup: "repo",
  publish: "repo",
  "move-canvas": "board",
} as const satisfies Record<Intent["kind"], CommandPlace>

export const placeOfCommand = (intent: Intent): CommandPlace =>
  COMMAND_PLACE[intent.kind]

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
   * A queued card the host popped, sent as its queuer's message: cleared
   * through the gate, then `sendMessage`, as a `chat` command goes.
   */
  sendPoppedQueuedCard(
    writer: WriterId,
    sendId: string,
    said: Send,
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
  // taker's own stop, whatever wrote it.
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
        return deps.keeper.run(() => clearAndCarry(writer, intent, id))
      case "repo":
      case "board":
        // The gate opens no root for these kinds (`runsIn` names no entry),
        // so it needs no keeper.
        return clearAndCarry(writer, intent, id)
    }
  }

  /** Clear one decoded command through the gate, and carry it out. */
  async function clearAndCarry(
    writer: WriterId,
    intent: Intent,
    id: string,
  ): Promise<Settled> {
    // gather: the canvas index once, for the gate and every card command
    const canvases = canvasesNow(deps.basics)
    const gate = await clear(deps, intent, canvases)
    if (gate.kind !== "cleared") return settled(gate)
    return carry(writer, gate.command, id, canvases)
  }

  /** Carry out one command the gate cleared. */
  async function carry(
    writer: WriterId,
    intent: Cleared<Intent>,
    id: string,
    canvases: CanvasIndex,
  ): Promise<Settled> {
    switch (intent.kind) {
      case "send": {
        // The command's id is the send's id: its column finds its message by it.
        const sendId = id === "" ? newId() : id
        const sent = await sendMessage(deps, writer, sendId, intent)
        const card = intent.card
        if (card === null) return settled(sent)
        if (spendsCard(sent))
          return settled(
            sent,
            await cardCommands.spend(writer, card.id, { sendId, send: intent }),
          )
        if (sent.kind === "busy")
          return (
            (await cardCommands.queueBusy(writer, { ...intent, card })) ??
            settled(sent)
          )
        return settled(sent)
      }
      case "move":
        return cardCommands.move(writer, intent.moves, intent.here, canvases)
      case "copy-thread":
        return cardCommands.copyThread(writer, intent, canvases)
      case "open-thread":
        return cardCommands.openThread(writer, intent)
      case "branch-out":
        return cardCommands.branchOut(
          writer,
          intent,
          canvases,
          said => send(writer, newId(), said),
          fact => queueFact(deps, fact),
        )
      case "paste":
        return cardCommands.paste(writer, intent, canvases)
      case "spin-off":
        return cardCommands.spinOff(
          writer,
          intent,
          said => send(writer, newId(), said),
          canvases,
        )
      case "queue-card":
        return cardCommands.queueCard(
          writer,
          intent.move,
          intent.hold,
          intent.command,
          canvases,
        )
      case "reorder":
        return cardCommands.reorder(writer, intent.reorder, canvases)
      case "card-width":
        return cardCommands.cardWidth(writer, intent)
      case "unqueue-all":
        return cardCommands.unqueueAll(writer, intent.lane, canvases)
      case "queue-hold":
        return settled(
          await handleQueueHold(deps, intent.lane, intent.held, writer),
        )
      case "undo-move":
        return cardCommands.undoMove(
          writer,
          historyScope(intent.canvas),
          intent.direction,
          canvases,
        )
      case "set-command":
        return cardCommands.setCommand(writer, intent.card, intent.command)
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
      case "ssh-access":
        return settled(await handleSshAccess(deps, writer, intent))
      case "move-canvas":
        return handleCanvasMove(
          { ...deps, moves: cardCommands },
          writer,
          intent,
        )
      case "workflow":
        return settled(await handleWorkflow(deps, intent))
      case "mark":
        return settled(await handleMark(deps, writer, intent))
      case "retitle":
        return settled(await deps.titles.asked(intent.canvas, writer))
      case "proposed":
        return settled(await actOnProposedChanges(deps, intent, writer))
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

  /** A send made for `writer`, cleared through the gate, then sent. */
  async function send(
    writer: WriterId,
    sendId: string,
    said: Send,
  ): Promise<Outcome> {
    const gate = await clear(deps, said, canvasesNow(deps.basics))
    return gate.kind === "cleared"
      ? sendMessage(deps, writer, sendId, gate.command)
      : gate
  }

  return { handle, sendPoppedQueuedCard: send }
}
