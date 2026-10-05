// The scribe: the host's writes, one pi session per document, and the end of
// each session (ADR-0092, S113).

import {
  BACKGROUND_CONTEXT as CTX,
  type StorageBackedSession,
} from "@earendil-works/pi-agent-core"
import {
  atEntry,
  entryId,
  laneNameForThread,
  NOBODY,
  ROOT,
  type ThreadName,
  type ValueWrite,
  writerId,
} from "@pinetrie/core"
import {
  deleteRecord,
  encodeChat,
  MARK,
  NAME,
  setRecord,
} from "@pinetrie/rules"
import {
  newRootDoc,
  newSessionDoc,
  readLaneNames,
  readValues,
} from "@pinetrie/schema"
import { describe, expect, test } from "vitest"
import { newId, type Stack } from "./agent.ts"
import { ONE_ROOT, oneRoot } from "./one-root.ts"
import { createScribe, planWrites, scribeInside } from "./scribe.ts"
import { scriptedModel } from "./scripted.ts"
import { startPi } from "./start-pi.ts"

const chat = (text: string) =>
  encodeChat(
    {
      author: writerId("ada@x.io"),
      authorName: "Ada",
      text,
      compels: NOBODY,
      sendId: newId(),
    },
    1,
  )

const lane = laneNameForThread("0190a0a0-0000-7000-8000-000000000001")
const entry = entryId("e-1")
const mark = { entry, title: "Plans", by: writerId("ada"), at: 1 }

describe("one session per document (S113)", () => {
  test("the agent's harness is over the scribe's session", async () => {
    const doc = newRootDoc()
    const pi = await startPi(oneRoot(doc), {
      model: { kind: "scripted", script: scriptedModel() },
    })
    // The agent's harness reads and writes first, so a session of its own
    // would have indexed the document before the scribe's append, and miss it.
    expect(
      await pi.agent.createThreadLane(
        { root: ONE_ROOT, at: ROOT },
        laneNameForThread(newId()),
      ),
    ).toMatchObject({ kind: "created" })
    const appended = await pi.scribe.appendToTree(chat("hello"), {
      root: ONE_ROOT,
      at: ROOT,
    })
    if (appended.kind !== "appended") throw new Error("not appended")
    const there = laneNameForThread(newId())
    expect(
      await pi.agent.createThreadLane(
        { root: ONE_ROOT, at: atEntry(appended.id) },
        there,
      ),
    ).toEqual({ kind: "created", lane: there })
    await pi.close()
  })

  test("release closes what was built over a session, then the session", async () => {
    const scribe = createScribe({
      documents: oneRoot(),
      replicaId: "test",
    })
    const closes: string[] = []
    let held: StorageBackedSession | undefined
    await scribeInside.open(scribe).over(ONE_ROOT, async session => {
      held = session
      const built: Stack = {
        lanes: null as never,
        async close() {
          closes.push(
            await session.getStats(CTX).then(
              () => "open",
              () => "closed",
            ),
          )
        },
      }
      return built
    })
    if (held === undefined) throw new Error("nothing built")
    const session = held
    await scribe.release(ONE_ROOT)
    expect(closes).toEqual(["open"])
    await expect(session.getStats(CTX)).rejects.toThrow("Session is closed")
  })

  test("a released root runs again, over a new session and harness (S113 case G)", async () => {
    const pi = await startPi(oneRoot(), {
      model: {
        kind: "scripted",
        script: scriptedModel({ answer: { text: "ok" } }),
      },
    })
    const made = await pi.agent.createThreadLane(
      { root: ONE_ROOT, at: ROOT },
      laneNameForThread(newId()),
    )
    if (made.kind !== "created") throw new Error("no lane")
    expect(await pi.agent.lane(made.lane).run(chat("one"), [])).toEqual({
      kind: "ok",
    })
    await pi.scribe.release(ONE_ROOT)
    await pi.scribe.writeValues([setRecord(MARK, mark, ONE_ROOT)])
    expect(await pi.agent.lane(made.lane).run(chat("two"), [])).toEqual({
      kind: "ok",
    })
    await pi.close()
  })
})

describe("writeValues (ADR-0062)", () => {
  test("planWrites refuses a namespace not the host's, naming it, and groups the rest by document in first-seen order", () => {
    const name = setRecord(NAME, {
      lane,
      name: "amber-fox" as ThreadName,
      at: 1,
    })
    const marked = setRecord(MARK, mark, ONE_ROOT)
    const unmarked = deleteRecord(MARK, entry, ONE_ROOT)
    expect(planWrites([marked, name, unmarked])).toEqual({
      kind: "groups",
      groups: [
        [{ kind: "root", root: ONE_ROOT }, [marked, unmarked]],
        [{ kind: "session" }, [name]],
      ],
    })
    const theirs = {
      ...name,
      namespace: "pi.branch.tip",
    } as unknown as ValueWrite
    expect(planWrites([name, theirs])).toEqual({
      kind: "refused",
      namespace: "pi.branch.tip",
    })
  })

  test("writes sets and deletes in one call, each in the document its target names (ADR-0063)", async () => {
    const doc = newRootDoc()
    const session = newSessionDoc()
    const scribe = createScribe({
      documents: oneRoot(doc, session),
      replicaId: "test",
    })
    await scribe.writeValues([
      setRecord(MARK, mark, ONE_ROOT),
      setRecord(NAME, { lane, name: "amber-fox" as ThreadName, at: 1 }),
    ])
    expect(readValues(doc, "pinetrie.mark")).toEqual([
      { key: entry, value: { title: "Plans", by: writerId("ada"), at: 1 } },
    ])
    expect(readValues(session, "pinetrie.mark")).toEqual([])
    expect(readValues(session, "pinetrie.name")).toHaveLength(1)
    expect(readValues(doc, "pinetrie.name")).toEqual([])
    await scribe.writeValues([deleteRecord(MARK, entry, ONE_ROOT)])
    expect(readValues(doc, "pinetrie.mark")).toEqual([])
    expect(readValues(session, "pinetrie.name")).toHaveLength(1)
    await scribe.close()
  })

  test("refuses a namespace that is not the host's, and writes nothing", async () => {
    const doc = newRootDoc()
    const scribe = createScribe({ documents: oneRoot(doc), replicaId: "test" })
    const theirs = {
      kind: "set",
      namespace: "pi.branch.tip",
      key: lane,
      value: null,
    } as unknown as ValueWrite
    await expect(
      scribe.writeValues([setRecord(MARK, mark, ONE_ROOT), theirs]),
    ).rejects.toThrow("not the host's")
    expect(readValues(doc, "pinetrie.mark")).toEqual([])
    expect(readLaneNames(doc)).toEqual([])
    await scribe.close()
  })

  test("a closed scribe refuses every write, in a document it never opened too", async () => {
    const scribe = createScribe({ documents: oneRoot(), replicaId: "test" })
    await scribe.close()
    await expect(
      scribe.writeValues([setRecord(MARK, mark, ONE_ROOT)]),
    ).rejects.toThrow("the scribe is closed")
  })
})
