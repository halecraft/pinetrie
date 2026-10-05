import { describe, expect, test } from "vitest"
import {
  decodeCommandRenames,
  expandSkill,
  type GatheredCommand,
  labelCommands,
  parseCommand,
  resolveCommand,
} from "./index.ts"

describe("parseCommand: a first word of /package:name or /package:skill:name", () => {
  test("a skill, a prompt, and their arguments", () => {
    expect(parseCommand("/duane:skill:plan make it so")).toEqual({
      name: "duane:skill:plan",
      args: "make it so",
    })
    expect(parseCommand("/duane:comments src/")).toEqual({
      name: "duane:comments",
      args: "src/",
    })
    expect(parseCommand("/duane:skill:plan")).toEqual({
      name: "duane:skill:plan",
      args: "",
    })
  })
  test("a prompt template named skill is a prompt", () => {
    expect(parseCommand("/duane:skill")?.name).toBe("duane:skill")
  })
  test("anything else is ordinary text", () => {
    for (const text of [
      "/plan",
      "/etc/hosts is odd",
      "/a:b:c",
      "/:x",
      "/a::b",
      "hello /duane:skill:plan",
    ])
      expect(parseCommand(text)).toBeNull()
  })
})

const gathered = (
  over: Partial<GatheredCommand> & Pick<GatheredCommand, "name" | "source">,
): GatheredCommand => ({
  kind: "skill",
  description: "",
  argumentHint: null,
  file: `/x/${over.name}/SKILL.md`,
  dir: `/x/${over.name}`,
  root: "/x",
  names: { pinetrie: false, plugin: null, packageName: null, scope: "user" },
  ...over,
})

describe("labelCommands: each package's label, and clashes refused", () => {
  test("plugin.json's name, else the unscoped package name, else pi's scope, else pinetrie", () => {
    const { commands, refused } = labelCommands(
      [
        gathered({
          name: "plan",
          source: "/d",
          names: {
            pinetrie: false,
            plugin: "duane",
            packageName: "@duane/skills",
            scope: "user",
          },
        }),
        gathered({
          name: "plan",
          source: "/p",
          names: {
            pinetrie: false,
            plugin: null,
            packageName: "@zenspc/pi-pstack",
            scope: "user",
          },
        }),
        gathered({
          name: "comments",
          kind: "prompt",
          source: "/d",
          names: {
            pinetrie: false,
            plugin: "duane",
            packageName: "@duane/skills",
            scope: "user",
          },
        }),
        gathered({ name: "loose", source: "user" }),
        gathered({
          name: "resolve-conflicts",
          source: "/pinetrie",
          names: {
            pinetrie: true,
            plugin: null,
            packageName: null,
            scope: "user",
          },
        }),
      ],
      {},
    )
    expect(refused).toEqual([])
    expect(commands.map(c => c.name)).toEqual([
      "duane:skill:plan",
      "pi-pstack:skill:plan",
      "duane:comments",
      "user:skill:loose",
      "pinetrie:skill:resolve-conflicts",
    ])
  })
  test("a rename, keyed by pi's source, wins", () => {
    const { commands } = labelCommands(
      [
        gathered({
          name: "plan",
          source: "/p",
          names: {
            pinetrie: false,
            plugin: null,
            packageName: "@zenspc/pi-pstack",
            scope: "user",
          },
        }),
      ],
      { "/p": "pstack" },
    )
    expect(commands.map(c => c.name)).toEqual(["pstack:skill:plan"])
  })
  test("two sources with one label are refused together, both named", () => {
    const names = {
      pinetrie: false,
      plugin: "same",
      packageName: null,
      scope: "user",
    }
    const { commands, refused } = labelCommands(
      [
        gathered({ name: "a", source: "/one", names }),
        gathered({ name: "b", source: "/two", names }),
        gathered({
          name: "c",
          source: "/three",
          names: { ...names, plugin: "other" },
        }),
      ],
      {},
    )
    expect(commands.map(c => c.name)).toEqual(["other:skill:c"])
    expect(refused[0]?.reason).toContain("/one and /two")
  })
})

test("resolveCommand: an exact qualified name, or null", () => {
  const commands = [
    {
      name: "duane:skill:plan",
      kind: "skill" as const,
      description: "",
      argumentHint: null,
    },
  ]
  expect(resolveCommand("duane:skill:plan", commands)?.name).toBe(
    "duane:skill:plan",
  )
  expect(resolveCommand("duane:plan", commands)).toBeNull()
})

test("expandSkill: pi's block, byte for byte, then the arguments", () => {
  // As `_expandSkillCommand` in pi-coding-agent's dist/core/agent-session.js.
  expect(
    expandSkill({
      name: "plan",
      file: "/s/plan/SKILL.md",
      dir: "/s/plan",
      body: "Write a plan.",
      args: "for lanes",
    }),
  ).toBe(
    '<skill name="plan" location="/s/plan/SKILL.md">\nReferences are relative to /s/plan.\n\nWrite a plan.\n</skill>\n\nfor lanes',
  )
  expect(
    expandSkill({ name: "p", file: "/f", dir: "/d", body: "b", args: "" }),
  ).toBe(
    '<skill name="p" location="/f">\nReferences are relative to /d.\n\nb\n</skill>',
  )
})

test("decodeCommandRenames: commands.names, total", () => {
  expect(decodeCommandRenames(null)).toEqual({})
  expect(decodeCommandRenames({ commands: { names: 3 } })).toEqual({})
  expect(
    decodeCommandRenames({
      commands: { names: { "/p": "pstack", "/q": "has space", "/r": 4 } },
    }),
  ).toEqual({ "/p": "pstack" })
})
