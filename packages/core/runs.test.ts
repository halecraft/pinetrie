import { describe, expect, test } from "vitest"
import {
  decodeRunEvent,
  decodeRunNotice,
  encodeRunEvent,
  encodeRunNotice,
  type RunEvent,
  stamp,
} from "./index.ts"

describe("a run's events as lines", () => {
  test("a call, with its escaped path unescaped", () => {
    expect(
      decodeRunEvent("open\t12\t7\t241\t-\t/workspace/a\\tb\\nc\\\\d\t-\t\t"),
    ).toEqual({
      kind: "call",
      op: "open",
      at: 12,
      pid: 7,
      flags: 0x241,
      before: "missing",
      path: "/workspace/a\tb\nc\\d",
      before2: "missing",
      path2: "",
      stamp: null,
      raced: null,
    })
  })

  test("a rename's target, a file's stamp, and a raced release's kernel stamp", () => {
    expect(
      decodeRunEvent("rename\t1\t2\t0\tf\t/w/a\t-\t/w/b\t3:100"),
    ).toMatchObject({ before: "file", path2: "/w/b", stamp: "3:100" })
    expect(
      decodeRunEvent("release\t1\t2\t2\tf\t/w/a\t-\t\t3:100\t3:99"),
    ).toMatchObject({ stamp: "3:100", raced: "3:99" })
  })

  test("every event round-trips its line", () => {
    const events: RunEvent[] = [
      {
        kind: "call",
        op: "link",
        at: 5,
        pid: 9,
        flags: 0o1101,
        before: "file",
        path: "/w/x\ty",
        before2: "missing",
        path2: "/w/z\\",
        stamp: stamp("1:2"),
        raced: stamp("1:1"),
      },
      { kind: "exit", at: 5, status: 137 },
      { kind: "end", at: 6 },
      { kind: "lost", at: 7, count: 12 },
    ]
    for (const e of events) expect(decodeRunEvent(encodeRunEvent(e))).toEqual(e)
    expect(
      decodeRunNotice(
        encodeRunNotice({ run: "r1", event: { kind: "end", at: 1 } }),
      ),
    ).toEqual({ run: "r1", event: { kind: "end", at: 1 } })
  })

  test("a line no observer writes is null", () => {
    expect(decodeRunEvent("stat\t1\t2\t0\tf\t/w/a\t-\t\t")).toBeNull()
    expect(decodeRunEvent("open\t1\t2\t0\tq\t/w/a\t-\t\t")).toBeNull()
    expect(decodeRunEvent("open\t1\t2")).toBeNull()
    expect(decodeRunEvent("open\t1a\t2\t0\tf\t/w/a\t-\t\t")).toBeNull()
    expect(decodeRunEvent("")).toBeNull()
    expect(decodeRunNotice("\tend\t1")).toBeNull()
  })
})
