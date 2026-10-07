import {
  cardId,
  commitId,
  ERR,
  type ErrCode,
  entryId,
  laneNameForThread,
  NOBODY,
  type ProjectRecord,
  parseMentions,
  ROOT,
  runId,
  type SentCard,
  type Sha256,
  writerId,
} from "@pinetrie/core"
import type { ThreadLaneHandle } from "@pinetrie/pi"
import { readTreeIndex } from "@pinetrie/reads"
import {
  BASE,
  CHAT_TYPE,
  type ChatDetails,
  type ChatMessage,
  LINE,
  PARTICIPANT,
  PROJECT,
  setRecord,
} from "@pinetrie/rules"
import { beginRun, writeEntry, writeLaneTip } from "@pinetrie/schema/fixtures"
import { describe, expect, test } from "vitest"
import {
  basics,
  methods,
  putLane,
  putValue,
  ROOT_ID,
  record,
  row,
  writeDirectory,
} from "../fakes.ts"
import {
  type Chat,
  type ChatDeps,
  executeChat,
  sendChat,
  spendsCard,
} from "./chat.ts"

const ALICE = writerId("alice@example.com")
const LANE = laneNameForThread("0123456789abcdef")
const details: ChatDetails = {
  author: ALICE,
  authorName: "Alice",
  text: "@agent go",
  compels: NOBODY,
  sendId: "s-1",
}

/** The agent, the scribe and the setup in one record, so the order of their calls shows. */
type FakePi = ChatDeps["agent"] & ChatDeps["scribe"] & ChatDeps["piSetup"]

function setUp(
  bad: typeof ERR.BAD_DIRECTORY | null,
  begin: ErrCode | null = null,
) {
  const b = basics()
  const pi = record<FakePi>({
    createThreadLane: async () => ({ kind: "created", lane: LANE }),
  })
  const work = record<ChatDeps["work"]>({
    project: null,
    checkDirectory: async () => bad,
    checkBegin: async () => begin,
    prepareLane: async () => {},
  })
  const started: string[] = []
  const seen: (readonly SentCard[])[] = []
  const titles = record<ChatDeps["titles"]>({ laneStarted: async () => {} })
  const deps: ChatDeps = {
    basics: b,
    agent: pi.port,
    scribe: pi.port,
    piSetup: pi.port,
    work: work.port,
    blobs: record<ChatDeps["blobs"]>().port,
    cards: record<ChatDeps["cards"]>().port,
    start: (lane, start) => {
      started.push(lane)
      if (start.kind === "prompt") seen.push(start.pinnedSeen)
      return runId("r-1")
    },
    titles: titles.port,
  }
  const context = {
    view: { root: ROOT_ID, doc: b.root, session: b.session, live: b.live },
    index: readTreeIndex(b.root),
    writer: ALICE,
    work: null,
    base: null,
    pinned: [],
  }
  return { b, pi, work, started, seen, titles, deps, context }
}

describe("executeChat", () => {
  test("createAndRun in a missing directory refuses, and never creates the lane", async () => {
    const { pi, started, deps, context } = setUp(ERR.BAD_DIRECTORY)
    const out = await executeChat(
      deps,
      { kind: "createAndRun", at: ROOT, lane: LANE, details },
      context,
    )
    expect(out).toMatchObject({ kind: "refused", code: ERR.BAD_DIRECTORY })
    expect(methods(pi.calls)).toEqual([])
    expect(started).toEqual([])
  })

  test("createAndRun creates the lane, prepares it, may title its root, and runs there", async () => {
    const { pi, work, started, titles, deps, context } = setUp(null)
    const out = await executeChat(
      deps,
      { kind: "createAndRun", at: ROOT, lane: LANE, details },
      context,
    )
    expect(out).toEqual({ kind: "started", runId: "r-1" })
    expect(pi.calls.map(c => [c.method, ...c.args])).toEqual([
      ["createThreadLane", { root: ROOT_ID, at: ROOT }, LANE],
    ])
    expect(methods(work.calls)).toEqual([
      "checkDirectory",
      "checkBegin",
      "prepareLane",
    ])
    expect(titles.calls.map(c => c.args)).toEqual([
      [
        {
          root: ROOT_ID,
          lane: LANE,
          at: ROOT,
          prompt: { author: "Alice", text: "@agent go" },
        },
      ],
    ])
    expect(started).toEqual([LANE])
  })

  test("a run carries the sender's pinned versions, for it to wait for", async () => {
    const { seen, deps, context } = setUp(null)
    const pinned = [{ id: cardId("c-1"), seen: "v-1" }]
    await executeChat(
      deps,
      { kind: "run", lane: LANE, details },
      {
        ...context,
        pinned,
      },
    )
    await executeChat(
      deps,
      { kind: "createAndRun", at: ROOT, lane: LANE, details },
      { ...context, pinned },
    )
    expect(seen).toEqual([pinned, pinned])
  })

  test("createAndRun from a base that cannot begin refuses, and never creates the lane (ADR-0060)", async () => {
    const { pi, started, deps, context } = setUp(null, ERR.BAD_BASE)
    const out = await executeChat(
      deps,
      { kind: "createAndRun", at: ROOT, lane: LANE, details },
      { ...context, base: "wip/gone" },
    )
    expect(out).toMatchObject({ kind: "refused", code: ERR.BAD_BASE })
    expect(pi.calls).toEqual([])
    expect(started).toEqual([])
  })

  test("busy writes nothing and answers busy: the sender's client queues its card", async () => {
    const { pi, work, started, deps, context } = setUp(null)
    const out = await executeChat(deps, { kind: "busy" }, context)
    expect(out).toEqual({ kind: "busy" })
    expect([pi.calls, work.calls, started]).toEqual([[], [], []])
  })
})

describe("sendChat", () => {
  const E1 = entryId("e-1")
  const BEA = writerId("bea@example.com")
  const SHA = "a".repeat(64) as Sha256
  const chat = (text: string, asksAgent = false): Chat => ({
    text,
    root: ROOT_ID,
    at: { kind: "entry", id: E1 },
    mode: "reply",
    lane: null,
    asksAgent,
    mentions: parseMentions(text),
    work: null,
    card: null,
    pinned: [],
    reserved: null,
    base: null,
    state: null,
  })
  function setUp(
    project: ProjectRecord | null = null,
    prepareUpdate: ChatDeps["work"]["prepareUpdate"] = async () => {
      throw new Error("no update here")
    },
  ) {
    const b = basics()
    writeEntry(b.root, row(E1, null))
    if (project !== null) putValue(b, setRecord(PROJECT, project))
    const cards = record<ChatDeps["cards"]>({
      writers: async () => [ALICE, BEA],
    })
    const pi = record<FakePi>({
      commands: () => [],
      appendToTree: async () => ({ kind: "appended", id: entryId("e-2") }),
      createThreadLane: async () => ({ kind: "created", lane: LANE }),
      // A catch-up is handed the lane's handle (`prepareUpdate`).
      lane: name => record<ThreadLaneHandle>({ name }).port,
    })
    const started: ChatMessage[] = []
    const seen: (readonly SentCard[])[] = []
    const deps: ChatDeps = {
      basics: b,
      agent: pi.port,
      scribe: pi.port,
      piSetup: pi.port,
      work: record<ChatDeps["work"]>({
        project,
        checkDirectory: async () => null,
        checkBegin: async () => null,
        prepareLane: async () => {},
        prepareUpdate,
      }).port,
      blobs: record<ChatDeps["blobs"]>({
        ref: sha =>
          sha === SHA
            ? { sha256: SHA, mimeType: "image/png", width: 2, height: 3 }
            : undefined,
      }).port,
      cards: cards.port,
      start: (_lane, s) => {
        if (s.kind === "prompt" && s.message.customType === CHAT_TYPE) {
          started.push(s.message as ChatMessage)
          seen.push(s.pinnedSeen)
        }
        return runId("r-1")
      },
      titles: record<ChatDeps["titles"]>({ laneStarted: async () => {} }).port,
    }
    return { b, pi, cards, started, seen, deps }
  }

  test("a thread at the root under a root id in use is refused, and nothing is written", async () => {
    const { b, pi, started, deps } = setUp()
    writeDirectory(b)
    const out = await sendChat(deps, ALICE, "s-1", {
      ...chat("do it", true),
      at: ROOT,
      mode: "branch",
    })
    expect(out).toMatchObject({ kind: "refused", code: ERR.ROOT_ID_IN_USE })
    expect([pi.calls, started]).toEqual([[], []])
  })

  test("a Start Agent column's message, naming nobody, starts a run", async () => {
    const { started, deps } = setUp()
    const out = await sendChat(deps, ALICE, "s-1", chat("do it", true))
    expect(out).toEqual({ kind: "started", runId: "r-1" })
    expect(started).toHaveLength(1)
  })

  test("the chat command's pinned versions reach its run", async () => {
    const { seen, deps } = setUp()
    const pinned = [{ id: cardId("c-1"), seen: "v-1" }]
    await sendChat(deps, ALICE, "s-1", { ...chat("do it", true), pinned })
    expect(seen).toEqual([pinned])
  })

  test("a new lane is created under the column's reserved id (ADR-0057)", async () => {
    const { pi, deps } = setUp()
    const reserved = laneNameForThread("01a0f9eb-86e1-77ad-a822-2a306786223f")
    await sendChat(deps, ALICE, "s-1", { ...chat("do it", true), reserved })
    const created = pi.calls.find(c => c.method === "createThreadLane")
    expect(created?.args[1]).toBe(reserved)
  })

  test("a sent message keeps the images its text shows, as references", async () => {
    const { pi, deps } = setUp()
    await sendChat(deps, ALICE, "s-1", chat(`look ![a](/blob/${SHA})`))
    const appended = pi.calls.find(c => c.method === "appendToTree")
    expect(appended?.args[0]).toMatchObject({
      details: {
        images: [{ sha256: SHA, mimeType: "image/png", width: 2, height: 3 }],
      },
    })
  })

  test("in a thread that works in its own copy, your working copy's paths are stored as the lane sees them", async () => {
    const { started, deps } = setUp({
      kind: "lanes",
      root: "/proj",
      rootDefault: "own",
    })
    await sendChat(deps, ALICE, "s-1", chat("@agent read /proj/a.txt"))
    expect(started[0]?.details.text).toBe(
      "@agent read /mnt/host-working-copy/a.txt",
    )
  })

  describe("a lane with no work of its own is caught up before its run (ADR-0080)", () => {
    /** A lane at E1 whose base, the line, moved to L2 bringing a file, its work `work`. */
    const behindLane = (
      b: ReturnType<typeof basics>,
      work: "none" | "some",
    ) => {
      putLane(b, LANE, E1)
      writeLaneTip(b.root, LANE, E1)
      putValue(
        b,
        setRecord(BASE, {
          lane: LANE,
          base: { kind: "line" },
          start: commitId("l1"),
          state: "ok",
          catchUp: { tip: commitId("t"), to: commitId("l2"), files: ["a.ts"] },
          untraced: [],
          work,
        }),
      )
      putValue(
        b,
        setRecord(LINE, {
          onto: "pinetrie-onto",
          wipPrefix: "wip/",
          publish: "main",
          published: { commit: null, behind: 0, ahead: 0 },
          commit: commitId("l2"),
          heads: { current: null, proposed: "x" },
          log: { current: null, proposed: "x" },
          wips: [],
          yours: {
            behind: 0,
            ahead: 0,
            catchUp: null,
            conflicts: { commits: 0, files: [] },
          },
          catchUp: true,
        }),
      )
    }
    const ask = (): Chat => ({ ...chat("@agent go on"), lane: LANE })

    test("the update first, keeping the lane up; then the chat runs after it, once", async () => {
      const updates: unknown[][] = []
      let b: ReturnType<typeof basics> | null = null
      const {
        started,
        deps,
        b: made,
      } = setUp(null, async (handle, ...args) => {
        updates.push([handle.name, ...args])
        if (updates.length > 1) throw new Error("caught up twice")
        // The update's entry is the thread's end now.
        if (b !== null) {
          writeEntry(
            b.root,
            row(entryId("u-1"), E1, { role: "update", content: "u" }),
          )
          writeLaneTip(b.root, LANE, entryId("u-1"))
        }
        return { kind: "clean" }
      })
      b = made
      behindLane(made, "none")
      const out = await sendChat(deps, ALICE, "s-1", ask())
      expect(out).toEqual({ kind: "started", runId: "r-1" })
      expect(updates).toEqual([
        [LANE, ALICE, "@agent go on", "bring-up-to-date", "run"],
      ])
      expect(started).toHaveLength(1)
    })

    test("a merge that conflicts runs the resolution, carrying the chat's text", async () => {
      const land = { role: "custom", customType: "pinetrie.land" } as never
      const prompts: unknown[] = []
      const { deps, b } = setUp(null, async () => ({
        kind: "conflicted",
        message: land,
      }))
      const out = await sendChat(
        {
          ...deps,
          start: (_lane, s) => {
            if (s.kind === "prompt") prompts.push(s.message)
            return runId("r-2")
          },
        },
        ALICE,
        "s-1",
        ((): Chat => {
          behindLane(b, "none")
          return ask()
        })(),
      )
      expect(out).toEqual({ kind: "started", runId: "r-2" })
      expect(prompts).toEqual([land])
    })

    test("a lane with work of its own is not caught up: it is told, at its run", async () => {
      const { started, deps, b } = setUp()
      behindLane(b, "some")
      expect(await sendChat(deps, ALICE, "s-1", ask())).toEqual({
        kind: "started",
        runId: "r-1",
      })
      expect(started).toHaveLength(1)
    })
  })

  test("a conflict names who holds the thread, as a writer", async () => {
    const { b, deps } = setUp()
    const out = await executeChat(
      deps,
      { kind: "conflict", by: BEA },
      {
        view: { root: ROOT_ID, doc: b.root, session: b.session, live: b.live },
        index: readTreeIndex(b.root),
        writer: ALICE,
        work: null,
        base: null,
        pinned: [],
      },
    )
    expect(out).toEqual({ kind: "conflict", by: BEA })
  })

  test("a message sent from a card carries its other writers, and spends nothing itself (ADR-0048)", async () => {
    const { pi, cards, deps } = setUp()
    const out = await sendChat(deps, ALICE, "s-1", {
      ...chat("from the card"),
      card: { id: cardId("c-1"), seen: "" },
    })
    expect(out).toEqual({ kind: "appended", id: "e-2" })
    const appended = pi.calls.find(c => c.method === "appendToTree")
    expect(appended?.args[0]).toMatchObject({
      details: { contributors: [BEA] },
    })
    expect(cards.calls.map(c => [c.method, ...c.args])).toEqual([
      ["writers", "c-1"],
    ])
  })

  test("spendsCard: written or running takes the card; busy, a conflict, a refusal or a failure leaves it", () => {
    expect(
      [
        { kind: "appended", id: entryId("e") },
        { kind: "started", runId: runId("r") },
        { kind: "busy" },
        { kind: "conflict", by: null },
        { kind: "refused", code: ERR.REFUSED, message: "no" },
        { kind: "failed", message: "boom" },
      ].map(o => spendsCard(o as never)),
    ).toEqual([true, true, false, false, false, false])
  })

  test("a send is refused for an image the host lacks, or when pi will not append it", async () => {
    const { deps } = setUp()
    const missing = "b".repeat(64)
    // Refused before it is planned: an image the host does not store.
    const early = await sendChat(deps, ALICE, "s-1", {
      ...chat(`look ![a](/blob/${missing})`),
      card: { id: cardId("c-1"), seen: "" },
    })
    // Refused as it is written: pi will not append it.
    const late = await sendChat(
      {
        ...deps,
        scribe: {
          appendToTree: async () => ({ kind: "refused", code: ERR.REFUSED }),
        },
      },
      ALICE,
      "s-2",
      { ...chat("from the card"), card: { id: cardId("c-1"), seen: "" } },
    )
    expect([early.kind, late.kind]).toEqual(["refused", "refused"])
  })

  test("a busy lane is answered busy, and nothing is written", async () => {
    const { b, pi, deps } = setUp()
    writeLaneTip(b.root, LANE, E1)
    beginRun(b.live, LANE, runId("r-0"))
    putValue(b, setRecord(PARTICIPANT, { writer: BEA, name: "Bea" }))
    const out = await sendChat(deps, ALICE, "s-1", {
      ...chat("@bea when it is done"),
      lane: LANE,
      card: { id: cardId("c-1"), seen: "" },
    })
    expect(out).toEqual({ kind: "busy" })
    expect(pi.calls).toEqual([])
  })

  test("a message with no card names no one else", async () => {
    const { pi, cards, deps } = setUp()
    await sendChat(deps, ALICE, "s-1", chat("plain"))
    expect(cards.calls).toEqual([])
    const appended = pi.calls.find(c => c.method === "appendToTree")
    expect(
      (appended?.args[0] as { details: ChatDetails }).details.contributors,
    ).toBeUndefined()
  })
})
