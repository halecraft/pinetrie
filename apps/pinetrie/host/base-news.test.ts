import { commitId, entryId, laneNameForThread, runId } from "@pinetrie/core"
import type { ThreadLaneHandle } from "@pinetrie/pi"
import { BASE, LINE, setRecord } from "@pinetrie/rules"
import { beginRun, endRun, writeEntry, writeLaneTip } from "@pinetrie/schema"
import { describe, expect, test } from "vitest"
import { createBaseNews } from "./base-news.ts"
import { basics, putLane, putValue, record, row } from "./fakes.ts"

const LANE = laneNameForThread("0123456789abcdef")

/** A lane with work of its own whose base, the line, moved to `to`. */
function behind(to = "l2") {
  const b = basics()
  putLane(b, LANE, entryId("p-1"))
  writeEntry(b.root, row("p-1", null, { role: "chat", content: "go" }))
  writeLaneTip(b.root, LANE, entryId("p-1"))
  putValue(
    b,
    setRecord(BASE, {
      lane: LANE,
      base: { kind: "line" },
      start: commitId("l1"),
      state: "ok",
      catchUp: { tip: commitId("t"), to: commitId(to), files: ["a.ts"] },
      untraced: [],
      work: "some",
    }),
  )
  putValue(
    b,
    setRecord(LINE, {
      onto: "pinetrie-onto",
      wipPrefix: "wip/",
      publish: "main",
      published: { commit: null, behind: 0, ahead: 0 },
      commit: commitId(to),
      heads: { current: null, proposed: "x" },
      log: { current: null, proposed: "x" },
      wips: [],
      yours: {
        behind: 0,
        ahead: 0,
        catchUp: null,
        conflicts: { commits: 0, files: [] },
      },
      commands: true,
    }),
  )
  const steered: unknown[] = []
  const handle = record<ThreadLaneHandle>({
    steer: async message => {
      steered.push(message.details.to)
      return { kind: "ok" }
    },
  }).port
  // One step at a time, as the documents' keeper runs them.
  let tail: Promise<unknown> = Promise.resolve()
  const news = createBaseNews({
    basics: b,
    agent: { lane: () => handle },
    keeper: {
      run: f => {
        const next = tail.then(f)
        tail = next.catch(() => {})
        return next
      },
    },
  })
  return { b, news, steered }
}

const settle = () => new Promise(r => setTimeout(r, 0))

describe("a thread's base news (ADR-0080)", () => {
  test("a chat's run is told at its start", async () => {
    const { news } = behind()
    expect((await news.atStart(LANE))?.details).toMatchObject({
      to: "l2",
      files: ["a.ts"],
    })
  })

  test("a running lane is steered once per base commit; an idle one is told at its next start instead", async () => {
    const { b, news, steered } = behind()
    news.baseChanged(LANE)
    await settle()
    expect(steered).toEqual([])
    beginRun(b.live, LANE, runId("r-1"))
    news.baseChanged(LANE)
    news.baseChanged(LANE)
    await settle()
    expect(steered).toEqual(["l2"])
  })

  test("a run's end forgets what was steered: the next run plans from the tree", async () => {
    const { b, news, steered } = behind()
    beginRun(b.live, LANE, runId("r-1"))
    news.baseChanged(LANE)
    await settle()
    endRun(b.live, LANE, runId("r-1"))
    news.runEnded(LANE)
    expect(await news.atStart(LANE)).not.toBeNull()
    expect(steered).toEqual(["l2"])
  })
})
