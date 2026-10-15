import {
  commitId,
  ERR,
  type ErrCode,
  entryId,
  NOBODY,
  type ProjectRecord,
  parseMentions,
  ROOT,
  runId,
  type Send,
  type SentCard,
  type Sha256,
  taskIdFor,
  threadIdFor,
  type ValueWrite,
  type WriterId,
  workflowStateIdFor,
  writerId,
} from "@pinetrie/core"
import { cardIdFor } from "@pinetrie/core/fixtures"
import type { ThreadLaneHandle } from "@pinetrie/pi"
import { readPlaces } from "@pinetrie/reads"
import {
  ACCEPTED,
  BASE,
  CHAT_TYPE,
  type ChatDetails,
  type ChatMessage,
  PARTICIPANT,
  PROJECT,
  setRecord,
  THREAD,
  WORKFLOW,
} from "@pinetrie/rules"
import { beginRun, writeEntry, writeLaneTip } from "@pinetrie/schema/fixtures"
import { describe, expect, test } from "vitest"
import {
  basics,
  clearedSend,
  methods,
  NO_BLANK_CARDS,
  putLane,
  putTask,
  putValue,
  ROOT_ID,
  RUNS_ANY,
  record,
  row,
  TASK_ID,
  threadRow,
  writeDirectory,
} from "../fakes.ts"
import { type ChatDeps, executeChat, sendChat, spendsCard } from "./chat.ts"

/** A new tab's task: in no store yet. */
const NEW_TASK = taskIdFor("01a0ffd2-0000-7000-8000-0000000000bb")

const ALICE = writerId("alice@example.com")
const LANE = threadIdFor("0123456789abcdef")
const NEW = threadIdFor("01a0f9eb-86e1-77ad-a822-2a306786223f")
const details: ChatDetails = {
  author: ALICE,
  authorName: "Alice",
  text: "@agent go",
  compels: NOBODY,
  sendId: "s-1",
}

/** The agent, the scribe and the setup in one record, so the order of their calls shows. */
type FakePi = ChatDeps["agent"] & ChatDeps["scribe"] & ChatDeps["piSetup"]

function setUp(begin: ErrCode | null = null) {
  const b = basics()
  const pi = record<FakePi>({
    createThreadLane: async () => ({ kind: "created", lane: LANE }),
  })
  const work = record<ChatDeps["work"]>({
    ...RUNS_ANY,
    project: null,
    checkBegin: async () => begin,
    prepareLane: async () => {},
  })
  const started: string[] = []
  const seen: (readonly SentCard[])[] = []
  const titles = record<ChatDeps["titles"]>({ laneStarted: async () => {} })
  const deps: ChatDeps = {
    relays: { relayChat: async () => {} },
    names: record<ChatDeps["names"]>({ ensure: async () => {} }).port,
    basics: b,
    agent: pi.port,
    scribe: pi.port,
    piSetup: pi.port,
    work: work.port,
    blobs: record<ChatDeps["blobs"]>().port,
    cards: record<ChatDeps["cards"]>({
      blankQueued: NO_BLANK_CARDS.blankQueued,
    }).port,
    start: (lane, start) => {
      started.push(lane)
      if (start.kind === "prompt") seen.push(start.pinnedSeen)
      return runId("r-1")
    },
    titles: titles.port,
    records: record<ChatDeps["records"]>({ writeValues: async () => {} }).port,
  }
  const context = {
    view: { root: ROOT_ID, doc: b.root, session: b.session, live: b.live },
    writer: ALICE,
    base: null,
    pinned: [],
    start: null,
    quotes: [],
  }
  return { b, pi, work, started, seen, titles, deps, context }
}

describe("executeChat", () => {
  test("createAndRun creates the lane, prepares it, may title its root, and runs there", async () => {
    const { pi, work, started, titles, deps, context } = setUp()
    const out = await executeChat(
      deps,
      { kind: "createAndRun", at: ROOT, thread: LANE, details, starts: null },
      context,
    )
    expect(out).toEqual({ kind: "started", runId: "r-1" })
    expect(pi.calls.map(c => [c.method, ...c.args])).toEqual([
      ["createThreadLane", { root: ROOT_ID, at: ROOT }, LANE],
    ])
    expect(methods(work.calls)).toEqual([
      "checkBegin",
      "prepareLane",
      "runnable",
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
    const { seen, deps, context } = setUp()
    const pinned = [{ id: cardIdFor("c1"), seen: "v-1" }]
    await executeChat(
      deps,
      { kind: "run", thread: LANE, details },
      {
        ...context,
        pinned,
      },
    )
    await executeChat(
      deps,
      { kind: "createAndRun", at: ROOT, thread: LANE, details, starts: null },
      { ...context, pinned },
    )
    expect(seen).toEqual([pinned, pinned])
  })

  test("createAndRun from a base that cannot begin refuses, and never creates the lane", async () => {
    const { pi, started, deps, context } = setUp(ERR.BAD_BASE)
    const out = await executeChat(
      deps,
      { kind: "createAndRun", at: ROOT, thread: LANE, details, starts: null },
      { ...context, base: "wip/gone" },
    )
    expect(out).toMatchObject({ kind: "refused", code: ERR.BAD_BASE })
    expect(pi.calls).toEqual([])
    expect(started).toEqual([])
  })

  test("busy writes nothing and answers busy: the sender's client queues its card", async () => {
    const { pi, work, started, deps, context } = setUp()
    const out = await executeChat(deps, { kind: "busy" }, context)
    expect(out).toEqual({ kind: "busy" })
    expect([pi.calls, work.calls, started]).toEqual([[], [], []])
  })
})

/** `sendChat` of `chat`, cleared through the gate first, as every send is. */
const sendCleared = (
  deps: ChatDeps,
  writer: WriterId,
  sendId: string,
  chat: Send,
) => sendChat(deps, writer, sendId, clearedSend(chat))

describe("sendChat", () => {
  const E1 = entryId("e-1")
  const BEA = writerId("bea@example.com")
  const SHA = "a".repeat(64) as Sha256
  // E1 starts thread LANE: a lane by that name is the thread's.
  const chat = (text: string, asksAgent = false): Send => ({
    kind: "chat",
    text,
    root: ROOT_ID,
    at: { kind: "end", thread: LANE, seen: E1 },
    asksAgent,
    mentions: parseMentions(text),
    card: null,
    pinned: [],
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
    writeEntry(b.root, threadRow(E1, null, LANE))
    // The thread's task, which a branch from it is put in.
    putTask(b, LANE)
    if (project !== null) putValue(b, setRecord(PROJECT, project))
    const cards = record<ChatDeps["cards"]>({
      writers: async () => [ALICE, BEA],
      blankQueued: NO_BLANK_CARDS.blankQueued,
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
    const records = record<ChatDeps["records"]>({ writeValues: async () => {} })
    const names = record<ChatDeps["names"]>({ ensure: async () => {} })
    const deps: ChatDeps = {
      relays: { relayChat: async () => {} },
      basics: b,
      agent: pi.port,
      scribe: pi.port,
      piSetup: pi.port,
      work: record<ChatDeps["work"]>({
        ...RUNS_ANY,
        project,
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
      records: records.port,
      names: names.port,
    }
    return { b, pi, cards, started, seen, deps, records, names }
  }

  test("a thread at the root under a root id in use is refused, and nothing is written", async () => {
    const { b, pi, started, deps } = setUp()
    writeDirectory(b)
    const out = await sendCleared(deps, ALICE, "s-1", {
      ...chat("do it", true),
      at: { kind: "branch", thread: NEW, at: null, task: NEW_TASK },
    })
    expect(out).toMatchObject({ kind: "refused", code: ERR.ROOT_ID_IN_USE })
    expect([pi.calls, started]).toEqual([[], []])
  })

  test("a new tab's first send, its thread and task opened as it opened, writes its entry alone", async () => {
    const { b, pi, records, deps } = setUp()
    putTask(b, NEW, NEW_TASK)
    const first = {
      ...chat("do it", true),
      at: { kind: "branch", thread: NEW, at: null, task: NEW_TASK },
    } as const
    expect(await sendCleared(deps, ALICE, "s-1", first)).toEqual({
      kind: "started",
      runId: "r-1",
    })
    expect(
      pi.calls.filter(c => c.method === "createThreadLane").map(c => c.args[1]),
    ).toEqual([NEW])
    expect(records.calls).toEqual([])
    // Another thread at the root, in that task: its id is in use.
    const other = threadIdFor("01a0f9eb-86e1-77ad-a822-2a3067862240")
    expect(
      await sendCleared(deps, ALICE, "s-2", {
        ...first,
        at: { ...first.at, thread: other },
      }),
    ).toMatchObject({ kind: "refused", code: ERR.TASK_ID_IN_USE })
  })

  test("a Start Agent column's message, naming nobody, starts a run", async () => {
    const { started, deps } = setUp()
    const out = await sendCleared(deps, ALICE, "s-1", chat("do it", true))
    expect(out).toEqual({ kind: "started", runId: "r-1" })
    expect(started).toHaveLength(1)
  })

  test("the chat command's pinned versions reach its run", async () => {
    const { seen, deps } = setUp()
    const pinned = [{ id: cardIdFor("c1"), seen: "v-1" }]
    await sendCleared(deps, ALICE, "s-1", { ...chat("do it", true), pinned })
    expect(seen).toEqual([pinned])
  })

  test("a new lane is named by its thread's id", async () => {
    const { pi, deps } = setUp()
    await sendCleared(deps, ALICE, "s-1", chat("do it", true))
    await sendCleared(deps, ALICE, "s-2", {
      ...chat("do it", true),
      at: { kind: "branch", thread: NEW, at: E1, task: TASK_ID },
    })
    expect(
      pi.calls.filter(c => c.method === "createThreadLane").map(c => c.args[1]),
    ).toEqual([LANE, NEW])
  })

  test("each message is appended in its thread; a branch's record is written with its first, then named", async () => {
    const { pi, records, names, deps } = setUp()
    await sendCleared(deps, ALICE, "s-1", {
      ...chat("aside"),
      at: { kind: "branch", thread: NEW, at: E1, task: TASK_ID },
    })
    await sendCleared(deps, ALICE, "s-2", chat("on"))
    const appended = pi.calls
      .filter(c => c.method === "appendToTree")
      .map(c => c.args[2])
    expect(appended).toEqual([NEW, LANE])
    expect(records.calls.map(c => c.args[0])).toEqual([
      [
        setRecord(THREAD, {
          thread: NEW,
          root: ROOT_ID,
          by: ALICE,
          createdAt: 1000,
          origin: { kind: "fork", at: E1, how: "branch" },
        }),
      ],
    ])
    expect(names.calls.map(c => c.method)).toEqual(["ensure"])
  })

  test("a thread's start, its card and a new task's card, is written before its send", async () => {
    const { b, records, deps } = setUp()
    const doing = workflowStateIdFor("d")
    putValue(
      b,
      setRecord(WORKFLOW, {
        open: [{ id: doing, name: "Doing" }],
        archive: { id: workflowStateIdFor("x"), name: "Done" },
      }),
    )
    await sendCleared(deps, ALICE, "s-1", {
      ...chat("a new task"),
      at: { kind: "branch", thread: NEW, at: null, task: NEW_TASK },
    })
    expect(readPlaces(b.places).find(c => c.id === NEW)?.place).toMatchObject({
      kind: "canvas",
      task: NEW_TASK,
      width: 1,
    })
    expect(readPlaces(b.places).find(c => c.id === NEW_TASK)?.place).toEqual({
      kind: "board",
      state: doing,
      order: expect.any(String),
    })
    const written = records.calls.flatMap(c => c.args[0] as ValueWrite[])
    expect(written.map(w => w.namespace)).toEqual([THREAD.namespace])
  })

  test("a branch naming a thread that has started is refused, and nothing is written", async () => {
    const { pi, deps } = setUp()
    const out = await sendCleared(deps, ALICE, "s-1", {
      ...chat("again"),
      at: { kind: "branch", thread: LANE, at: E1, task: TASK_ID },
    })
    expect(out).toMatchObject({ kind: "refused", code: ERR.THREAD_TAKEN })
    expect(pi.calls.filter(c => c.method === "appendToTree")).toEqual([])
  })

  test("a copy's first send is a branch at its fork, appended in the copy's thread", async () => {
    const { b, pi, records, deps } = setUp()
    const COPY = threadIdFor("copy")
    putValue(
      b,
      setRecord(THREAD, {
        thread: COPY,
        root: ROOT_ID,
        by: BEA,
        createdAt: 5,
        origin: { kind: "fork", at: E1, how: "copy" },
      }),
    )
    const before = readPlaces(b.places)
    const sent = await sendCleared(deps, ALICE, "s-1", {
      ...chat("go on"),
      at: { kind: "branch", thread: COPY, at: E1, task: TASK_ID },
    })
    expect(sent.kind).toBe("appended")
    const appended = pi.calls
      .filter(c => c.method === "appendToTree")
      .map(c => c.args[2])
    expect(appended).toEqual([COPY])
    expect(records.calls).toEqual([])
    expect(readPlaces(b.places)).toEqual(before)
    // Anywhere but its fork, its id is another's.
    writeEntry(b.root, threadRow(entryId("e-0"), E1, LANE))
    const elsewhere = await sendCleared(deps, ALICE, "s-2", {
      ...chat("again"),
      at: { kind: "branch", thread: COPY, at: entryId("e-0"), task: TASK_ID },
    })
    expect(elsewhere).toMatchObject({
      kind: "refused",
      code: ERR.THREAD_TAKEN,
    })
  })

  test("a sent message keeps the images its text shows, as references", async () => {
    const { pi, deps } = setUp()
    await sendCleared(deps, ALICE, "s-1", chat(`look ![a](/blob/${SHA})`))
    const appended = pi.calls.find(c => c.method === "appendToTree")
    expect(appended?.args[0]).toMatchObject({
      details: {
        images: [{ sha256: SHA, mimeType: "image/png", width: 2, height: 3 }],
      },
    })
  })

  test("in a thread that works in its own copy, your working copy's paths are stored as the lane sees them", async () => {
    const { started, deps } = setUp({ root: "/proj", kind: "jj", owner: null })
    await sendCleared(deps, ALICE, "s-1", chat("@agent read /proj/a.txt"))
    expect(started[0]?.details.text).toBe(
      "@agent read /mnt/host-working-copy/a.txt",
    )
  })

  describe("a lane with no work of its own is caught up before its run", () => {
    /** A lane at E1 whose base, accepted work, moved to L2 bringing a file, its work `work`. */
    const behindLane = (
      b: ReturnType<typeof basics>,
      work: "none" | "some",
    ) => {
      putLane(b, LANE, E1)
      writeLaneTip(b.root, LANE, E1)
      putValue(
        b,
        setRecord(BASE, {
          kind: "jj",
          lane: LANE,
          base: { kind: "accepted" },
          start: commitId("l1"),
          state: "ok",
          catchUp: { tip: commitId("t"), to: commitId("l2"), files: ["a.ts"] },
          untraced: [],
          work,
        }),
      )
      putValue(
        b,
        setRecord(ACCEPTED, {
          kind: "jj",
          acceptedBookmark: "pinetrie-accepted",
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
          publishCatchesUp: true,
        }),
      )
    }
    const ask = (): Send => chat("@agent go on")

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
      const out = await sendCleared(deps, ALICE, "s-1", ask())
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
      const out = await sendCleared(
        {
          ...deps,
          start: (_lane, s) => {
            if (s.kind === "prompt") prompts.push(s.message)
            return runId("r-2")
          },
        },
        ALICE,
        "s-1",
        ((): Send => {
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
      expect(await sendCleared(deps, ALICE, "s-1", ask())).toEqual({
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
        writer: ALICE,
        base: null,
        pinned: [],
        start: null,
        quotes: [],
      },
    )
    expect(out).toEqual({ kind: "conflict", by: BEA })
  })

  test("a message sent from a card carries its other writers, and spends nothing itself", async () => {
    const { pi, cards, deps } = setUp()
    const out = await sendCleared(deps, ALICE, "s-1", {
      ...chat("from the card"),
      card: {
        id: cardIdFor("c1"),
        seen: "",
      },
    })
    expect(out).toEqual({ kind: "appended", id: "e-2" })
    const appended = pi.calls.find(c => c.method === "appendToTree")
    expect(appended?.args[0]).toMatchObject({
      details: { contributors: [BEA] },
    })
    expect(
      cards.calls
        .filter(c => c.method === "writers")
        .map(c => [c.method, ...c.args]),
    ).toEqual([["writers", cardIdFor("c1")]])
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
    const early = await sendCleared(deps, ALICE, "s-1", {
      ...chat(`look ![a](/blob/${missing})`),
      card: {
        id: cardIdFor("c1"),
        seen: "",
      },
    })
    // Refused as it is written: pi will not append it.
    const late = await sendCleared(
      {
        ...deps,
        scribe: {
          appendToTree: async () => ({ kind: "refused", code: ERR.REFUSED }),
        },
      },
      ALICE,
      "s-2",
      {
        ...chat("from the card"),
        card: {
          id: cardIdFor("c1"),
          seen: "",
        },
      },
    )
    expect([early.kind, late.kind]).toEqual(["refused", "refused"])
  })

  test("a busy lane is answered busy, and nothing is written", async () => {
    const { b, pi, deps } = setUp()
    writeLaneTip(b.root, LANE, E1)
    beginRun(b.live, LANE, runId("r-0"))
    putValue(b, setRecord(PARTICIPANT, { writer: BEA, name: "Bea" }))
    const out = await sendCleared(deps, ALICE, "s-1", {
      ...chat("@bea when it is done"),
      card: {
        id: cardIdFor("c1"),
        seen: "",
      },
    })
    expect(out).toEqual({ kind: "busy" })
    expect(pi.calls).toEqual([])
  })

  test("a message with no card names no one else", async () => {
    const { pi, cards, deps } = setUp()
    await sendCleared(deps, ALICE, "s-1", chat("plain"))
    expect(cards.calls.filter(c => c.method === "writers")).toEqual([])
    const appended = pi.calls.find(c => c.method === "appendToTree")
    expect(
      (appended?.args[0] as { details: ChatDetails }).details.contributors,
    ).toBeUndefined()
  })
})
