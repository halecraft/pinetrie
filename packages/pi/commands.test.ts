// A command's file as the model reads it, from its text alone.

import type { CommandSource } from "@pinetrie/rules"
import { describe, expect, test } from "vitest"
import { expandCommand, parseSkill, withoutFrontmatter } from "./commands.ts"

test("withoutFrontmatter: a skill's instructions, not its header", () => {
  expect(withoutFrontmatter("---\nname: x\n---\n\n# Do\nit\n")).toBe("# Do\nit")
  expect(withoutFrontmatter("# plain\n")).toBe("# plain")
})

describe("a skill whose frontmatter is not YAML", () => {
  const broken = "---\nname: [x\n---\n\nDo it.\n"
  const command = {
    kind: "skill",
    name: "pkg:skill:broken",
    file: "/skills/broken/SKILL.md",
    dir: "/skills/broken",
  } as CommandSource

  test("still expands, with its body", () => {
    const ref = expandCommand(command, broken, "now", false)
    expect(ref.expanded).toContain("Do it.")
    expect(ref.expanded).not.toContain("name: [x")
  })

  test("is still read as a skill", () => {
    expect(parseSkill(command.file, broken).content).toBe("Do it.")
  })
})
