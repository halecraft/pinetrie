// host/commands/note — a note command (ADR-0025): gather, `planNote`, execute.

import {
  ERR,
  type Intent,
  noteId,
  parseMentions,
  type WriterId,
} from "@pineta/core"
import { planNote, sentNote } from "@pineta/marginalia"
import type { Agent } from "@pineta/pi"
import type { Outcome } from "@pineta/protocol/codec"
import { readLanes, readNotes, readTreeIndex } from "@pineta/reads"
import type { NoteTexts } from "../notes.ts"
import { type ChatDeps, sendChat } from "./chat.ts"

export interface NoteDeps {
  readonly chat: ChatDeps
  readonly agent: Pick<Agent, "setNote">
  readonly notes: Pick<NoteTexts, "hold">
}

/**
 * Whether a draft's send took it: written, running or waiting, the message
 * is the draft's now. On a conflict or a refusal nothing was sent, and it
 * stays a draft.
 */
export const draftSent = (sent: Outcome): boolean =>
  sent.kind === "appended" || sent.kind === "started" || sent.kind === "queued"

export async function handleNote(
  deps: NoteDeps,
  writer: WriterId,
  sendId: string,
  intent: Extract<Intent, { kind: "note" }>,
): Promise<Outcome> {
  const { agent, notes } = deps
  const { doc, newId } = deps.chat.basics

  // gather
  const { action } = intent
  const index = readTreeIndex(doc)

  // plan (pure)
  const planned = planNote({
    action,
    writer,
    notes: readNotes(doc),
    index,
    lanes: readLanes(doc, index),
    newId: noteId(newId()),
  })

  // execute
  switch (planned.kind) {
    case "refused":
      return planned
    case "existing":
      return { kind: "noted", id: planned.id }
    case "create":
      await notes.hold(planned.record.id, planned.text)
      await agent.setNote(planned.record)
      return { kind: "noted", id: planned.record.id }
    case "update":
      await agent.setNote(planned.record)
      return { kind: "noted", id: planned.record.id }
    case "send": {
      const text = (await notes.hold(planned.record.id, null)).text()
      if (text.trim() === "")
        return {
          kind: "refused",
          code: ERR.EMPTY_MESSAGE,
          message: "the draft is empty",
        }
      // Through the one send path, never through the command dispatcher: the
      // `note` command that brought it here was already checked.
      const sent = await sendChat(
        deps.chat,
        writer,
        sendId,
        {
          text,
          at: planned.at,
          mode: "reply",
          lane: planned.lane,
          asksAgent: false,
          mentions: parseMentions(text),
          work: null,
        },
        planned.record.contributors.filter(w => w !== writer),
      )
      if (draftSent(sent)) await agent.setNote(sentNote(planned.record, sendId))
      return sent
    }
  }
}
