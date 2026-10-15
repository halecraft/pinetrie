import { sessionNameFor } from "@pinetrie/config/testing"
import { describe, expect, test } from "vitest"
import {
  agentReadyLine,
  reportLines,
  sessionLines,
  storeLine,
} from "./startup-lines.ts"

describe("sessionLines", () => {
  const home = "/home/ada"
  const at = (path: string, name: string) => ({
    path,
    name: sessionNameFor(name),
    servedAt: 1,
  })
  const registry = { version: 1, entries: [] } as const

  test("a session found says its folder, under home as ~", () => {
    const entry = at("/home/ada/work/website", "website")
    expect(
      sessionLines({ kind: "found", entry, write: registry }, home, "dev"),
    ).toEqual(["[host] session     website (~/work/website)"])
  })

  test("a new session beside a gone one of its name says how to attach that one", () => {
    const entry = at("/home/ada/new/website", "website-quiet-fox")
    const movedFrom = at("/home/ada/old/website", "website")
    expect(
      sessionLines(
        { kind: "new", entry, write: registry, movedFrom },
        home,
        "serve",
      ),
    ).toEqual([
      "[host] session     website-quiet-fox (new)",
      "[host]   website was at ~/old/website, which is gone: PINETRIE_SESSION=website pnpm serve ~/new/website attaches it",
    ])
  })

  test("an attached session says where it was", () => {
    const entry = at("/srv/website", "website")
    expect(
      sessionLines(
        {
          kind: "attached",
          entry,
          from: "/home/ada/old/website",
          dropped: null,
          write: registry,
        },
        home,
        "dev",
      ),
    ).toEqual(["[host] session     website (attached, was ~/old/website)"])
  })
})

describe("storeLine", () => {
  test.each([
    [
      { file: "/p/.pinetrie/pinetrie.db", from: "project" },
      "[host] store       /p/.pinetrie/pinetrie.db",
    ],
    [
      { file: "/tmp/s.db", from: "PINETRIE_STORE" },
      "[host] store       /tmp/s.db (PINETRIE_STORE)",
    ],
  ] as const)("%o", (choice, words) => {
    expect(storeLine(choice)).toBe(words)
  })
})

describe("reportLines", () => {
  test("a line per file, then one per refusal", () => {
    expect(
      reportLines({
        files: [
          { file: "/c/pinetrie.json", state: "read" },
          { file: "/c/sessions/p/pinetrie.json", state: "missing" },
        ],
        refusals: [
          {
            layer: "user",
            file: "/c/pinetrie.json",
            key: "lanes.vm.slots",
            why: "malformed",
            detail: "is not a whole number from 1 to 20",
          },
        ],
      }),
    ).toEqual([
      "[host] config      /c/pinetrie.json",
      "[host] config      /c/sessions/p/pinetrie.json (none)",
      "[host] /c/pinetrie.json: lanes.vm.slots is not a whole number from 1 to 20, and is not taken",
    ])
  })
})

describe("agentReadyLine", () => {
  test("a configured model says where it came from", () => {
    expect(
      agentReadyLine({
        model: { kind: "model", label: "a/b" },
        origins: [{ kind: "file", layer: "user", file: "/c/pinetrie.json" }],
        tools: "/p",
      }),
    ).toBe(
      "[host] agent ready — model a/b (from /c/pinetrie.json); tools on, in /p",
    )
  })
  test("a model from PINETRIE_MODEL names the variable", () => {
    expect(
      agentReadyLine({
        model: { kind: "model", label: "a/b" },
        origins: [{ kind: "env", name: "PINETRIE_MODEL" }],
        tools: null,
      }),
    ).toBe("[host] agent ready — model a/b (from $PINETRIE_MODEL); tools off")
  })
  test("a scripted or named model says no origin; tools off", () => {
    expect(
      agentReadyLine({
        model: { kind: "model", label: "faux/x" },
        origins: null,
        tools: null,
      }),
    ).toBe("[host] agent ready — model faux/x; tools off")
  })
  test("no model says why", () => {
    expect(
      agentReadyLine({
        model: { kind: "none", why: "unset", named: null },
        origins: [],
        tools: null,
      }),
    ).toBe(
      "[host] agent ready — no model: no config names one: set model, as provider/id; tools off",
    )
  })
})
