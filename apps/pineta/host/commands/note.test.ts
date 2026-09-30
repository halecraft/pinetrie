import {
  ERR,
  entryId,
  type LaneName,
  laneNameForThread,
  noteId,
  runId,
  writerId,
} from "@pineta/core"
import { PARTICIPANT_NAMESPACE } from "@pineta/marginalia"
import { beginRun, writeEntry, writeLaneTip } from "@pineta/schema"
import { describe, expect, test } from "vitest"
import { basics, methods, putNote, putValue, record, row } from "../fakes.ts"
import type { ChatDeps } from "./chat.ts"
import { draftSent, handleNote, type NoteDeps } from "./note.ts"

test("a draft is sent when its message is written, running or waiting; a conflict or refusal leaves it a draft", () => {
  expect(draftSent({ kind: "appended", id: entryId("e-1") })).toBe(true)
  expect(draftSent({ kind: "started", runId: runId("r-1") })).toBe(true)
  expect(draftSent({ kind: "queued", position: 0 })).toBe(true)
  expect(draftSent({ kind: "conflict", by: null })).toBe(false)
  expect(draftSent({ kind: "refused", code: ERR.REFUSED, message: "" })).toBe(
    false,
  )
})

describe("a draft's send", () => {
  const ADA = writerId("ada@example.com")
  const BEA = writerId("bea@example.com")
  const E1 = entryId("e-1")
  const LANE = laneNameForThread("0123456789abcdef")
  const NOTE = noteId("n-1")
  function setUp(lane: LaneName | null) {
    const b = basics()
    writeEntry(b.doc, row(E1, null))
    if (lane !== null) {
      writeLaneTip(b.doc, lane, E1)
      beginRun(b.doc, lane, runId("r-0"))
    }
    putNote(b.doc, NOTE, {
      state: "draft",
      subject: { kind: "draft", at: { kind: "entry", id: E1 }, lane },
      openedBy: ADA,
      contributors: [ADA],
    })
    // A named participant, so a draft naming her is plain: it is for her, not
    // the agent, and a plain message waits for a busy lane.
    putValue(b.doc, {
      namespace: PARTICIPANT_NAMESPACE,
      key: BEA,
      value: "Bea",
    })
    const chatAgent = record<ChatDeps["agent"]>({
      commands: () => [],
      appendToTree: async () => ({ kind: "appended", id: entryId("e-2") }),
      hold: async () => {},
    })
    const agent = record<NoteDeps["agent"]>({ setNote: async () => {} })
    const deps: NoteDeps = {
      chat: {
        basics: b,
        agent: chatAgent.port,
        work: record<ChatDeps["work"]>({ project: null }).port,
        blobs: record<ChatDeps["blobs"]>().port,
        start: () => runId("r-1"),
      },
      agent: agent.port,
      notes: record<NoteDeps["notes"]>({
        hold: async () => ({ text: () => "Later, @Bea" }),
      }).port,
    }
    const send = () =>
      handleNote(deps, ADA, "s-1", {
        kind: "note",
        action: { kind: "send", note: NOTE },
      })
    return { chatAgent, agent, send }
  }

  test("a draft sent where it can be appended is marked sent, linked to its message", async () => {
    const { agent, send } = setUp(null)
    expect(await send()).toMatchObject({ kind: "appended" })
    expect(agent.calls[0]?.args[0]).toMatchObject({
      id: NOTE,
      state: "done",
      subject: { kind: "sent", sendId: "s-1" },
    })
  })

  test("a draft sent to a busy lane waits in its outbox, through the send path", async () => {
    const { chatAgent, send } = setUp(LANE)
    expect(await send()).toMatchObject({ kind: "queued" })
    expect(methods(chatAgent.calls)).toEqual(["hold"])
  })
})
