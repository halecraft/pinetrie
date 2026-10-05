// The directory of roots (ADR-0063): what is read of a root's document for
// its record, and the tree of several held roots at once.

import {
  entryId,
  laneNameForThread,
  NOBODY,
  rootIdFor,
  type Sha256,
  writerId,
} from "@pinetrie/core"
import { encodeChat, MARK, setRecord } from "@pinetrie/rules"
import {
  newRootDoc,
  newSessionDoc,
  physicalKey,
  type RootDocHandle,
  type StoredEntryRow,
  writeEntry,
  writeLaneTip,
} from "@pinetrie/schema"
import { describe, expect, test } from "vitest"
import {
  readHeldIndex,
  readParticipantNames,
  readParticipants,
  readReferencedBlobs,
  readRootRecord,
  readTreeIndex,
} from "./index.ts"

const ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")
const ADA = writerId("ada@x.io")
const BEA = writerId("bea@x.io")
const CY = writerId("cy@x.io")
const SHA = "a".repeat(64) as Sha256

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
  payload: { message },
})
const chat = (text: string, author = ADA) =>
  encodeChat(
    { author, authorName: "Someone", text, compels: NOBODY, sendId: "s" },
    1,
  )
const agent = (text: string) => ({
  role: "assistant",
  content: [{ type: "text", text }],
})

function rootWith(...rows: StoredEntryRow[]): RootDocHandle {
  const doc = newRootDoc()
  for (const r of rows) writeEntry(doc, r)
  return doc
}

describe("readRootRecord", () => {
  test("its first line, writers, messages and newest, its mentions unresolved, and its images", () => {
    const doc = rootWith(
      row("e1", null, chat("plan the rail\nwith care")),
      row("e2", "e1", chat("@bea look")),
      row("e3", "e2", {
        role: "toolResult",
        content: [
          {
            type: "image",
            mimeType: "image/png",
            sha256: SHA,
            width: 1,
            height: 1,
          },
        ],
      }),
    )
    expect(readRootRecord(ROOT, doc)).toMatchObject({
      root: ROOT,
      entry: "e1",
      first: "e1",
      firstLine: "plan the rail",
      title: null,
      newest: "e2",
      writers: [ADA],
      mentions: [{ id: "e2", by: ADA, text: "@bea look" }],
      images: [SHA],
    })
  })

  test("a root's title is its root entry's mark", () => {
    const doc = rootWith(row("e1", null, chat("plan")))
    const w = setRecord(
      MARK,
      { entry: entryId("e1"), title: "Plans", by: ADA, at: 1 },
      ROOT,
    )
    if (w.kind !== "set") throw new Error("a set")
    doc.values.set(physicalKey(w.namespace, w.key), {
      namespace: w.namespace,
      key: w.key,
      value: w.value,
    })
    expect(readRootRecord(ROOT, doc).title).toBe("Plans")
  })

  test("each thread's writers are those on its path, in order of first message (ADR-0077)", () => {
    // e1 (Bea) ─ e2 (agent) ─ e3 (Ada) ─ e4 (agent)   lane A
    //                     └─ e5 (Cy)                    lane B
    const doc = rootWith(
      row("e1", null, chat("plan", BEA)),
      row("e2", "e1", agent("ok")),
      row("e3", "e2", chat("and tests", ADA)),
      row("e4", "e3", agent("done")),
      row("e5", "e2", chat("another way", CY)),
    )
    const a = laneNameForThread("a")
    const b = laneNameForThread("b")
    const empty = laneNameForThread("c")
    writeLaneTip(doc, a, entryId("e4"))
    writeLaneTip(doc, b, entryId("e5"))
    writeLaneTip(doc, empty, null)
    expect(readRootRecord(ROOT, doc).threads).toEqual({
      [a]: [BEA, ADA],
      [b]: [BEA, CY],
      [empty]: [],
    })
  })

  test("a root with no message yet has no entry", () => {
    expect(readRootRecord(ROOT, newRootDoc())).toMatchObject({
      entry: null,
      first: null,
      messages: 0,
    })
  })
})

test("readReferencedBlobs: every root's images from its record, without its document", () => {
  const session = newSessionDoc()
  session.values.set(physicalKey("pinetrie.root", ROOT), {
    namespace: "pinetrie.root",
    key: ROOT,
    value: {
      ...readRootRecord(ROOT, newRootDoc()),
      root: undefined,
      images: [SHA],
    },
  })
  expect([...readReferencedBlobs(session, [])]).toEqual([SHA])
})

test("readHeldIndex: several roots read as one tree, kept while none changes", () => {
  const a = rootWith(row("a1", null, chat("a")))
  const b = rootWith(row("b1", null, chat("b")))
  const both = readHeldIndex([a, b])
  expect([...both.roots].sort()).toEqual(["a1", "b1"])
  expect(readHeldIndex([a, b])).toBe(both)
  expect(readHeldIndex([a])).toBe(readTreeIndex(a))
  writeEntry(b, row("b2", "b1", chat("more")))
  expect(readHeldIndex([a, b])).not.toBe(both)
})

test("readParticipants: a writer only in a root not held still counts, from its record", () => {
  const session = newSessionDoc()
  const bea = writerId("bea@x.io")
  session.values.set(physicalKey("pinetrie.root", ROOT), {
    namespace: "pinetrie.root",
    key: ROOT,
    value: {
      ...readRootRecord(ROOT, newRootDoc()),
      root: undefined,
      writers: [bea],
    },
  })
  expect(readParticipants(session, readTreeIndex(newRootDoc()))).toEqual([
    "bea",
  ])
})

test("readParticipantNames keeps its map while the names are the same, whatever else the session writes", () => {
  const session = newSessionDoc()
  const name = (writer: string, n: string) =>
    session.values.set(physicalKey("pinetrie.participant", writer), {
      namespace: "pinetrie.participant",
      key: writer,
      value: n,
    })
  name(ADA, "Ada")
  const first = readParticipantNames(session)
  expect(first.get(ADA)).toBe("Ada")
  session.values.set(physicalKey("pinetrie.root", ROOT), {
    namespace: "pinetrie.root",
    key: ROOT,
    value: { ...readRootRecord(ROOT, newRootDoc()), root: undefined },
  })
  expect(readParticipantNames(session)).toBe(first)
  name(ADA, "Ada L")
  expect(readParticipantNames(session).get(ADA)).toBe("Ada L")
})
