// The agent over pi's lanes: its error mapping, creating a lane under the
// id the host gives, a harness per root, and what the model reads.
//
// Co-located inside packages/pi for the same reason as stored-row.test.ts: both
// concern pi's behaviour, and a test under test/ would reach across the
// boundary ADR-0003 holds.

import {
  cardId,
  commitId,
  ERR,
  type LaneName,
  laneNameForThread,
  NOBODY,
  ROOT,
  type RootId,
  rootIdFor,
  THE_AGENT,
  writerId,
} from "@pinetrie/core"
import {
  BEHIND_TYPE,
  encodeBehind,
  encodeChat,
  encodePinned,
  LANE,
  PINNED_TYPE,
  recordsIn,
  setRecord,
} from "@pinetrie/rules"
import {
  applyRecordWrites,
  type RootDocHandle,
  readEntries,
  readLaneNames,
  readNamespace,
  rowMessage,
  rowRetainedTail,
  type SessionDocHandle,
} from "@pinetrie/schema"
import { newRootDoc, newSessionDoc } from "@pinetrie/schema/fixtures"
import { describe, expect, test } from "vitest"
import { newId } from "./agent.ts"
import { ONE_ROOT, oneRoot } from "./one-root.ts"
import { scriptedModel } from "./scripted.ts"
import { startPi } from "./start-pi.ts"
import { laneErrCode } from "./thread-lanes.ts"

describe("laneErrCode", () => {
  test("maps pi's refusals onto our codes", () => {
    expect(laneErrCode("UnknownTarget")).toBe(ERR.UNKNOWN_TARGET)
    // Nothing navigates a lane any more (ADR-0020).
    expect(laneErrCode("InvalidNavigation")).toBe(ERR.REFUSED)
    // A crash leaves pi's operation open: busy until resumed (S36 item 18).
    expect(laneErrCode("LaneBusy")).toBe(ERR.BUSY)
  })

  test("an unrecognised tag is a generic refusal, not a crash", () => {
    // pi may add error tags, and this now maps runs and lane creation as well
    // as navigation, so a navigation-specific fallback would mislabel them.
    // Reporting a generic refusal is recoverable; throwing inside the host's
    // reply path is not.
    expect(laneErrCode("SomethingPiAddedLater")).toBe(ERR.REFUSED)
  })

  test("UnknownTarget is distinct from BUSY", () => {
    // These two arrive from the same union and mean opposite things: one is a
    // bad target, the other is "try again". Collapsing them would tell a user
    // to retry something that can never succeed.
    expect(laneErrCode("UnknownTarget")).not.toBe(laneErrCode("LaneBusy"))
  })
})

describe("createThreadLane (ADR-0057)", () => {
  const over = async (doc: RootDocHandle) =>
    (
      await startPi(oneRoot(doc), {
        model: { kind: "scripted", script: scriptedModel() },
      })
    ).agent

  test("creates the lane under the id it is given, and refuses one pi holds", async () => {
    const doc = newRootDoc()
    const agent = await over(doc)
    const lane = laneNameForThread(newId())
    expect(
      await agent.createThreadLane({ root: ONE_ROOT, at: ROOT }, lane),
    ).toEqual({
      kind: "created",
      lane,
    })
    // `harness.lane` would return the lane it holds, ignoring where to create.
    expect(
      await agent.createThreadLane({ root: ONE_ROOT, at: ROOT }, lane),
    ).toEqual({
      kind: "refused",
      code: ERR.LANE_ID_IN_USE,
    })
    await agent.close()
    // A later process holds it only in the document.
    const later = await over(doc)
    expect(
      await later.createThreadLane({ root: ONE_ROOT, at: ROOT }, lane),
    ).toEqual({
      kind: "refused",
      code: ERR.LANE_ID_IN_USE,
    })
    expect(readLaneNames(doc)).toEqual([lane])
    await later.close()
  })

  test("a lane that does not exist refuses every write as unknown", async () => {
    const agent = await over(newRootDoc())
    const lane = agent.lane(laneNameForThread(newId()))
    const unknown = { kind: "refused", code: ERR.UNKNOWN_TARGET }
    const message = encodeChat(
      {
        author: writerId("ada"),
        authorName: "Ada",
        text: "hi",
        compels: NOBODY,
        sendId: "s",
      },
      0,
    )
    expect(await lane.append(message)).toEqual(unknown)
    expect(await lane.run(message, [])).toEqual(unknown)
    expect(await lane.resume()).toEqual(unknown)
    await agent.close()
  })
})

describe("a pi session per root (ADR-0063)", () => {
  const OTHER = rootIdFor("01a0ffd2-0000-7000-8000-00000000000b")
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
  /** One session, two roots; each lane's record names its root. */
  const documents = (
    session: SessionDocHandle,
    roots: Map<RootId, RootDocHandle>,
  ) => ({
    session,
    root: async (id: RootId) => {
      const known = roots.get(id)
      if (known === undefined) throw new Error(`no root ${id}`)
      return known
    },
    rootOfLane: (lane: LaneName) =>
      recordsIn(LANE, readNamespace(session, LANE.namespace)).get(lane)?.root ??
      null,
  })

  test("each root's lane writes in its own document, and a later agent finds each by its record", async () => {
    const session = newSessionDoc()
    const roots = new Map([
      [ONE_ROOT, newRootDoc()],
      [OTHER, newRootDoc()],
    ])
    const script = scriptedModel({ answer: { text: "ok" } })
    const first = await startPi(documents(session, roots), {
      replicaId: "first",
      model: { kind: "scripted", script },
    })
    const lanes = [laneNameForThread(newId()), laneNameForThread(newId())]
    for (const [i, root] of [ONE_ROOT, OTHER].entries()) {
      const lane = lanes[i]
      if (lane === undefined) throw new Error("no lane")
      expect(
        await first.agent.createThreadLane({ root, at: ROOT }, lane),
      ).toEqual({
        kind: "created",
        lane,
      })
      applyRecordWrites(session, [
        setRecord(LANE, {
          lane,
          root,
          ownCopy: false,
          by: writerId("ada@x.io"),
          createdAt: 1,
        }),
      ])
      expect(await first.agent.lane(lane).run(chat(`in ${root}`), [])).toEqual({
        kind: "ok",
      })
    }
    await first.close()
    const texts = (root: RootId) =>
      Object.values(readEntries(roots.get(root) ?? newRootDoc()))
        .map(rowMessage)
        .map(m => (m as { content?: unknown }).content)
        .filter(c => typeof c === "string")
    expect(texts(ONE_ROOT).join()).toContain(`in ${ONE_ROOT}`)
    expect(texts(ONE_ROOT).join()).not.toContain(`in ${OTHER}`)
    expect(texts(OTHER).join()).toContain(`in ${OTHER}`)
    // A later process: each lane is found in its root, by its record.
    const second = await startPi(documents(session, roots), {
      replicaId: "second",
      model: { kind: "scripted", script },
    })
    for (const lane of lanes)
      expect(await second.agent.lane(lane).run(chat("again"), [])).toEqual({
        kind: "ok",
      })
    expect(await second.agent.interrupted([ONE_ROOT, OTHER])).toEqual([])
    await second.close()
  })
})

describe("pinned cards: what the model reads (ADR-0048, S92)", () => {
  const ADA = writerId("ada@x.io")
  const asked = (text: string) =>
    encodeChat(
      {
        author: ADA,
        authorName: "Ada",
        text,
        compels: { kind: "agent", agent: THE_AGENT },
        sendId: newId(),
      },
      1,
    )
  const cardsOf = (lane: LaneName, text: string) =>
    encodePinned(
      { lane, cards: [{ id: cardId("c-1"), text, by: ADA }], retired: [] },
      () => "Ada",
      1,
    )
  const rows = (doc: RootDocHandle) =>
    Object.values(readEntries(doc)).sort((a, b) => (a.id < b.id ? -1 : 1))
  const messageOf = (row: { payload: unknown }) =>
    rowMessage(row as never) as {
      role?: string
      customType?: string
      usage?: { cacheRead: number; cacheWrite: number }
    } | null
  async function laneOver(
    script: ReturnType<typeof scriptedModel>,
    doc = newRootDoc(),
  ) {
    const { agent } = await startPi(oneRoot(doc), {
      model: { kind: "scripted", script },
    })
    const made = await agent.createThreadLane(
      { root: ONE_ROOT, at: ROOT },
      laneNameForThread(newId()),
    )
    if (made.kind !== "created") throw new Error("no lane")
    return { agent, doc, lane: made.lane }
  }

  test("a run's cards entry is stored first, its prompt as its child; the model reads the cards before the message", async () => {
    const script = scriptedModel()
    let seen: readonly string[] = []
    script.use([
      {
        reply: context => {
          seen = context
          return "ok"
        },
      },
    ])
    const { agent, doc, lane } = await laneOver(script)
    const pinned = cardsOf(lane, "ship the sync fix")
    expect(await agent.lane(lane).run(asked("go"), [pinned])).toEqual({
      kind: "ok",
    })
    await agent.close()
    const cards = rows(doc).find(r => messageOf(r)?.customType === PINNED_TYPE)
    const prompt = rows(doc).find(r => r.parentId === cards?.id)
    expect(messageOf(prompt ?? { payload: null })?.customType).toBe(
      "pinetrie.chat",
    )
    expect(seen.at(-2)).toBe(pinned.content)
    expect(seen.at(-1)).toBe("Ada: go")
  })

  test("a base's news goes in before the cards entry, in the run's commit; the model reads it first, and the next run keeps the cache (ADR-0080)", async () => {
    const script = scriptedModel()
    let seen: readonly string[] = []
    script.use([
      {
        reply: context => {
          seen = context
          return "ok"
        },
      },
      { text: "ok" },
    ])
    const { agent, doc, lane } = await laneOver(script)
    const pad = (s: string) => `${s} ${"words ".repeat(200)}`
    const pinned = cardsOf(lane, pad("ship the sync fix"))
    const behind = encodeBehind(
      {
        from: { kind: "accepted" },
        to: commitId("l2"),
        files: ["a.ts"],
        overlap: [],
        conflicts: [],
      },
      1,
    )
    const handle = agent.lane(lane)
    expect(await handle.run(asked(pad("go")), [behind, pinned])).toEqual({
      kind: "ok",
    })
    await handle.run(asked(pad("again")), [])
    await agent.close()
    const news = rows(doc).find(r => messageOf(r)?.customType === BEHIND_TYPE)
    const cards = rows(doc).find(r => r.parentId === news?.id)
    const prompt = rows(doc).find(r => r.parentId === cards?.id)
    expect(
      [cards, prompt].map(r => messageOf(r ?? { payload: null })?.customType),
    ).toEqual([PINNED_TYPE, "pinetrie.chat"])
    expect(seen.slice(-3)).toEqual([
      behind.content,
      pinned.content,
      `Ada: ${pad("go")}`,
    ])
    const [first, second] = rows(doc)
      .map(r => messageOf(r))
      .filter(m => m?.role === "assistant")
      .map(m => m?.usage)
    if (first === undefined || second === undefined)
      throw new Error("two replies, each with its usage")
    expect(second.cacheRead).toBeGreaterThanOrEqual(
      first.cacheRead + first.cacheWrite - 1,
    )
  })

  test("an edited card keeps the cache: the request after it reads everything the request before it sent", async () => {
    const script = scriptedModel({ answer: { text: "ok" } })
    const { agent, doc, lane } = await laneOver(script)
    const pad = (s: string) => `${s} ${"words ".repeat(200)}`
    const handle = agent.lane(lane)
    await handle.run(asked(pad("one")), [cardsOf(lane, pad("card v1"))])
    await handle.run(asked(pad("two")), [])
    await handle.run(asked(pad("three")), [cardsOf(lane, pad("card v2"))])
    await agent.close()
    const usage = rows(doc)
      .map(r => messageOf(r))
      .filter(m => m?.role === "assistant")
      .map(m => m?.usage)
    const [, before, after] = usage
    if (before === undefined || after === undefined)
      throw new Error("three replies, each with its usage")
    expect(after.cacheRead).toBeGreaterThan(0)
    // Each part is estimated rounding up, so the whole can read one token
    // less than its two parts summed.
    expect(after.cacheRead).toBeGreaterThanOrEqual(
      before.cacheRead + before.cacheWrite - 1,
    )
  })

  test("pi's compaction carries the cards the model last read: the next request reads them after the summary, and the compaction entry holds them", async () => {
    // Every request's context, the summary's among them.
    const contexts: (readonly string[])[] = []
    const script = scriptedModel({
      answer: {
        reply: context => {
          contexts.push(context)
          return "ok"
        },
      },
      contextWindow: 30_000,
    })
    const { agent, doc, lane } = await laneOver(script)
    const big = (s: string) => `${s} ${"words ".repeat(10_000)}`
    const handle = agent.lane(lane)
    const pinned = cardsOf(lane, "ship the sync fix")
    await handle.run(asked(big("one")), [pinned])
    await handle.run(asked(big("two")), [])
    await handle.run(asked("three"), [])
    await agent.close()
    const compaction = rows(doc).find(r => r.type === "compaction")
    expect(
      (compaction === undefined ? [] : rowRetainedTail(compaction)).some(
        m => (m as { customType?: string }).customType === PINNED_TYPE,
      ),
    ).toBe(true)
    const seen = contexts.at(-1) ?? []
    expect(seen.at(-1)).toBe("Ada: three")
    const summary = seen.findIndex(t => t.includes("summary"))
    expect(summary).toBeGreaterThanOrEqual(0)
    expect(seen.indexOf(pinned.content)).toBeGreaterThan(summary)
  })
})
