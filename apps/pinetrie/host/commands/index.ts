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
import {
  type Basics,
  failed,
  type HostKeeper,
  inStep,
  type StepBasics,
} from "../basics.ts"
import { canvasesNow } from "../canvases.ts"
import type { ControlSender } from "../control.ts"
import { queueFact } from "../facts.ts"
import type { Names } from "../names.ts"
import type { Places } from "../places.ts"
import type { Provenance } from "../provenance.ts"
import type { Records, StepRecords } from "../records.ts"
import type { StepDocs } from "../roots.ts"
import type { RunDocs } from "../runs.ts"
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
  resolveConflict,
  restoreAccepted,
} from "./lane.ts"
import { handleMark } from "./mark.ts"
import { handlePicture, type PictureDeps } from "./picture.ts"
import { type SendDeps, sendMessage, spendsCard } from "./send.ts"

export interface CommandDeps {
  readonly basics: Basics
  readonly agent: SendDeps["agent"] & LaneDeps["agent"]
  readonly scribe: SendDeps["scribe"]
  /** The session's records; a step's commands write through its documents. */
  readonly records: Pick<Records, "writeValues">
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
  readonly histories: CardCommandDeps["histories"] & BoardDeps["histories"]
  /** A running lane's root, held by its run. */
  readonly runs: RunDocs
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
 * Where each kind of command runs. An action on proposed changes, a setup or
 * publish, a restore and a conflict's version chosen act on your repo or
 * folder only: they go straight to its owner, and hold no other command. A move on the board is up to three parts (`handleCanvasMove`).
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
  restore: "repo",
  resolve: "repo",
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
    roots: StepDocs,
    writer: WriterId,
    sendId: string,
    outgoing: Send,
  ): Promise<Outcome>
}

/**
 * The commands' dependencies inside one step of the documents' keeper: its
 * documents, and the records it writes through them.
 */
type StepDeps = Omit<CommandDeps, "basics" | "records"> & {
  readonly basics: StepBasics
  readonly records: Pick<StepRecords, "writeValues">
}

export function createCommands(deps: CommandDeps): Commands {
  const { newId } = deps.basics
  /** `deps` inside the step whose documents are `roots`. */
  const stepDeps = (roots: StepDocs): StepDeps => ({
    ...deps,
    basics: inStep(deps.basics, roots),
    records: roots.records,
  })
  /** The card commands of the step whose documents `step` holds. */
  const cardsOf = (step: StepDeps) =>
    createCardCommands({ ...step, ensureNames: () => deps.names.ensure() })
  // A change that takes a thread into an inventory stops its run, as the
  // taker's own stop, whatever wrote it, in the step that made the change.
  deps.provenance.onTaken(async (threads, by, roots) => {
    for (const lane of threads)
      if (readRunning(deps.basics.live, lane))
        await handleStop(stepDeps(roots), lane, by)
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
        return deps.keeper.run(roots =>
          clearAndCarry(stepDeps(roots), writer, intent, id),
        )
      case "repo":
      case "board":
        return clearElsewhere(writer, intent)
    }
  }

  /** Clear one decoded command through the gate in its step, and carry it out. */
  async function clearAndCarry(
    step: StepDeps,
    writer: WriterId,
    intent: Intent,
    id: string,
  ): Promise<Settled> {
    // gather: the canvas index once, for the gate and every card command
    const canvases = canvasesNow(step.basics)
    const gate = await clear(step, step.basics.roots, intent, canvases)
    if (gate.kind !== "cleared") return settled(gate)
    return carry(step, writer, gate.command, id, canvases)
  }

  /**
   * Clear and carry out a command that runs outside a step: an action on
   * your repo goes to its owner, and a board move makes its own steps. The
   * gate opens no root for these kinds (`runsIn` names no entry), so it
   * needs no step.
   */
  async function clearElsewhere(
    writer: WriterId,
    intent: Intent,
  ): Promise<Settled> {
    const gate = await clear(deps, null, intent, canvasesNow(deps.basics))
    if (gate.kind !== "cleared") return settled(gate)
    const command = gate.command
    switch (command.kind) {
      case "move-canvas":
        return handleCanvasMove(
          { ...deps, moves: roots => cardsOf(stepDeps(roots)) },
          writer,
          command,
        )
      case "proposed":
        return settled(await actOnProposedChanges(deps, command, writer))
      case "setup":
      case "publish":
        return settled(await actOnAccepted(deps, command.kind))
      case "restore":
        return settled(await restoreAccepted(deps, command, writer))
      case "resolve":
        return settled(await resolveConflict(deps, command, writer))
      default:
        throw new Error(`${command.kind} is carried out in a step`)
    }
  }

  /** Carry out one command the gate cleared, in the step `step` holds. */
  async function carry(
    step: StepDeps,
    writer: WriterId,
    intent: Cleared<Intent>,
    id: string,
    canvases: CanvasIndex,
  ): Promise<Settled> {
    const deps = step
    const cardCommands = cardsOf(step)
    const { records } = step
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
          outgoing => send(step, writer, newId(), outgoing),
          fact => queueFact(deps, fact),
        )
      case "paste":
        return cardCommands.paste(writer, intent, canvases)
      case "spin-off":
        return cardCommands.spinOff(
          writer,
          intent,
          outgoing => send(step, writer, newId(), outgoing),
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
      case "workflow":
        return settled(await handleWorkflow(deps, intent))
      case "mark":
        return settled(await handleMark(deps, writer, intent))
      case "retitle":
        return settled(
          await deps.titles.asked(step.basics.roots, intent.canvas, writer),
        )
      case "move-canvas":
      case "proposed":
      case "setup":
      case "publish":
      case "restore":
      case "resolve":
        throw new Error(`${intent.kind} is carried out outside a step`)
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

  /** A send made for `writer`, cleared through the gate, then sent, in `step`. */
  async function send(
    step: StepDeps,
    writer: WriterId,
    sendId: string,
    outgoing: Send,
  ): Promise<Outcome> {
    const gate = await clear(
      step,
      step.basics.roots,
      outgoing,
      canvasesNow(step.basics),
    )
    return gate.kind === "cleared"
      ? sendMessage(step, writer, sendId, gate.command)
      : gate
  }

  return {
    handle,
    sendPoppedQueuedCard: (roots, writer, sendId, chat) =>
      send(stepDeps(roots), writer, sendId, chat),
  }
}
