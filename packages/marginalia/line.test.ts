import { commitId, ERR, type LineRecord } from "@pineta/core"
import { describe, expect, test } from "vitest"
import { planLineAction, planLineRecord } from "./index.ts"

describe("the line (ADR-0060)", () => {
  const facts = {
    commit: null,
    heads: "trunk()",
    log: null,
    wips: [],
    yours: {
      behind: 0,
      ahead: null,
      follow: null,
      conflicts: { commits: 0, files: [] },
    },
  } as const
  const proposed = { heads: "trunk() | present(pineta-onto)", log: "logged" }
  const record = (over: Partial<LineRecord> = {}): LineRecord => ({
    ...planLineRecord({
      facts,
      line: { onto: "pineta-onto", wipPrefix: "wip/" },
      proposed,
      commands: true,
    }),
    ...over,
  })
  test("planLineRecord shows your config beside what setting up would write", () => {
    expect(record().heads).toEqual({
      current: "trunk()",
      proposed: proposed.heads,
    })
    expect(record().log).toEqual({ current: null, proposed: "logged" })
    expect([record().onto, record().wipPrefix, record().commands]).toEqual([
      "pineta-onto",
      "wip/",
      true,
    ])
  })
  test("setup writes the bookmark at your @- and exactly the proposed heads and log", () => {
    expect(planLineAction("setup", record())).toEqual({
      kind: "setup",
      onto: "pineta-onto",
      heads: proposed.heads,
      log: "logged",
    })
  })
  test("a host that admits others refuses both; a set line refuses setup", () => {
    expect(planLineAction("setup", record({ commands: false }))).toEqual({
      kind: "refused",
      code: ERR.NOT_YOURS,
    })
    expect(planLineAction("land", record({ commands: false }))).toEqual({
      kind: "refused",
      code: ERR.NOT_YOURS,
    })
    expect(
      planLineAction("setup", record({ commit: commitId("c1") })).kind,
    ).toBe("refused")
  })
  test("land: only with a line, and your work above it", () => {
    expect(planLineAction("land", record())).toEqual({
      kind: "refused",
      code: ERR.NO_LINE,
    })
    const set = (ahead: number | null) =>
      record({
        commit: commitId("c1"),
        yours: {
          behind: 0,
          ahead,
          follow: null,
          conflicts: { commits: 0, files: [] },
        },
      })
    expect(planLineAction("land", set(null)).kind).toBe("refused")
    expect(planLineAction("land", set(0)).kind).toBe("refused")
    expect(planLineAction("land", set(2))).toEqual({
      kind: "land",
      onto: "pineta-onto",
    })
  })
  test("follow: only with a line and a preview, the one you were shown; a conflict in it refuses nothing", () => {
    const preview = { files: ["a.txt"], conflicts: ["a.txt"], heads: 0 }
    const set = (follow: typeof preview | null) =>
      record({
        commit: commitId("c1"),
        yours: {
          behind: 2,
          ahead: 1,
          follow,
          conflicts: { commits: 0, files: [] },
        },
      })
    expect(planLineAction("follow", record())).toEqual({
      kind: "refused",
      code: ERR.NO_LINE,
    })
    expect(planLineAction("follow", set(null))).toEqual({
      kind: "refused",
      code: ERR.REFUSED,
    })
    expect(planLineAction("follow", set(preview))).toEqual({
      kind: "follow",
      onto: "pineta-onto",
    })
    expect(
      planLineAction("follow", { ...set(preview), commands: false }),
    ).toEqual({ kind: "refused", code: ERR.NOT_YOURS })
  })
})
