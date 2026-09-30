// host/commands — one command from one writer: decoded, checked against the
// archive, and routed to its module.

import { ERR, type Intent, type LaneName, type WriterId } from "@pineta/core"
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
  readLanes,
  readNotes,
  readParticipantNames,
  readTreeIndex,
} from "@pineta/reads"
import type { SessionDocHandle } from "@pineta/schema"
import type { ControlSender } from "../control.ts"
import { type ArchiveDeps, handleArchive } from "./archive.ts"
import { type ChatDeps, sendChat } from "./chat.ts"
import { actOnOffer, handleStop, type LaneDeps, startUpdate } from "./lane.ts"
import { handleMark, type MarkDeps } from "./mark.ts"
import { handleNote, type NoteDeps } from "./note.ts"

export interface CommandDeps {
  readonly basics: ChatDeps["basics"]
  readonly agent: ChatDeps["agent"] &
    NoteDeps["agent"] &
    ArchiveDeps["agent"] &
    MarkDeps["agent"] &
    LaneDeps["agent"] &
    Pick<Agent, "setParticipantName">
  readonly work: ChatDeps["work"] & ArchiveDeps["work"] & LaneDeps["work"]
  readonly blobs: ChatDeps["blobs"]
  readonly notes: NoteDeps["notes"]
  readonly start: ChatDeps["start"]
}

export interface Commands {
  /**
   * One command from one writer. The command is UNTRUSTED text off a socket,
   * so it is decoded first; the codec owns every shape rule. A sender whose
   * principal names nobody (`writer` undefined) is refused whatever it sends.
   */
  handle(
    sender: Pick<ControlSender, "send">,
    writer: WriterId | undefined,
    wire: WireCommand,
  ): Promise<void>
  /** An update, as the `update` command runs it: what a held update drains to. */
  update(lane: LaneName, by: WriterId): Promise<Outcome>
}

export function createCommands(deps: CommandDeps): Commands {
  const { agent } = deps
  const { doc, newId } = deps.basics
  const note: NoteDeps = { chat: deps, agent, notes: deps.notes }

  async function handle(
    sender: Pick<ControlSender, "send">,
    writer: WriterId | undefined,
    wire: WireCommand,
  ): Promise<void> {
    const id = typeof wire.id === "string" ? wire.id : ""
    const respond = (outcome: Outcome) =>
      sender.send(encodeOutcome(id, outcome))
    if (writer === undefined)
      return respond({
        kind: "refused",
        code: ERR.INVALID_IDENTITY,
        message: "connect with your email as your principal",
      })

    const intent = decodeCommand(wire)
    if (intent.kind === "refused") return respond(intent)
    const archived = refuseInArchive(doc, intent)
    if (archived !== null) return respond(archived)
    switch (intent.kind) {
      case "chat":
        // The command's id is the send's id: its column finds its message by it.
        return respond(
          await sendChat(deps, writer, id === "" ? newId() : id, intent, []),
        )
      case "note":
        return respond(
          await handleNote(note, writer, id === "" ? newId() : id, intent),
        )
      case "name":
        await agent.setParticipantName(writer, intent.name)
        return respond({ kind: "named" })
      case "stop":
        return respond(await handleStop(deps, intent.lane))
      case "archive":
        return respond(await handleArchive(deps, writer, intent))
      case "mark":
        return respond(await handleMark(deps, writer, intent))
      case "update":
        return respond(await startUpdate(deps, intent.lane, writer))
      case "offer":
        return respond(
          await actOnOffer(deps, intent.lane, intent.action, writer),
        )
    }
  }

  return { handle, update: (lane, by) => startUpdate(deps, lane, by) }
}

/**
 * A command that would write in an archived root is refused, naming who
 * archived it (ADR-0029). A sent draft reaches `sendChat` only through a
 * `note` `send`, which is checked here, so `sendChat` needs no check of its
 * own. Null when the command may go on.
 */
export function refuseInArchive(
  doc: SessionDocHandle,
  intent: Intent,
): Outcome | null {
  const archive = readArchive(doc)
  if (archive.size === 0) return null
  const index = readTreeIndex(doc)
  const at = writesAt(intent, readNotes(doc), index, readLanes(doc, index))
  const record = archivedAt(index, archive, at)
  if (record === null) return null
  const names = readParticipantNames(doc)
  return {
    kind: "refused",
    code: ERR.ARCHIVED,
    message: `archived by ${displayName(record.by, names.get(record.by))}`,
  }
}
