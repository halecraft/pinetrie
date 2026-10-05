import { describe, expect, test } from "vitest"
import {
  baseMessage,
  baseOf,
  commitId,
  entryId,
  entryOfMessage,
  hasTrailer,
  isWipLine,
  laneNameForThread,
  offerLedger,
  offerMessage,
  revisionMessage,
  sourcesOf,
  type ThreadName,
  TRAILERS,
  trailerRevset,
  trailerValues,
  untracedLanes,
  wipDescription,
  withLedger,
  withoutTrailers,
  withTrailers,
} from "./index.ts"

const LANE = laneNameForThread("1")
const NAME = "amber-fox" as ThreadName
const C1 = commitId("c1")

test("trailerValues reads a trailer from every paragraph, as a squash leaves two (S77)", () => {
  const squashed = [
    "integrated one",
    "",
    "Pinetrie-Source: aaaa",
    "",
    "integrated two",
    "",
    "Pinetrie-Lane: t-2",
    "Pinetrie-Source: bbbb",
    "",
  ].join("\n")
  expect(trailerValues(squashed, TRAILERS.source)).toEqual(["aaaa", "bbbb"])
  expect(trailerValues(squashed, TRAILERS.base)).toEqual([])
})

test("offerLedger reads the newest paragraph that names a source; none without one (ADR-0060)", () => {
  const one =
    "offer: x\n\nPinetrie-Source: aaaa\nPinetrie-Start: s1\nPinetrie-Start: s2\n"
  expect(offerLedger(one)).toEqual({
    source: commitId("aaaa"),
    start: [commitId("s1"), commitId("s2")],
  })
  const squashed = `${one}\nPinetrie-Source: bbbb\nPinetrie-Start: s3\n`
  expect(offerLedger(squashed)).toEqual({
    source: commitId("bbbb"),
    start: [commitId("s3")],
  })
  expect(offerLedger("offer: yours, rewritten\n")).toBeNull()
  expect(offerLedger("offer: x\n\nPinetrie-Source: aaaa\n")).toBeNull()
})

test("untracedLanes: an integrated offer's paragraph naming a thread and a lane but no source; never a turn's, nor a traced integrated offer's (S97)", () => {
  const old = `feat: x\n\nPinetrie-Thread: amber-fox\nPinetrie-Lane: ${LANE}\nPinetrie-Entry: e\n`
  expect(untracedLanes(old)).toEqual([LANE])
  expect(
    untracedLanes(
      `${old}\nPinetrie-Thread: amber-fox\nPinetrie-Lane: ${LANE}\nPinetrie-Source: aaaa\n`,
    ),
  ).toEqual([LANE])
  expect(
    untracedLanes(
      `feat: x\n\nPinetrie-Thread: amber-fox\nPinetrie-Lane: ${LANE}\nPinetrie-Source: aaaa\n`,
    ),
  ).toEqual([])
  expect(
    untracedLanes(`turn\n\nPinetrie-Lane: ${LANE}\nPinetrie-Entry: e\n`),
  ).toEqual([])
})

test("sourcesOf reads every paragraph of a squash, each source once (S77 item 6)", () => {
  const ledger = (source: string) => ({
    source: commitId(source),
    start: [commitId("s1")],
  })
  const one = offerMessage("first", {
    lane: LANE,
    name: NAME,
    entry: "e1",
    ledger: ledger("aaaa"),
  })
  const two = offerMessage("second", {
    lane: LANE,
    name: NAME,
    entry: "e2",
    ledger: ledger("bbbb"),
  })
  expect(sourcesOf(`${one}\n${two}\n${one}`)).toEqual(["aaaa", "bbbb"])
  expect(sourcesOf("your commit")).toEqual([])
})

describe("what is written reads back", () => {
  test("revisionMessage and entryOfMessage round-trip the entry trailer", () => {
    const message = revisionMessage({
      title: "fix it",
      entry: entryId("e-1"),
      lane: LANE,
    })
    expect(entryOfMessage(message)).toBe("e-1")
    expect(entryOfMessage("your commit")).toBeNull()
  })
  test("baseMessage and baseOf round-trip a Pinetrie-Base, the newest of them; a malformed one reads as none", () => {
    const m = baseMessage("copy of wip/a@b", {
      bookmark: "wip/a@b",
      commit: C1,
    })
    expect(m).toBe("copy of wip/a@b\n\nPinetrie-Base: wip/a@b@c1\n")
    expect(baseOf("x\n\nPinetrie-Base: nope\n")).toBeNull()
    expect(baseOf(m)).toEqual({ bookmark: "wip/a@b", commit: C1 })
    const later = baseMessage("update", { bookmark: "onto", commit: C1 })
    expect(baseOf(`${m}\n${later}`)).toEqual({ bookmark: "onto", commit: C1 })
    expect(baseOf("your commit")).toBeNull()
  })
  test("offerMessage reads back: its thread, lane and entry, its ledger, and the message without them", () => {
    const ledger = { source: commitId("t1"), start: [commitId("s1")] }
    const m = offerMessage("feat: x\n\nwhy", {
      lane: LANE,
      name: NAME,
      entry: "e9",
      ledger,
    })
    expect(m.split("\n\n")).toHaveLength(3)
    expect(trailerValues(m, TRAILERS.thread)).toEqual([NAME])
    expect(trailerValues(m, TRAILERS.lane)).toEqual([LANE])
    expect(trailerValues(m, TRAILERS.entry)).toEqual(["e9"])
    expect(offerLedger(m)).toEqual(ledger)
    expect(hasTrailer(m, "thread", NAME)).toBe(true)
    expect(withoutTrailers(m)).toBe("feat: x\n\nwhy")
  })
  test("withoutTrailers undoes withTrailers, and keeps your own", () => {
    const at = { lane: LANE, name: NAME, entry: "e9" }
    const m = "feat: x\n\nwhy it changed\n"
    expect(withoutTrailers(withTrailers(m, at))).toBe(m.trim())
    const yours = "feat: x\n\nSigned-off-by: Ada <ada@x.io>"
    expect(withoutTrailers(withTrailers(yours, at))).toBe(yours)
    expect(
      withoutTrailers(`feat: x\n\nSigned-off-by: Ada\nPinetrie-Entry: e1`),
    ).toBe("feat: x\n\nSigned-off-by: Ada\nPinetrie-Entry: e1")
    expect(withoutTrailers("Pinetrie-Entry: e1")).toBe("Pinetrie-Entry: e1")
  })
  test("withTrailers and the WIP line", () => {
    expect(
      withTrailers("feat: x\n", { lane: LANE, name: NAME, entry: "e9" }),
    ).toBe(
      `feat: x\n\nPinetrie-Thread: amber-fox\nPinetrie-Lane: ${LANE}\nPinetrie-Entry: e9\n`,
    )
    expect(wipDescription(NAME, "add the offer line\nmore")).toBe(
      "WIP (amber-fox): add the offer line",
    )
    expect(wipDescription(NAME, "")).toBe("WIP (amber-fox): this thread's work")
  })
  test("the WIP line is this thread's; an agent's message is not", () => {
    const name = "t-1" as ThreadName
    expect(isWipLine(name, "WIP (t-1): x")).toBe(true)
    expect(isWipLine(name, "fix: x")).toBe(false)
    expect(isWipLine(name, "WIP (t-2): x")).toBe(false)
  })
})

describe("withLedger (ADR-0060)", () => {
  const ledger = {
    source: commitId("t1"),
    start: [commitId("s1"), commitId("s2")],
  }
  test("joins the host's trailer paragraph, read back from it", () => {
    const m = withLedger(
      withTrailers("feat: x", { lane: LANE, name: NAME, entry: "e" }),
      ledger,
    )
    expect(m.split("\n\n")).toHaveLength(2)
    expect(trailerValues(m, TRAILERS.source)).toEqual(["t1"])
    expect(trailerValues(m, TRAILERS.start)).toEqual(["s1", "s2"])
    expect(withoutTrailers(m)).toBe("feat: x")
  })
  test("a message with no trailers, or ending in yours, gets a paragraph of its own", () => {
    expect(withLedger("WIP (amber-fox): x", ledger).split("\n\n")).toHaveLength(
      2,
    )
    expect(
      withLedger("feat: x\n\nSigned-off-by: Ada", ledger).split("\n\n"),
    ).toHaveLength(3)
  })
})

test("trailerRevset names what hasTrailer matches", () => {
  expect(trailerRevset(["base"])).toBe(
    'description(regex:"(?m)^Pinetrie-Base: ")',
  )
  expect(trailerRevset(["source", "thread"])).toBe(
    'description(regex:"(?m)^(Pinetrie-Source|Pinetrie-Thread): ")',
  )
  expect(trailerRevset(["thread"], NAME)).toBe(
    'description(regex:"(?m)^Pinetrie-Thread: amber-fox$")',
  )
  expect(hasTrailer(`x\n\nPinetrie-Thread: ${NAME}\n`, "thread", NAME)).toBe(
    true,
  )
  expect(hasTrailer(`x\n\nPinetrie-Thread: ${NAME}-2\n`, "thread", NAME)).toBe(
    false,
  )
  expect(hasTrailer(`Pinetrie-Lane: ${NAME}\n`, "thread", NAME)).toBe(false)
})
