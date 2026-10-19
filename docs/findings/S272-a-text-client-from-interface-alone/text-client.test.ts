// Disposable spike: a text client that draws a thread, its composer and an
// ask's digest. Arrange may use anything; `draw` may import only
// @pinetrie/interface, @pinetrie/session and core's vocabulary.

import {
  type EntryId,
  type TreeIndex,
  threadIdFor,
  threadLane,
  type WriterId,
  writerId,
} from "@pinetrie/core"
import * as I from "@pinetrie/interface"
import { DIGEST, setRecord } from "@pinetrie/rules"
import { applyRecordWrites, type StoredEntryRow } from "@pinetrie/schema"
import {
  newLiveDoc,
  newRootDoc,
  newSessionDoc,
  writeEntry,
  writeLaneTip,
} from "@pinetrie/schema/fixtures"
import { expect, test } from "vitest"

const LANE = threadIdFor("0123456789abcdef")
const ALICE = writerId("alice@example.com")

const row = (
  id: string,
  parentId: string | null,
  message: unknown,
): StoredEntryRow => ({
  id,
  parentId,
  type: "message",
  timestamp: 0,
  fromId: null,
  thread: LANE,
  payload: { message },
})

function draw(view: I.HeldView, me: WriterId): string[] {
  const facts = I.readSessionFacts(view)
  const index: TreeIndex = facts.index
  const end = index.endOf.get(LANE) ?? null
  const [column] = I.projectColumns(index, [{ anchor: end }])
  const ids = (column?.nodes ?? []).map(n => n.id)
  const segments = I.segmentPath(index, facts.asks, ids, new Set())
  const rows = I.columnRows(segments, facts.asks)
  const nameOf = (w: WriterId) => (w === me ? "you" : w)
  const out: string[] = []
  for (const r of rows) {
    if (r.kind === "message") out.push(`msg ${r.id}`)
    else {
      const ask = I.askView({
        index,
        asks: facts.asks,
        ask: r.ask,
        runningAsk: null,
        lastEnded: null,
        revisions: new Map(),
        digests: facts.digests,
        releasedPath: null,
        nameOf,
      })
      out.push(`ask ${I.askLine(index, r.ask, nameOf)} | ${ask.work}`)
      if (ask.digest !== null) out.push(`  digest: ${ask.digest.headline}`)
    }
  }
  const lanes = I.readHeldLanes(view, index, [], new Set())
  const lane = lanes.find(l => l.name === LANE)
  out.push(`lanes: ${lanes.length}`)
  if (lane !== undefined) {
    const plan = I.planSend({
      text: "go on",
      unstarted: false,
      lane: threadLane(lanes, LANE),
      participants: [],
      agents: [],
      reader: { me, nameOf: new Map() },
      command: null,
      noModel: null,
    })
    const button = I.sendButton(plan, { uploading: false, sending: false })
    out.push(`composer: [${button.label}]`)
  }
  return out
}

test("spike: a text client draws a thread from interface alone", () => {
  const root = newRootDoc()
  writeEntry(root, row("e1", null, { role: "user", content: "Fix the bug", writer: ALICE }))
  writeEntry(
    root,
    row("e2", "e1", {
      role: "assistant",
      content: [{ type: "text", text: "Fixed." }],
      stopReason: "stop",
    }),
  )
  writeLaneTip(root, LANE, "e2" as EntryId)
  applyRecordWrites(root, [
    setRecord(DIGEST, {
      prompt: "e1" as EntryId,
      at: 1,
      final: true,
      headline: "Fixed the bug",
      points: ["- one"],
    }),
  ])
  const lines = draw(
    { session: newSessionDoc(), live: newLiveDoc(), roots: [root] },
    ALICE,
  )
  console.log(lines.join("\n"))
  expect(lines.length).toBeGreaterThan(0)
})
