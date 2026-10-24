import { sessionNameFor } from "@pinetrie/config/testing"
import type { SshName } from "@pinetrie/ssh"
import { describe, expect, test } from "vitest"
import {
  checklistAfter,
  type StartEvent,
  startChecklist,
} from "./start-checklist.ts"
import {
  agentReadyLine,
  checklistLines,
  endedLine,
  reportLines,
  sessionLines,
  sshLines,
  startStepWords,
  storeLine,
  workingLine,
  workWords,
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

test("an allowed host with no known key is said at start", () => {
  const lines = sshLines({
    personal: { kind: "on", hosts: ["hql", "*.lan"], own: true },
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

describe("the start's checklist", () => {
  const list = [
    { kind: "begin", step: "lane-machine", at: 0 },
    { kind: "begin", step: "store", at: 400 },
    { kind: "begin", step: "lane-images", at: 1000 },
    {
      kind: "working",
      work: { kind: "build", build: { kind: "image", image: "lane" } },
    },
  ].reduce(
    (l, e) => checklistAfter(l, e as StartEvent),
    startChecklist(
      ["lane-machine", "store", "project", "lane-images", "observer"],
      { "lane-images": { built: 120_000 } },
    ),
  )

  test("every state of a step has its line", () => {
    expect(checklistLines(list, "lane-vm", 43_000)).toEqual([
      "  ✓ the lane VM, up to date (0.4 s)",
      "  ✓ the store and the session (0.6 s)",
      "  ✗ the project and its config: never ran",
      "  ▸ the lane images: building the lane image · 42.0 s of about 2:00",
      "  · the observer",
    ])
  })

  test("a failed step says why", () => {
    const failed = checklistAfter(list, { kind: "fail", why: "no git" })
    expect(checklistLines(failed, "docker", 0).at(-2)).toBe(
      "  ✗ the lane images: no git",
    )
  })

  test("the line form says a step that built, and a build with its estimate", () => {
    expect(
      endedLine(
        {
          kind: "done",
          step: "observer",
          took: 61_000,
          built: { kind: "image", image: "observer" },
        },
        "lane-vm",
      ),
    ).toBe("[host] ✓ the observer, built (1:01)")
    expect(
      workingLine(
        { kind: "build", build: { kind: "image", image: "observer" } },
        "observer",
        {},
      ),
    ).toBe("[host] building the observer's image (about 1:00)")
    expect(
      workingLine(
        { kind: "build", build: { kind: "image", image: "lane" } },
        null,
        {},
      ),
    ).toBe("[host] building the lane image")
  })

  test("the lane machine is named for where lanes run", () => {
    expect(startStepWords("lane-machine", "lane-vm")).toBe("the lane VM")
    expect(startStepWords("lane-machine", "docker")).toBe("Docker")
  })

  test("a VM image's build says what it does first", () => {
    const vmImage = (compile: boolean) =>
      workWords({
        kind: "build",
        build: { kind: "vm-image", compile, fetch: false },
      })
    expect(vmImage(true)).toBe(
      "building the lane VM's image: compiling its builder first",
    )
    expect(vmImage(false)).toBe("building the lane VM's image")
  })

  test("a stop of the slot's leftovers says how many, with no build's estimate", () => {
    expect(workWords({ kind: "stopping-left", count: 10 })).toBe(
      "stopping 10 containers the last host left",
    )
    expect(workWords({ kind: "stopping-left", count: 1 })).toBe(
      "stopping 1 container the last host left",
    )
    expect(
      workingLine({ kind: "stopping-left", count: 2 }, "lanehost", {}),
    ).toBe("[host] stopping 2 containers the last host left")
  })
})
