import { entryId, noteId, writerId } from "@pineta/core"
import { writeEntry } from "@pineta/schema"
import { expect, test } from "vitest"
import { basics, methods, putNote, record, row } from "../fakes.ts"
import { handleNote, type NoteDeps } from "./note.ts"

const ADA = writerId("ada@example.com")
const E1 = entryId("e-1")

function setUp() {
  const b = basics()
  writeEntry(b.doc, row(E1, null))
  const agent = record<NoteDeps["agent"]>({ setNote: async () => {} })
  const notes = record<NoteDeps["notes"]>({
    hold: async () => ({ text: () => "" }),
  })
  const deps: NoteDeps = { basics: b, agent: agent.port, notes: notes.port }
  return { b, agent, notes, deps }
}

test("opening a message holds its new note's text before writing the record", async () => {
  const { agent, notes, deps } = setUp()
  const out = await handleNote(deps, ADA, {
    kind: "note",
    action: { kind: "open", entry: E1 },
  })
  expect(out.kind).toBe("noted")
  expect(methods(notes.calls)).toEqual(["hold"])
  expect(agent.calls[0]?.args[0]).toMatchObject({ entry: E1, openedBy: ADA })
})

test("marking a note done writes its record, and holds nothing", async () => {
  const { b, agent, notes, deps } = setUp()
  putNote(b.doc, noteId("n-1"), { openedBy: ADA })
  const out = await handleNote(deps, ADA, {
    kind: "note",
    action: { kind: "done", note: noteId("n-1") },
  })
  expect(out).toEqual({ kind: "noted", id: "n-1" })
  expect(notes.calls).toEqual([])
  expect(agent.calls[0]?.args[0]).toMatchObject({ state: "done" })
})
