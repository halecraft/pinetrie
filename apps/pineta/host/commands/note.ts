// host/commands/note — a note command (ADR-0025): gather, `planNote`, execute.

import { type Intent, noteId, type WriterId } from "@pineta/core"
import { planNote } from "@pineta/marginalia"
import type { Agent } from "@pineta/pi"
import type { Outcome } from "@pineta/protocol/codec"
import { readNotes, readTreeIndex } from "@pineta/reads"
import type { Basics } from "../basics.ts"
import type { NoteTexts } from "../notes.ts"

export interface NoteDeps {
  readonly basics: Pick<Basics, "doc" | "newId">
  readonly agent: Pick<Agent, "setNote">
  readonly notes: Pick<NoteTexts, "hold">
}

export async function handleNote(
  deps: NoteDeps,
  writer: WriterId,
  intent: Extract<Intent, { kind: "note" }>,
): Promise<Outcome> {
  const { agent, notes } = deps
  const { doc, newId } = deps.basics

  // plan (pure), over what is gathered
  const planned = planNote({
    action: intent.action,
    writer,
    notes: readNotes(doc),
    index: readTreeIndex(doc),
    newId: noteId(newId()),
  })

  // execute
  switch (planned.kind) {
    case "refused":
      return planned
    case "existing":
      return { kind: "noted", id: planned.id }
    case "create":
      await notes.hold(planned.record.id, null)
      await agent.setNote(planned.record)
      return { kind: "noted", id: planned.record.id }
    case "update":
      await agent.setNote(planned.record)
      return { kind: "noted", id: planned.record.id }
  }
}
