// The scribe: the host's appends, one pi session per root, and the end of
// each session (ADR-0092, S113).

import {
  BACKGROUND_CONTEXT as CTX,
  type StorageBackedSession,
} from "@earendil-works/pi-agent-core"
import { atEntry, NOBODY, ROOT, threadIdFor, writerId } from "@pinetrie/core"
import { encodeChat } from "@pinetrie/rules"
import { newRootDoc } from "@pinetrie/schema/fixtures"
import { describe, expect, test } from "vitest"
import { newId, type Stack } from "./agent.ts"
import { ONE_ROOT, oneRoot } from "./one-root.ts"
import { createScribe, scribeInside } from "./scribe.ts"
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
        threadIdFor(newId()),
      ),
    ).toMatchObject({ kind: "created" })
    const appended = await pi.scribe.appendToTree(chat("hello"), {
      root: ONE_ROOT,
      at: ROOT,
    })
    if (appended.kind !== "appended") throw new Error("not appended")
    const there = threadIdFor(newId())
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
      threadIdFor(newId()),
    )
    if (made.kind !== "created") throw new Error("no lane")
    expect(await pi.agent.lane(made.lane).run(chat("one"), [])).toEqual({
      kind: "ok",
    })
    await pi.scribe.release(ONE_ROOT)
    await pi.scribe.appendToTree(chat("between"), { root: ONE_ROOT, at: ROOT })
    expect(await pi.agent.lane(made.lane).run(chat("two"), [])).toEqual({
      kind: "ok",
    })
    await pi.close()
  })
})

test("a closed scribe refuses every append, in a root it never opened too", async () => {
  const scribe = createScribe({ documents: oneRoot(), replicaId: "test" })
  await scribe.close()
  await expect(
    scribe.appendToTree(chat("late"), { root: ONE_ROOT, at: ROOT }),
  ).rejects.toThrow("the scribe is closed")
})
