import type { FieldSource, ModelOrigin } from "@pinetrie/pi"
import { describe, expect, test } from "vitest"
import {
  agentReadyLine,
  brokenConfigLine,
  configLine,
  storeLine,
} from "./startup-lines.ts"

const FILE = "/home/ada/.config/pinetrie/config.json"
const GLOBAL = {
  kind: "settings",
  file: "/home/ada/.pi/agent/settings.json",
} as const
const PROJECT = { kind: "settings", file: "/p/.pi/settings.json" } as const
const OVERRIDE = { kind: "override" } as const

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

describe("configLine", () => {
  test.each([
    [{ kind: "read", json: {} }, `[host] config      ${FILE}`],
    [{ kind: "missing" }, `[host] config      ${FILE} (none)`],
    [
      { kind: "broken", reason: "Unexpected token" },
      `[host] config      ${FILE} is broken, so none of it applies: Unexpected token`,
    ],
  ] as const)("%o", (read, words) => {
    expect(configLine(FILE, read)).toBe(words)
  })
  test("a project's broken config", () => {
    expect(brokenConfigLine("pinetrie.json", "Unexpected token")).toBe(
      "[host] pinetrie.json is broken, so none of it applies: Unexpected token",
    )
  })
})

describe("agentReadyLine", () => {
  const configured = (
    provider: FieldSource,
    model: FieldSource,
  ): ModelOrigin => ({ kind: "configured", provider, model })
  test.each([
    [configured(GLOBAL, GLOBAL), `(from ${GLOBAL.file})`],
    [configured(OVERRIDE, OVERRIDE), "(PINETRIE_PROVIDER, PINETRIE_MODEL)"],
    [
      configured(GLOBAL, OVERRIDE),
      `(provider from ${GLOBAL.file}; PINETRIE_MODEL)`,
    ],
    [
      configured(OVERRIDE, PROJECT),
      `(PINETRIE_PROVIDER; model from ${PROJECT.file})`,
    ],
    [
      configured(GLOBAL, PROJECT),
      `(provider from ${GLOBAL.file}; model from ${PROJECT.file})`,
    ],
  ])("%o", (origin, words) => {
    expect(agentReadyLine({ label: "a/b", origin, tools: "/p" })).toBe(
      `[host] agent ready — model a/b ${words}; tools on, in /p`,
    )
  })
  test("a scripted or named model says no origin; tools off", () => {
    expect(
      agentReadyLine({
        label: "faux/x",
        origin: { kind: "scripted" },
        tools: null,
      }),
    ).toBe("[host] agent ready — model faux/x; tools off")
  })
})
