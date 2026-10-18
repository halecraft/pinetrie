import { sessionNameFor } from "@pinetrie/config/testing"
import type { SshName } from "@pinetrie/ssh"
import { describe, expect, test } from "vitest"
import {
  agentReadyLine,
  reportLines,
  sessionLines,
  sshLines,
  startupLaps,
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
      sessionLines({ kind: "found", entry, write: registry }, home),
    ).toEqual(["[host] session     website (~/work/website)"])
  })

  test("a new session says only that it is new", () => {
    const entry = at("/home/ada/new/website", "website-quiet-fox")
    expect(sessionLines({ kind: "new", entry, write: registry }, home)).toEqual(
      ["[host] session     website-quiet-fox (new)"],
    )
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
      ),
    ).toEqual(["[host] session     website (attached, was ~/old/website)"])
  })
})

describe("storeLine", () => {
  test.each([
    [
      { file: "/d/sessions/p/pinetrie.db", from: "session" },
      "[host] store       /d/sessions/p/pinetrie.db",
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

test("startupLaps: a phase of a second or more is said with its time since the last lap; a quicker one is not", () => {
  const lines: string[] = []
  const times = [0, 400, 1900, 2899]
  const lap = startupLaps(
    line => lines.push(line),
    () => times.shift() ?? 0,
  )
  lap("quick")
  lap("slow")
  lap("just under")
  expect(lines).toEqual(["[host] starting: slow took 1500 ms"])
})

test("an allowed host with no known key is said at start", () => {
  const lines = sshLines({
    settings: {
      personal: { kind: "on", hosts: ["hql", "*.lan"], own: true },
      approvalSeconds: 120,
    },
    checks: [],
    failed: [],
    added: [],
    dropped: [],
    unmatched: [
      { kind: "name", name: "hql" as SshName, checkedAs: "192.168.1.2" },
      { kind: "wild", pattern: "*.lan" },
    ],
    hasSsh: true,
    hasAgent: true,
  })
  expect(lines).toContain(
    "[host] lanes.ssh.hosts: hql has no key in your known_hosts (ssh checks it as 192.168.1.2), so your identity signs for it nowhere; ssh there once from this machine",
  )
  expect(lines).toContain(
    "[host] lanes.ssh.hosts: *.lan matches no line of your known_hosts, so your identity signs for it nowhere",
  )
})
