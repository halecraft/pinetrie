import {
  type BlobRef,
  canvasIdFor,
  commitId,
  ERR,
  type ErrCode,
  entryId,
  type ImageRef,
  pointId,
  ROOT,
  runId,
  type Sha256,
  threadIdFor,
  type ValueWrite,
  type WriterId,
  workflowStateIdFor,
  writerId,
} from "@pinetrie/core"
import type { ThreadLaneHandle } from "@pinetrie/pi"
import { readPlaces } from "@pinetrie/reads"
import {
  ACCEPTED,
  BASE,
  encodeUpdate,
  MESSAGE_TYPE,
  type MessageDetails,
  PARTICIPANT,
  type PersonMessage,
  PROJECT,
  type ProjectRecord,
  planThreadOpen,
  removalsText,
  setRecord,
  THREAD,
  WORKFLOW,
} from "@pinetrie/rules"
import { beginRun, writeEntry, writeLaneTip } from "@pinetrie/schema/fixtures"
import {
  NOBODY,
  parseMentions,
  ROOT_ORIGIN,
  type Send,
  type SentCard,
} from "@pinetrie/threads"
import { cardIdFor } from "@pinetrie/threads/fixtures"
import { describe, expect, test } from "vitest"
import {
  basics,
  CANVAS_ID,
  clearedSend,
  methods,
  NO_BLANK_CARDS,
  placesFor,
  putCanvas,
  putLane,
  putValue,
  ROOT_ID,
  RUNS_ANY,
  record,
  row,
  threadRow,
  writeDirectory,
} from "../fakes.ts"
import type { PlacesChange } from "../provenance.ts"
import { executeSend, type SendDeps, sendMessage, spendsCard } from "./send.ts"

/** A new canvas: in no store yet. */
const NEW_CANVAS = canvasIdFor("01a0ffd2-0000-7000-8000-0000000000bb")

const ALICE = writerId("alice@example.com")
const LANE = threadIdFor("0123456789abcdef")
const NEW = threadIdFor("01a0f9eb-86e1-77ad-a822-2a306786223f")
const details: MessageDetails = {
  author: ALICE,
  authorName: "Alice",
  text: "@agent go",
  compels: NOBODY,
  sendId: "s-1",
}

/** The agent, the scribe and the setup in one record, so the order of their calls shows. */
type FakePi = SendDeps["agent"] & SendDeps["scribe"] & SendDeps["piSetup"]

function setUp(begin: ErrCode | null = null) {
  const b = basics()
  const { placesWriter, provenance } = placesFor(b)
  const pi = record<FakePi>({
    createThreadLane: async () => ({ kind: "created", lane: LANE }),
  })
  const work = record<SendDeps["work"]>({
    ...RUNS_ANY,
    project: null,
    checkBegin: async () => begin,
    prepareLane: async () => {},
  })
  const started: string[] = []
  const seen: (readonly SentCard[])[] = []
  const titles = record<SendDeps["titles"]>({ laneStarted: async () => {} })
  const deps: SendDeps = {
    relays: { relayMessage: async () => {} },
    names: record<SendDeps["names"]>({ ensure: async () => {} }).port,
    basics: b,
    placesWriter,
    agent: pi.port,
    scribe: pi.port,
    piSetup: pi.port,
    work: work.port,
    blobs: record<SendDeps["blobs"]>().port,
    quoteBytes: 32 * 1024,
    cards: record<SendDeps["cards"]>({
      blankQueued: NO_BLANK_CARDS.blankQueued,
    }).port,
    start: (_roots, lane, start) => {
      started.push(lane)
      if (start.kind === "prompt") seen.push(start.pinnedSeen)
      return runId("r-1")
    },
    titles: titles.port,
    records: record<SendDeps["records"]>({ writeValues: async () => {} }).port,
  }
  const context = {
    view: { root: ROOT_ID, doc: b.root, session: b.session, live: b.live },
    writer: ALICE,
    base: null,
    pinned: [],
    start: null,
    quotes: [],
  }
  return { b, pi, work, started, seen, titles, deps, context, provenance }
}

describe("executeSend", () => {
  test("create-and-run creates the lane, prepares it, may title its root, and runs there", async () => {
    const { pi, work, started, titles, deps, context } = setUp()
    const out = await executeSend(
      deps,
      { kind: "create-and-run", at: ROOT, thread: LANE, details, starts: null },
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
    // Each after the step's documents, its first argument.
    expect(titles.calls.map(c => c.args.slice(1))).toEqual([
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
    await executeSend(
      deps,
      { kind: "run", thread: LANE, details },
      {
        ...context,
        pinned,
      },
    )
    await executeSend(
      deps,
      { kind: "create-and-run", at: ROOT, thread: LANE, details, starts: null },
      { ...context, pinned },
    )
    expect(seen).toEqual([pinned, pinned])
  })

  test("a thread its first send opens is its sender's change to the places", async () => {
    const { b, deps, context, provenance } = setUp()
    const heard: PlacesChange[] = []
    provenance.onChanged(change => heard.push(change))
    const opened = planThreadOpen({
      thread: LANE,
      origin: ROOT_ORIGIN,
      root: ROOT_ID,
      by: ALICE,
      now: 0,
      placement: { kind: "after", canvas: CANVAS_ID, parent: null },
      opens: null,
      cards: readPlaces(b.places),
    })
    if (opened.kind !== "open") throw new Error("the thread opens")
    await executeSend(
      deps,
      { kind: "run", thread: LANE, details },
      { ...context, start: opened },
    )
    expect(heard.map(h => [h.cause, h.after.map(c => c.id)])).toEqual([
      [{ kind: "move", by: ALICE }, [LANE]],
    ])
  })

  test("create-and-run from a base that cannot begin refuses, and never creates the lane", async () => {
    const { pi, started, deps, context } = setUp(ERR.BAD_BASE)
    const out = await executeSend(
      deps,
      { kind: "create-and-run", at: ROOT, thread: LANE, details, starts: null },
      { ...context, base: "wip/gone" },
    )
    expect(out).toMatchObject({ kind: "refused", code: ERR.BAD_BASE })
    expect(pi.calls).toEqual([])
    expect(started).toEqual([])
  })

  test("busy writes nothing and answers busy: the sender's client queues its card", async () => {
    const { pi, work, started, deps, context } = setUp()
    const out = await executeSend(deps, { kind: "busy" }, context)
    expect(out).toEqual({ kind: "busy" })
    expect([pi.calls, work.calls, started]).toEqual([[], [], []])
  })
})

/** `sendMessage` of `chat`, cleared through the gate first, as every send is. */
const sendCleared = (
  deps: SendDeps,
  writer: WriterId,
  sendId: string,
  said: Send,
) => sendMessage(deps, writer, sendId, clearedSend(said))

describe("sendMessage", () => {
  const E1 = entryId("e-1")
  const BEA = writerId("bea@example.com")
  const SHA = "a".repeat(64) as Sha256
  const BIG = "c".repeat(64) as Sha256
  const FITTED = "d".repeat(64) as Sha256
  const NOTES = "e".repeat(64) as Sha256
  const LOG = "f".repeat(64) as Sha256
  const ZIP = "9".repeat(64) as Sha256
  const image = (sha: Sha256, width: number, height: number): ImageRef => ({
    sha256: sha,
    mimeType: "image/png",
    width,
    height,
  })
  const unsized = (
    sha: Sha256,
    mimeType: "text/markdown" | "application/octet-stream",
  ) => ({ sha256: sha, mimeType, width: null, height: null }) as const
  const STORED = new Map<
    Sha256,
    { ref: BlobRef; bytes: Uint8Array; fitted?: ImageRef }
  >([
    [SHA, { ref: image(SHA, 2, 3), bytes: new Uint8Array([1]) }],
    [
      BIG,
      {
        ref: image(BIG, 4000, 2000),
        bytes: new Uint8Array([2]),
        fitted: image(FITTED, 2000, 1000),
      },
    ],
    [
      NOTES,
      {
        ref: unsized(NOTES, "text/markdown"),
        bytes: new TextEncoder().encode("a `note`"),
      },
    ],
    [
      LOG,
      {
        ref: unsized(LOG, "text/markdown"),
        bytes: new TextEncoder().encode("line one\nline two\nline three"),
      },
    ],
    [
      ZIP,
      {
        ref: unsized(ZIP, "application/octet-stream"),
        bytes: new Uint8Array([0x50, 0x4b, 3, 4]),
      },
    ],
  ])
  // E1 starts thread LANE: a lane by that name is the thread's.
  const said = (text: string): Send => ({
    kind: "send",
    text,
    root: ROOT_ID,
    at: { kind: "end", thread: LANE, seen: E1 },
    mentions: parseMentions(text),
    card: null,
    pinned: [],
    base: null,
    state: null,
  })
  function setUp(
    project: ProjectRecord | null = null,
    prepareUpdate: SendDeps["work"]["prepareUpdate"] = async () => {
      throw new Error("no update here")
    },
  ) {
    const b = basics()
    writeEntry(b.root, threadRow(E1, null, LANE))
    // The thread's canvas, which a branch from it is put in.
    putCanvas(b, LANE)
    if (project !== null) putValue(b, setRecord(PROJECT, project))
    const cards = record<SendDeps["cards"]>({
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
    const started: PersonMessage[] = []
    const seen: (readonly SentCard[])[] = []
    const records = record<SendDeps["records"]>({ writeValues: async () => {} })
    const names = record<SendDeps["names"]>({ ensure: async () => {} })
    const deps: SendDeps = {
      relays: { relayMessage: async () => {} },
      basics: b,
      placesWriter: placesFor(b).placesWriter,
      agent: pi.port,
      scribe: pi.port,
      piSetup: pi.port,
      work: record<SendDeps["work"]>({
        ...RUNS_ANY,
        project,
        checkBegin: async () => null,
        prepareLane: async () => {},
        prepareUpdate,
      }).port,
      blobs: {
        ref: sha => STORED.get(sha)?.ref,
        size: sha => STORED.get(sha)?.bytes.byteLength,
        get: sha => {
          const held = STORED.get(sha)
          return held === undefined
            ? undefined
            : { bytes: held.bytes, mimeType: held.ref.mimeType }
        },
        fitted: sha => STORED.get(sha)?.fitted,
      },
      quoteBytes: 16,
      cards: cards.port,
      start: (_roots, _lane, s) => {
        if (s.kind === "prompt" && s.message.customType === MESSAGE_TYPE) {
          started.push(s.message as PersonMessage)
          seen.push(s.pinnedSeen)
        }
        return runId("r-1")
      },
      titles: record<SendDeps["titles"]>({ laneStarted: async () => {} }).port,
      records: records.port,
      names: names.port,
    }
    return { b, pi, cards, started, seen, deps, records, names }
  }

  test("a thread at the root under a root id in use is refused, and nothing is written", async () => {
    const { b, pi, started, deps } = setUp()
    writeDirectory(b)
    const out = await sendCleared(deps, ALICE, "s-1", {
      ...said("@agent do it"),
      at: { kind: "branch", thread: NEW, at: null, canvas: NEW_CANVAS },
    })
    expect(out).toMatchObject({ kind: "refused", code: ERR.ROOT_ID_IN_USE })
    expect([pi.calls, started]).toEqual([[], []])
  })

  test("a new canvas's first send, its thread and canvas opened as it opened, writes its entry alone", async () => {
    const { b, pi, records, deps } = setUp()
    putCanvas(b, NEW, NEW_CANVAS)
    const first = {
      ...said("@agent do it"),
      at: { kind: "branch", thread: NEW, at: null, canvas: NEW_CANVAS },
    } as const
    expect(await sendCleared(deps, ALICE, "s-1", first)).toEqual({
      kind: "started",
      runId: "r-1",
    })
    expect(
      pi.calls.filter(c => c.method === "createThreadLane").map(c => c.args[1]),
    ).toEqual([NEW])
    expect(records.calls).toEqual([])
    // Another thread at the root, in that canvas: its id is in use.
    const other = threadIdFor("01a0f9eb-86e1-77ad-a822-2a3067862240")
    expect(
      await sendCleared(deps, ALICE, "s-2", {
        ...first,
        at: { ...first.at, thread: other },
      }),
    ).toMatchObject({ kind: "refused", code: ERR.CANVAS_ID_IN_USE })
  })

  test("@agent in a thread with no lane starts a run", async () => {
    const { started, deps } = setUp()
    const out = await sendCleared(deps, ALICE, "s-1", said("@agent do it"))
    expect(out).toEqual({ kind: "started", runId: "r-1" })
    expect(started).toHaveLength(1)
  })

  test("the chat command's pinned versions reach its run", async () => {
    const { seen, deps } = setUp()
    const pinned = [{ id: cardIdFor("c1"), seen: "v-1" }]
    await sendCleared(deps, ALICE, "s-1", { ...said("@agent do it"), pinned })
    expect(seen).toEqual([pinned])
  })

  test("a new lane is named by its thread's id", async () => {
    const { pi, deps } = setUp()
    await sendCleared(deps, ALICE, "s-1", said("@agent do it"))
    await sendCleared(deps, ALICE, "s-2", {
      ...said("@agent do it"),
      at: { kind: "branch", thread: NEW, at: E1, canvas: CANVAS_ID },
    })
    expect(
      pi.calls.filter(c => c.method === "createThreadLane").map(c => c.args[1]),
    ).toEqual([LANE, NEW])
  })

  test("each message is appended in its thread; a branch's record is written with its first, then named", async () => {
    const { pi, records, names, deps } = setUp()
    await sendCleared(deps, ALICE, "s-1", {
      ...said("aside"),
      at: { kind: "branch", thread: NEW, at: E1, canvas: CANVAS_ID },
    })
    await sendCleared(deps, ALICE, "s-2", said("on"))
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

  test("a thread's start, its card and a new canvas's card, is written before its send", async () => {
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
      ...said("a new canvas"),
      at: { kind: "branch", thread: NEW, at: null, canvas: NEW_CANVAS },
    })
    expect(readPlaces(b.places).find(c => c.id === NEW)?.place).toMatchObject({
      kind: "canvas",
      canvas: NEW_CANVAS,
      width: 1,
    })
    expect(readPlaces(b.places).find(c => c.id === NEW_CANVAS)?.place).toEqual({
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
      ...said("again"),
      at: { kind: "branch", thread: LANE, at: E1, canvas: CANVAS_ID },
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
      ...said("go on"),
      at: { kind: "branch", thread: COPY, at: E1, canvas: CANVAS_ID },
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
      ...said("again"),
      at: {
        kind: "branch",
        thread: COPY,
        at: entryId("e-0"),
        canvas: CANVAS_ID,
      },
    })
    expect(elsewhere).toMatchObject({
      kind: "refused",
      code: ERR.THREAD_TAKEN,
    })
  })

  test("a sent message keeps the files its text shares, and each image the model reads", async () => {
    const { pi, deps } = setUp()
    await sendCleared(
      deps,
      ALICE,
      "s-1",
      said(
        `look ![a](/blob/${SHA}) ![big](/blob/${BIG}) [z.zip](/blob/${ZIP})`,
      ),
    )
    const appended = pi.calls.find(c => c.method === "appendToTree")
    expect(appended?.args[0]).toMatchObject({
      details: {
        images: [image(SHA, 2, 3), image(FITTED, 2000, 1000)],
        shared: [
          {
            name: "a",
            original: image(SHA, 2, 3),
            size: 1,
            shown: image(SHA, 2, 3),
          },
          {
            name: "big",
            original: image(BIG, 4000, 2000),
            shown: image(FITTED, 2000, 1000),
          },
          {
            name: "z.zip",
            original: unsized(ZIP, "application/octet-stream"),
            size: 4,
            shown: null,
            hasLocation: false,
          },
        ],
      },
    })
  })

  test("the model reads a small text share quoted, and a larger one or an opaque one described", async () => {
    const { pi, deps } = setUp()
    await sendCleared(
      deps,
      ALICE,
      "s-1",
      said(
        `see [n.md](/blob/${NOTES}) [l.log](/blob/${LOG}) [z.zip](/blob/${ZIP})`,
      ),
    )
    const appended = pi.calls.find(c => c.method === "appendToTree")
    const content = (appended?.args[0] as { content: string } | undefined)
      ?.content
    expect(content).toContain("Shared: n.md\n> ```\n> a `note`\n> ```")
    expect(content).toContain(
      "Shared: l.log\n> text of 28 bytes, 3 lines, not quoted",
    )
    expect(content).toContain(`Shared: z.zip\n> a file of 4 bytes`)
    expect(content).toContain(`/blob/${ZIP}`)
  })

  test("in a thread that works in its own copy, your working copy's paths are stored as the lane sees them", async () => {
    const { started, deps } = setUp({ root: "/proj", kind: "jj", owner: null })
    await sendCleared(deps, ALICE, "s-1", said("@agent read /proj/a.txt"))
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
          getLatest: {
            tip: commitId("t"),
            to: commitId("l2"),
            files: ["a.ts"],
          },
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
          unfinishedWork: [],
          workingCopy: {
            behind: 0,
            ahead: 0,
            getLatest: null,
            conflicts: { commits: 0, files: [] },
          },
          publishCatchesUp: true,
        }),
      )
    }
    const ask = (): Send => said("@agent go on")

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
            row(
              entryId("u-1"),
              E1,
              encodeUpdate(
                {
                  lane: LANE,
                  from: { kind: "accepted" },
                  merged: pointId("u"),
                  commits: [],
                  files: [],
                  by: ALICE,
                },
                1,
                removalsText([]),
              ),
            ),
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
        [LANE, ALICE, "@agent go on", "get-latest", "run"],
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
          start: (_roots, _lane, s) => {
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
    const out = await executeSend(
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
      ...said("from the card"),
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
      ...said(`look ![a](/blob/${missing})`),
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
        ...said("from the card"),
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
      ...said("@bea when it is done"),
      card: {
        id: cardIdFor("c1"),
        seen: "",
      },
    })
    expect(out).toEqual({ kind: "busy" })
    // The commands pi loaded are read; nothing is written.
    expect(pi.calls.filter(c => c.method !== "commands")).toEqual([])
  })

  test("a plain chat whose append pi refuses busy is busy, so its card is queued", async () => {
    const { b, deps } = setUp()
    writeLaneTip(b.root, LANE, E1)
    putValue(b, setRecord(PARTICIPANT, { writer: BEA, name: "Bea" }))
    const lane = record<ThreadLaneHandle>({
      name: LANE,
      append: async () => ({ kind: "refused", code: ERR.BUSY }),
    })
    const out = await sendCleared(
      { ...deps, agent: { ...deps.agent, lane: () => lane.port } },
      ALICE,
      "s-1",
      { ...said("@bea a note"), card: { id: cardIdFor("c1"), seen: "" } },
    )
    expect(methods(lane.calls)).toEqual(["append"])
    expect(out).toEqual({ kind: "busy" })
  })

  test("a message with no card names no one else", async () => {
    const { pi, cards, deps } = setUp()
    await sendCleared(deps, ALICE, "s-1", said("plain"))
    expect(cards.calls.filter(c => c.method === "writers")).toEqual([])
    const appended = pi.calls.find(c => c.method === "appendToTree")
    expect(appended).toBeDefined()
    expect(
      (appended?.args[0] as { details: MessageDetails } | undefined)?.details
        .contributors,
    ).toBeUndefined()
  })
})
