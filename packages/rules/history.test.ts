import { readdirSync } from "node:fs"
import path from "node:path"
import {
  canvasIdFor,
  commitId,
  entryId,
  type ThreadName,
  textCardId,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { BEHIND } from "./behind.ts"
import { CANVAS, CANVAS_FACT } from "./canvas.ts"
import { CANVAS_PINNED } from "./canvas-pinned.ts"
import { FACT } from "./fact.ts"
import type { HistorySpec } from "./history.ts"
import { LAND } from "./land.ts"
import { renderableMessage } from "./message.ts"
import { PINNED } from "./pinned.ts"
import { ANSWER, HEARD, RELAY } from "./relay.ts"
import { SSH_FACT } from "./ssh-news.ts"
import { STACK } from "./stack.ts"
import { CARRY_ON } from "./stop.ts"
import { UPDATE } from "./update.ts"

/** Every kind of history message: a spec left out fails the first test. */
const MESSAGE_SPECS = [
  UPDATE,
  STACK,
  LAND,
  FACT,
  BEHIND,
  CARRY_ON,
  PINNED,
  CANVAS_PINNED,
  CANVAS,
  CANVAS_FACT,
  SSH_FACT,
  HEARD,
  RELAY,
  ANSWER,
] as const

type CustomType = (typeof MESSAGE_SPECS)[number]["customType"]

const LANE = threadIdFor("1")
const ADA = writerId("ada@x.io")
const C = commitId("c1")

/** One message of each kind, as the code makes it. */
const SAMPLES: Record<CustomType, unknown> = {
  "pinetrie.update": {
    lane: LANE,
    from: {
      kind: "parent",
      lane: threadIdFor("p"),
      name: "amber-fox" as ThreadName,
    },
    merged: C,
    commits: ["feat: one"],
    files: ["a.ts"],
    by: ADA,
  },
  "pinetrie.stack": {
    lane: LANE,
    start: [C],
    tip: C,
    skill: null,
    by: ADA,
  },
  "pinetrie.land": {
    lane: LANE,
    yours: [C],
    files: ["a.ts"],
    skill: { path: "/s", hash: "h" },
    by: ADA,
  },
  "pinetrie.fact": {
    kind: "accepted",
    lane: LANE,
    by: ADA,
    as: "kabcdefg",
    bookmark: "wip/a",
    to: { kind: "wip", bookmark: "wip/a" },
  },
  "pinetrie.behind": {
    from: { kind: "accepted" },
    to: C,
    files: ["a.ts"],
    overlap: [],
    conflicts: [],
  },
  "pinetrie.carry-on": {
    lane: LANE,
    by: ADA,
    name: "Ada",
    reason: { kind: "ssh-approved", host: "hql" },
  },
  "pinetrie.pinned": {
    lane: LANE,
    cards: [{ id: textCardId("k-1"), text: "do it", by: ADA }],
    retired: [{ id: textCardId("k-0"), line: "old" }],
  },
  "pinetrie.canvas-pinned": {
    canvas: canvasIdFor("t"),
    cards: [{ id: textCardId("k-1"), text: "do it", by: ADA }],
    retired: [],
  },
  "pinetrie.canvas": {
    canvas: canvasIdFor("t"),
    title: "Fix the sync bug",
    lines: ["thread amber-fox (this thread), put by Ada"],
    more: 0,
  },
  "pinetrie.canvas-fact": {
    canvas: canvasIdFor("t"),
    by: ADA,
    byName: "Ada",
    title: "Decisions",
    change: "added",
  },
  "pinetrie.ssh-fact": { news: "asked", host: "hql", ownerName: "Ada" },
  "pinetrie.heard": {
    from: LANE,
    fromName: "amber-fox",
    entries: [entryId("e-1"), entryId("e-2")],
  },
  "pinetrie.relay": {
    from: LANE,
    fromName: "amber-fox",
    source: entryId("e-2"),
    asker: { kind: "agent", thread: LANE },
    askerName: "amber-fox",
    text: "what next?",
    budget: entryId("e-1"),
    by: ADA,
  },
  "pinetrie.answer": {
    from: LANE,
    fromName: "slate-owl",
    relay: entryId("r-1"),
    source: entryId("e-2"),
    text: "this next",
    wakes: true,
    budget: entryId("e-1"),
    by: ADA,
  },
}

/** The role each kind renders as (`renderableMessage`). */
const ROLES: Record<CustomType, string> = {
  "pinetrie.update": "update",
  "pinetrie.stack": "stack",
  "pinetrie.land": "land",
  "pinetrie.fact": "fact",
  "pinetrie.behind": "behind",
  "pinetrie.carry-on": "carry-on",
  "pinetrie.pinned": "pinned",
  "pinetrie.canvas-pinned": "canvas-pinned",
  "pinetrie.canvas": "canvas",
  "pinetrie.canvas-fact": "fact",
  "pinetrie.ssh-fact": "fact",
  "pinetrie.heard": "heard",
  "pinetrie.relay": "relay",
  "pinetrie.answer": "answer",
}

const isSpec = (v: unknown): v is HistorySpec<string, unknown> =>
  typeof v === "object" &&
  v !== null &&
  "customType" in v &&
  "encode" in v &&
  "decode" in v

describe("history messages (history.ts)", () => {
  test("MESSAGE_SPECS holds every history spec this package's modules export, one per type", async () => {
    const dir = import.meta.dirname
    const modules = readdirSync(dir).filter(
      f => f.endsWith(".ts") && !f.endsWith(".test.ts"),
    )
    const exported: unknown[] = []
    for (const file of modules)
      exported.push(
        ...Object.values(
          (await import(path.join(dir, file))) as Record<string, unknown>,
        ).filter(isSpec),
      )
    expect(new Set(MESSAGE_SPECS)).toEqual(new Set(exported))
    const types = MESSAGE_SPECS.map(s => s.customType)
    expect(new Set(types).size).toBe(types.length)
  })

  test.each(MESSAGE_SPECS.map(spec => [spec.customType, spec] as const))(
    "%s: stored as the code's value, decoded by its schema, rendered in its role",
    (type, spec) => {
      const sample = SAMPLES[type]
      const message = (spec as HistorySpec<string, unknown>).encode(
        sample,
        "what the model reads",
        5,
      )
      expect(message.details).toEqual(sample)
      expect(spec.decode(structuredClone(message))).toEqual(sample)
      expect(renderableMessage(message).role).toBe(ROLES[type])
      // Another kind's message, or one whose lane is no lane, is not this one.
      expect(spec.decode({ ...message, customType: "pinetrie.other" })).toBe(
        undefined,
      )
    },
  )

  test("a lane that is no lane does not decode: the schema checks it as isThreadId does", () => {
    const message = CARRY_ON.encode(
      SAMPLES["pinetrie.carry-on"] as never,
      "",
      1,
    )
    expect(
      CARRY_ON.decode({
        ...message,
        details: { ...message.details, lane: "main" },
      }),
    ).toBeUndefined()
    expect(
      CARRY_ON.decode({
        ...message,
        details: { ...message.details, lane: "t-" },
      }),
    ).toBeUndefined()
  })
})
