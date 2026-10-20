// The agent over pi's lanes: its error mapping, creating a lane under the
// id the host gives, a harness per root, and what the model reads.
// In packages/pi because it drives pi's harness, which only this package may
// import.

import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  atEntry,
  ERR,
  entryId,
  NOBODY,
  type Position,
  pointId,
  ROOT,
  type RootId,
  rootIdFor,
  THE_AGENT,
  type ThreadId,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { cardIdFor } from "@pinetrie/core/fixtures"
import {
  BEHIND_TYPE,
  encodeBehind,
  encodeIncoming,
  encodeMessage,
  encodePinned,
  encodeRelayMessage,
  LANE,
  PINNED_TYPE,
  type RequestTokens,
  recordsIn,
  setRecord,
} from "@pinetrie/rules"
import {
  applyRecordWrites,
  type RootDocHandle,
  readEntries,
  readLaneNames,
  readLaneTip,
  readNamespace,
  rowMessage,
  rowRetainedTail,
  type ScratchDocHandle,
  type SessionDocHandle,
} from "@pinetrie/schema"
import {
  newRootDoc,
  newScratchDoc,
  newSessionDoc,
} from "@pinetrie/schema/fixtures"
import { describe, expect, test } from "vitest"
import { type CreateAgentOptions, newId } from "./agent.ts"
import { NO_RESOURCES } from "./config.ts"
import { ONE_ROOT, oneRoot } from "./one-root.ts"
import { scriptedModel } from "./scripted.ts"
import { startPi } from "./start-pi.ts"
import { laneErrCode } from "./thread-lanes.ts"

describe("laneErrCode", () => {
  test("maps pi's refusals onto our codes", () => {
    expect(laneErrCode("UnknownTarget")).toBe(ERR.UNKNOWN_TARGET)
    // Nothing navigates a lane.
    expect(laneErrCode("InvalidNavigation")).toBe(ERR.REFUSED)
    // A crash leaves pi's operation open: busy until resumed.
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

describe("createThreadLane", () => {
  const over = async (doc: RootDocHandle) =>
    (
      await startPi(oneRoot(doc), {
        model: { kind: "scripted", script: scriptedModel() },
      })
    ).agent

  test("creates the lane under the id it is given, and refuses one pi holds", async () => {
    const doc = newRootDoc()
    const agent = await over(doc)
    const lane = threadIdFor(newId())
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
    const lane = agent.lane(threadIdFor(newId()))
    const unknown = { kind: "refused", code: ERR.UNKNOWN_TARGET }
    const message = encodeMessage(
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
    expect(await lane.isLeftOpen()).toBe(false)
    await agent.close()
  })
})

describe("a pi session per root", () => {
  const OTHER = rootIdFor("01a0ffd2-0000-7000-8000-00000000000b")
  const said = (text: string) =>
    encodeMessage(
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
    ...scratchOf(new Map<RootId, ScratchDocHandle>()),
    stored: async () => {},
    rootOfLane: (lane: ThreadId) =>
      recordsIn(LANE, readNamespace(session, LANE.namespace)).get(lane)?.root ??
      null,
  })
  /** Each root's scratch document in `held`, made when asked to. */
  const scratchOf = (held: Map<RootId, ScratchDocHandle>) => ({
    scratch: (id: RootId) => held.get(id),
    makeScratch: async (id: RootId) => {
      const made = held.get(id) ?? newScratchDoc()
      held.set(id, made)
      return made
    },
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
    const lanes = [threadIdFor(newId()), threadIdFor(newId())]
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
          history: null,
          by: writerId("ada@x.io"),
          createdAt: 1,
        }),
      ])
      expect(await first.agent.lane(lane).run(said(`in ${root}`), [])).toEqual({
        kind: "ok",
        promptChanged: [],
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
      expect(await second.agent.lane(lane).run(said("again"), [])).toEqual({
        kind: "ok",
        promptChanged: [],
      })
    expect(await second.agent.interrupted([ONE_ROOT, OTHER])).toEqual([])
    await second.close()
  })
})

describe("pinned cards: what the model reads", () => {
  const ADA = writerId("ada@x.io")
  const asked = (text: string) =>
    encodeMessage(
      {
        author: ADA,
        authorName: "Ada",
        text,
        compels: { kind: "agent", agent: THE_AGENT },
        sendId: newId(),
      },
      1,
    )
  const cardsOf = (lane: ThreadId, text: string) =>
    encodePinned(
      {
        lane,
        cards: [
          {
            id: cardIdFor("c1"),
            text,
            by: ADA,
          },
        ],
        retired: [],
      },
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
      threadIdFor(newId()),
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
      promptChanged: [],
    })
    await agent.close()
    const cards = rows(doc).find(r => messageOf(r)?.customType === PINNED_TYPE)
    const prompt = rows(doc).find(r => r.parentId === cards?.id)
    expect(messageOf(prompt ?? { payload: null })?.customType).toBe(
      "pinetrie.message",
    )
    expect(seen.at(-2)).toBe(pinned.content)
    expect(seen.at(-1)).toBe("Ada: go")
  })

  test("a base's news goes in before the cards entry, in the run's commit, and the model reads it first", async () => {
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
        to: pointId("l2"),
        files: ["a.ts"],
        overlap: [],
        conflicts: [],
      },
      1,
    )
    const handle = agent.lane(lane)
    expect(await handle.run(asked(pad("go")), [behind, pinned])).toEqual({
      kind: "ok",
      promptChanged: [],
    })
    await handle.run(asked(pad("again")), [])
    await agent.close()
    const news = rows(doc).find(r => messageOf(r)?.customType === BEHIND_TYPE)
    const cards = rows(doc).find(r => r.parentId === news?.id)
    const prompt = rows(doc).find(r => r.parentId === cards?.id)
    expect(
      [cards, prompt].map(r => messageOf(r ?? { payload: null })?.customType),
    ).toEqual([PINNED_TYPE, "pinetrie.message"])
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

  test("pi's compaction carries the lane's prompt: the request after it leads with the prompt the first one led with", async () => {
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
    await handle.run(asked(big("one")), [])
    await handle.run(asked(big("two")), [])
    await handle.run(asked("three"), [])
    await agent.close()
    const compaction = rows(doc).find(r => r.type === "compaction")
    const tail = compaction === undefined ? [] : rowRetainedTail(compaction)
    expect((tail[0] as { role?: string } | undefined)?.role).toBe("system")
    // A run after the compaction finds the prompt in view, and writes none.
    expect(rows(doc).filter(r => messageOf(r)?.role === "system")).toHaveLength(
      1,
    )
    // The summaries' own requests lead with pi's summarising prompt.
    const asks = contexts.filter(c => c[0]?.includes("<cwd>"))
    expect(asks.length).toBeGreaterThan(1)
    expect(asks.at(-1)?.[0]).toBe(asks[0]?.[0])
    expect(contexts.at(-1)).toBe(asks.at(-1))
  })

  test("a host started after AGENTS.md changed leads with the lane's prompt as it was, and its next run writes the change alone", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "pinetrie-prompt-"))
    const agents = path.join(project, "AGENTS.md")
    await writeFile(agents, "Follow rule one.\n")
    // A listed package makes pi load the project's context files.
    const lists = {
      ...NO_RESOURCES,
      packages: [path.join(import.meta.dirname, "fixtures", "fixture-pkg")],
    }
    const contexts: (readonly string[])[] = []
    const script = scriptedModel({
      answer: {
        reply: context => {
          contexts.push(context)
          return "ok"
        },
      },
    })
    const doc = newRootDoc()
    const options = {
      model: { kind: "scripted", script },
      project,
      lists,
    } as const
    const first = await startPi(oneRoot(doc), {
      ...options,
      replicaId: "first",
    })
    const made = await first.agent.createThreadLane(
      { root: ONE_ROOT, at: ROOT },
      threadIdFor(newId()),
    )
    if (made.kind !== "created") throw new Error("no lane")
    const { lane } = made
    expect(await first.agent.lane(lane).run(asked("one"), [])).toEqual({
      kind: "ok",
      promptChanged: [],
    })
    await first.close()
    await writeFile(agents, "Follow rule two.\n")
    const second = await startPi(oneRoot(doc), {
      ...options,
      replicaId: "second",
    })
    expect(await second.agent.lane(lane).run(asked("two"), [])).toEqual({
      kind: "ok",
      promptChanged: ["project_context"],
    })
    expect(await second.agent.lane(lane).run(asked("three"), [])).toEqual({
      kind: "ok",
      promptChanged: [],
    })
    await second.close()
    const [one, two] = contexts
    expect(one?.[0]).toContain("Follow rule one.")
    // The prompt leads as the first request had it; the change comes later.
    expect(two?.[0]).toBe(one?.[0])
    const change = two?.findIndex(t => t.includes("Follow rule two.")) ?? -1
    expect(change).toBeGreaterThan(two?.indexOf("ok") ?? Infinity)
    expect(rows(doc).filter(r => messageOf(r)?.role === "system")).toHaveLength(
      2,
    )
  })

  test("a reply is stored with the thinking it reports dropped as a count", async () => {
    const script = scriptedModel()
    script.use([{ text: "ok", dropped: 3 }])
    const { agent, doc, lane } = await laneOver(script)
    await agent.lane(lane).run(asked("go"), [])
    await agent.close()
    const replies = rows(doc)
      .map(r => messageOf(r) as { role?: string; diagnostics?: unknown } | null)
      .filter(m => m?.role === "assistant")
    expect(replies.map(m => m?.diagnostics)).toEqual([
      [
        {
          type: "anthropic_input_transformations",
          timestamp: 0,
          details: { dropped: 3 },
        },
      ],
    ])
  })

  test("a branch's run writes in the branch, and the trunk carrying on from the same fork in the trunk", async () => {
    const doc = newRootDoc()
    const { agent } = await startPi(oneRoot(doc), {
      model: { kind: "scripted", script: scriptedModel() },
    })
    const made = async (at: Position, thread: ThreadId) => {
      const lane = await agent.createThreadLane({ root: ONE_ROOT, at }, thread)
      if (lane.kind !== "created") throw new Error("no lane")
      return lane.lane
    }
    const trunk = await made(ROOT, threadIdFor(newId()))
    await agent.lane(trunk).run(asked("first"), [])
    const fork = readLaneTip(doc, trunk)
    if (fork === null) throw new Error("no fork")
    const branch = await made(atEntry(fork), threadIdFor(newId()))
    await agent.lane(branch).run(asked("aside"), [cardsOf(branch, "a card")])
    await agent.lane(trunk).run(asked("carry on"), [cardsOf(trunk, "a card")])
    await agent.close()
    const all = readEntries(doc)
    // Each lane's entries, from its tip up to the fork: its own run's alone.
    const since = (thread: ThreadId) => {
      const out: string[] = []
      for (
        let id = readLaneTip(doc, thread) as string | null;
        id !== null && id !== fork;
        id = all[id]?.parentId ?? null
      )
        out.push(id)
      return out
    }
    for (const thread of [branch, trunk]) {
      const ids = since(thread)
      // The run's cards entry, its prompt, and the reply at least.
      expect(ids.length).toBeGreaterThanOrEqual(3)
      expect(ids.map(id => all[id]?.thread)).toEqual(
        ids.map(() => (trunk === thread ? trunk : branch)),
      )
    }
    // The cards entry under the fork that is older is the branch's.
    const underFork = Object.values(all)
      .filter(r => r.parentId === fork)
      .sort((a, b) => (a.id < b.id ? -1 : 1))
    expect(underFork.map(r => r.thread)).toEqual([branch, trunk])
    expect(all[fork]?.thread).toBe(trunk)
  })
})

describe("agents talking", () => {
  const ADA = writerId("ada@x.io")
  const asked = (text: string) =>
    encodeMessage(
      {
        author: ADA,
        authorName: "Ada",
        text,
        compels: { kind: "agent", agent: THE_AGENT },
        sendId: newId(),
      },
      1,
    )
  async function laneOver(
    script: ReturnType<typeof scriptedModel>,
    gate: Pick<CreateAgentOptions, "onUsage" | "mayRequest">,
  ) {
    const doc = newRootDoc()
    const { agent } = await startPi(oneRoot(doc), {
      model: { kind: "scripted", script },
      ...gate,
    })
    const made = await agent.createThreadLane(
      { root: ONE_ROOT, at: ROOT },
      threadIdFor(newId()),
    )
    if (made.kind !== "created") throw new Error("no lane")
    return { agent, doc, lane: made.lane }
  }

  test("each request's tokens are told, by lane", async () => {
    const script = scriptedModel({ answer: { text: "ok" } })
    const told: [string, RequestTokens][] = []
    const { agent, lane } = await laneOver(script, {
      onUsage: (l, tokens) => told.push([l, tokens]),
    })
    await agent.lane(lane).run(asked("go"), [])
    await agent.close()
    expect(told.length).toBe(1)
    expect(told[0]?.[0]).toBe(lane)
    expect(told[0]?.[1].context).toBeGreaterThan(0)
    expect(told[0]?.[1].output).toBeGreaterThan(0)
  })

  test("a spent budget stops the run before its request is sent", async () => {
    const script = scriptedModel()
    let requests = 0
    script.use([
      {
        reply: () => {
          requests++
          return "should not be asked"
        },
      },
    ])
    const { agent, lane } = await laneOver(script, { mayRequest: () => false })
    await agent.lane(lane).run(asked("go"), [])
    await agent.close()
    expect(requests).toBe(0)
  })

  test("what an asked agent heard goes in first, in the run's commit, and the model reads it before the ask", async () => {
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
    const { agent, lane } = await laneOver(script, {})
    const from = threadIdFor(newId())
    const heard = encodeIncoming(
      { from, fromName: "sable-meadow", entries: [entryId("e-1")] },
      ["Ada: should we queue?"],
      1,
    )
    const relay = encodeRelayMessage(
      {
        from,
        fromName: "sable-meadow",
        source: entryId("e-1"),
        asker: { kind: "agent", thread: from },
        askerName: "sable-meadow",
        text: "what do you think?",
        allowance: entryId("e-1"),
        by: ADA,
      },
      1,
    )
    expect(await agent.lane(lane).run(relay, [heard])).toEqual({
      kind: "ok",
      promptChanged: [],
    })
    await agent.close()
    expect(seen.at(-2)).toBe(heard.content)
    expect(seen.at(-1)).toBe(relay.content)
  })
})
