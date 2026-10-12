import { describe, expect, test } from "vitest"
import {
  configPath,
  inlineIncludes,
  missingIncludes,
  parseLine,
  parseSshConfig,
  splitArgs,
} from "./config.ts"

const ROOTS = { base: "/home/d/.ssh", home: "/home/d" }

describe("parseLine", () => {
  test("a keyword is lowercased, and ends at whitespace or one =", () => {
    expect(parseLine("  HostName pop.lan")).toEqual({
      keyword: "hostname",
      args: ["pop.lan"],
    })
    expect(parseLine("Port=2222")).toEqual({ keyword: "port", args: ["2222"] })
    expect(parseLine("User = deploy")).toEqual({
      keyword: "user",
      args: ["deploy"],
    })
  })

  test("a blank line and a comment are nothing", () => {
    expect(parseLine("   ")).toBeNull()
    expect(parseLine("# Host x")).toBeNull()
  })
})

describe("splitArgs", () => {
  test("quotes group, and a backslash escapes a space", () => {
    expect(splitArgs(`"a b" 'c d' e\\ f`)).toEqual(["a b", "c d", "e f"])
  })

  test("a # that starts a word ends the line", () => {
    expect(splitArgs("pop # the laptop")).toEqual(["pop"])
    expect(splitArgs("a#b")).toEqual(["a#b"])
  })
})

describe("parseSshConfig", () => {
  test("lines before the first Host apply to every host", () => {
    expect(parseSshConfig("User d\nHost pop\n  HostName 192.168.1.2")).toEqual([
      { patterns: ["*"], lines: [{ keyword: "user", args: ["d"] }] },
      {
        patterns: ["pop"],
        lines: [{ keyword: "hostname", args: ["192.168.1.2"] }],
      },
    ])
  })

  test("a Match block is skipped to the next Host", () => {
    const blocks = parseSshConfig(
      "Match exec true\n  User root\nHost pop\n  User d",
    )
    expect(blocks).toEqual([
      { patterns: ["pop"], lines: [{ keyword: "user", args: ["d"] }] },
    ])
  })
})

test("a config path: ~ is home, relative is under its base", () => {
  expect(configPath("~/.ssh/x", "/b", "/home/d")).toBe("/home/d/.ssh/x")
  expect(configPath("conf.d/*", "/b", "/home/d")).toBe("/b/conf.d/*")
  expect(configPath("/etc/x", "/b", "/home/d")).toBe("/etc/x")
})

describe("includes", () => {
  test("missing names every Include not read yet, at any depth", () => {
    const files = new Map([["/home/d/.ssh/a", ["Include /x/b"]]])
    expect(missingIncludes("Include a", ROOTS, files)).toEqual(["/x/b"])
  })

  test("an included file goes in place, inside the block that includes it", () => {
    const files = new Map([["/home/d/.ssh/a", ["User d"]]])
    expect(
      inlineIncludes("Host pop\n  Include a\n  Port 22", ROOTS, files),
    ).toBe("Host pop\nUser d\n  Port 22")
  })

  test("after an included file opens blocks, the including block is opened again", () => {
    const files = new Map([["/home/d/.ssh/a", ["Host other\n  User o"]]])
    const text = inlineIncludes(
      "Host pop\n  Include a\n  Port 22",
      ROOTS,
      files,
    )
    const pop = parseSshConfig(text).filter(b => b.patterns[0] === "pop")
    expect(pop.flatMap(b => b.lines)).toEqual([
      { keyword: "port", args: ["22"] },
    ])
  })

  test("an Include nested past ssh's depth is left out", () => {
    const files = new Map([["/home/d/.ssh/a", ["Include a"]]])
    expect(() => inlineIncludes("Include a", ROOTS, files)).not.toThrow()
  })
})
