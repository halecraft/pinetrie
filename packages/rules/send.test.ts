import {
  canvasIdFor,
  ERR,
  entryId,
  indexTree,
  rootIdFor,
  type Send,
  type Sha256,
  TEXT_MIME,
  type ThreadRecord,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import {
  fromParents,
  personMessage,
  threadOfEntry,
} from "@pinetrie/core/fixtures"
import { describe, expect, test } from "vitest"
import type { CommandSummary } from "./commands.ts"
import {
  planSendMessage,
  planSendReach,
  planSendRoot,
  type SendReach,
  type SharedBlob,
} from "./send.ts"

const ADA = writerId("ada@x.io")
const BEA = writerId("bea@x.io")
const ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")
const NEW_ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000b")
const CANVAS = canvasIdFor("01a0ffd2-0000-7000-8000-00000000000c")
const NEW = threadIdFor("01a0ffd2-0000-7000-8000-00000000000d")
const index = indexTree(fromParents({ r: null, a: "r" }, personMessage))
const THREAD = threadOfEntry("r")
const sha = (c: string) => c.repeat(64) as Sha256

const send = (over: Partial<Send> = {}): Send => ({
  kind: "send",
  text: "hello",
  root: ROOT,
  at: { kind: "end", thread: THREAD, seen: entryId("a") },
  mentions: [],
  card: null,
  pinned: [],
  base: null,
  state: null,
  ...over,
})
const branch = (at: string | null, thread = NEW) =>
  ({
    kind: "branch",
    thread,
    at: at === null ? null : entryId(at),
    canvas: CANVAS,
  }) as const
const record = (thread: typeof NEW, over: Partial<ThreadRecord> = {}) => ({
  thread,
  root: ROOT,
  by: ADA,
  createdAt: 1,
  origin: { kind: "root" } as const,
  ...over,
})

describe("planSendRoot", () => {
  const root = (
    s: Send,
    over: Partial<Parameters<typeof planSendRoot>[0]> = {},
  ) =>
    planSendRoot({
      send: s,
      threads: new Map(),
      roots: new Set([ROOT]),
      held: new Set([CANVAS]),
      ...over,
    })

  test("a thread at the root needs a new root, and a canvas no other root holds", () => {
    expect(root(send({ at: branch(null) }))).toEqual({
      kind: "declined",
      why: "root-in-use",
    })
    expect(root(send({ root: NEW_ROOT, at: branch(null) }))).toEqual({
      kind: "declined",
      why: "canvas-in-use",
    })
    expect(
      root(send({ root: NEW_ROOT, at: branch(null) }), {
        threads: new Map([[NEW, record(NEW, { root: NEW_ROOT })]]),
      }),
    ).toEqual({ kind: "open" })
  })

  test("a branch elsewhere goes in a canvas the session holds", () => {
    expect(root(send({ at: branch("a") }), { held: new Set() })).toEqual({
      kind: "declined",
      why: "no-canvas",
    })
    expect(root(send())).toEqual({ kind: "open" })
  })
})

const COMMANDS: readonly CommandSummary[] = [
  { name: "me:plan", kind: "skill", description: "", argumentHint: null },
]
const reachOf = (
  s: Send,
  over: Partial<Parameters<typeof planSendReach>[0]> = {},
) =>
  planSendReach({
    send: s,
    writer: ADA,
    index,
    lanes: [],
    threads: new Map(),
    commands: COMMANDS,
    ...over,
  })

describe("planSendReach", () => {
  test("a thread started already, or an entry its root lacks, is refused", () => {
    expect(reachOf(send({ at: branch("a", THREAD) }))).toEqual({
      kind: "declined",
      why: "taken",
    })
    expect(reachOf(send({ at: branch("gone") }))).toEqual({
      kind: "declined",
      why: "unknown",
    })
  })

  test("a recorded thread's first send is a branch where its record begins", () => {
    const threads = new Map([
      [
        NEW,
        record(NEW, {
          origin: { kind: "fork", at: entryId("r"), how: "branch" },
        }),
      ],
    ])
    expect(reachOf(send({ at: branch("a") }), { threads })).toEqual({
      kind: "declined",
      why: "taken",
    })
    expect(reachOf(send({ at: branch("r") }), { threads })).toMatchObject({
      kind: "reach",
    })
  })

  test("its first word names a command pi loaded, one it did not, or none", () => {
    expect(reachOf(send({ text: "/me:plan the week" }))).toMatchObject({
      command: { kind: "expand", source: COMMANDS[0], args: "the week" },
    })
    expect(reachOf(send({ text: "/me:nope" }))).toMatchObject({
      command: { kind: "unknown", name: "me:nope" },
    })
    expect(reachOf(send())).toMatchObject({ command: { kind: "none" } })
  })
})

describe("planSendMessage", () => {
  const reached = (s: Send) => {
    const r = reachOf(s)
    if (r.kind !== "reach") throw new Error("reached")
    return r
  }
  const plan = (
    reach: SendReach,
    s: Send,
    over: Partial<Parameters<typeof planSendMessage>[0]> = {},
  ) =>
    planSendMessage({
      reach,
      send: s,
      writer: ADA,
      sendId: "s-1",
      upToDate: false,
      expanded: null,
      blobs: new Map(),
      quoteBytes: 1000,
      own: false,
      projectRoot: null,
      bases: new Map(),
      accepted: null,
      proposed: new Map(),
      names: new Map(),
      participants: [],
      reachable: [],
      writers: [],
      index,
      cards: [],
      held: new Set([CANVAS]),
      workflow: null,
      now: 7,
      ...over,
    })

  test("a share the store no longer holds refuses the send", () => {
    const s = send({ text: `[notes.txt](/blob/${sha("b")})` })
    expect(plan(reached(s), s)).toMatchObject({
      kind: "send",
      decision: { kind: "refused" },
    })
  })

  test("a text file shared is quoted to the model, and its words place no one", () => {
    const s = send({ text: `[notes.txt](/blob/${sha("b")})` })
    const bytes = new TextEncoder().encode("II*\u0000 the notes")
    const blob: SharedBlob = {
      ref: { sha256: sha("b"), mimeType: TEXT_MIME, width: null, height: null },
      size: bytes.length,
      fitted: undefined,
      bytes,
    }
    const planned = plan(reached(s), s, { blobs: new Map([[sha("b"), blob]]) })
    if (planned.kind !== "send") throw new Error("sent")
    expect(planned.quotes).toMatchObject([
      { kind: "share", label: "notes.txt" },
    ])
    expect(planned.quotes[0]?.markdown).toContain("the notes")
  })

  test("a sent message keeps the files its text shares", () => {
    const s = send({ text: `[notes.txt](/blob/${sha("b")})` })
    const bytes = new TextEncoder().encode("the notes")
    const blob: SharedBlob = {
      ref: { sha256: sha("b"), mimeType: TEXT_MIME, width: null, height: null },
      size: bytes.length,
      fitted: undefined,
      bytes,
    }
    expect(
      plan(reached(s), s, { blobs: new Map([[sha("b"), blob]]) }),
    ).toMatchObject({
      kind: "send",
      decision: { details: { shared: [{ name: "notes.txt" }] } },
    })
  })

  test("in a thread with its own copy, your working copy's paths are stored as the lane sees them", () => {
    const s = send({ text: "see /work/a.ts" })
    const at = (own: boolean) =>
      plan(reached(s), s, { own, projectRoot: "/work" })
    expect(at(true)).toMatchObject({
      decision: { details: { text: "see /mnt/host-working-copy/a.ts" } },
    })
    expect(at(false)).toMatchObject({
      decision: { details: { text: "see /work/a.ts" } },
    })
  })

  test("a command whose file could not be read is refused", () => {
    const s = send({ text: "/me:plan the week" })
    expect(plan(reached(s), s, { expanded: null })).toMatchObject({
      kind: "send",
      decision: { kind: "refused", code: ERR.UNKNOWN_COMMAND },
    })
  })

  test("a message's contributors are its card's other writers", () => {
    const s = send()
    const planned = plan(reached(s), s, { writers: [ADA, BEA] })
    expect(planned).toMatchObject({
      kind: "send",
      decision: { details: { contributors: [BEA] } },
    })
  })

  test("a branch to a thread not yet opened opens it with its first message; a recorded one does not", () => {
    const s = send({ at: branch("a") })
    const opened = plan(reached(s), s)
    expect(opened).toMatchObject({ kind: "send", opening: { kind: "open" } })
    const threads = new Map([
      [
        NEW,
        record(NEW, {
          origin: { kind: "fork", at: entryId("a"), how: "branch" },
        }),
      ],
    ])
    const recorded = reachOf(s, { threads })
    if (recorded.kind !== "reach") throw new Error("reached")
    expect(plan(recorded, s)).toMatchObject({ kind: "send", opening: null })
  })
})
