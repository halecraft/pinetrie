import { describe, expect, test } from "vitest"
import { agentReadyLine, reportLines, storeLine } from "./startup-lines.ts"

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
