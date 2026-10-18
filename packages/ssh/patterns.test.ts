import { describe, expect, test } from "vitest"
import { hostPatternList, isHostAllowed, matchesPattern } from "./patterns.ts"

describe("matchesPattern", () => {
  test("a star matches any run of characters, even none", () => {
    expect(matchesPattern("web.prod", "*.prod")).toBe(true)
    expect(matchesPattern(".prod", "*.prod")).toBe(true)
    expect(matchesPattern("web.prod.x", "*.prod")).toBe(false)
  })

  test("a question mark matches one character", () => {
    expect(matchesPattern("pop1", "pop?")).toBe(true)
    expect(matchesPattern("pop", "pop?")).toBe(false)
  })

  test("case does not matter", () => {
    expect(matchesPattern("POP", "pop")).toBe(true)
  })
})

describe("isHostAllowed", () => {
  test("all passes every name", () => {
    expect(isHostAllowed("anything", "all")).toBe(true)
  })

  test("a negation that matches fails the name, whatever else matches", () => {
    expect(isHostAllowed("db.lan", ["*.lan", "!db.lan"])).toBe(false)
    expect(isHostAllowed("web.lan", ["*.lan", "!db.lan"])).toBe(true)
  })

  test("negations alone pass nothing", () => {
    expect(isHostAllowed("web.lan", ["!db.lan"])).toBe(false)
  })

  test("an entry may be a comma-separated list", () => {
    expect(isHostAllowed("pop", ["git.internal,pop"])).toBe(true)
  })

  test("an empty list passes nothing", () => {
    expect(isHostAllowed("pop", [])).toBe(false)
  })
})

describe("hostPatternList", () => {
  test("a comma-separated entry is several patterns", () => {
    expect(hostPatternList(["hql,*.lan", "!db.lan"])).toEqual([
      { kind: "name", name: "hql" },
      { kind: "wild", pattern: "*.lan" },
      { kind: "not", pattern: "db.lan" },
    ])
  })

  test("a concrete pattern ssh would read as an option is matched, never resolved", () => {
    expect(hostPatternList(["-oProxyCommand=x"])).toEqual([
      { kind: "wild", pattern: "-oProxyCommand=x" },
    ])
  })
})
