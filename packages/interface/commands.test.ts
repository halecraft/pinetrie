import type { CommandSummary } from "@pinetrie/core"
import { expect, test } from "vitest"
import { matchCommands } from "./commands.ts"

const command = (name: string, kind: CommandSummary["kind"] = "skill") => ({
  name,
  kind,
  description: "",
  argumentHint: null,
})
const commands = [
  command("duane:skill:plan"),
  command("pi-pstack:skill:plan"),
  command("duane:comments", "prompt"),
  command("duane:skill:explain"),
]
const names = (text: string) => matchCommands(text, commands).map(c => c.name)

test("a name typed alone finds it in every package", () => {
  expect(names("/plan")).toEqual(["duane:skill:plan", "pi-pstack:skill:plan"])
})

test("a package lists its commands; a part of each narrows", () => {
  expect(names("/duane:")).toEqual([
    "duane:skill:plan",
    "duane:comments",
    "duane:skill:explain",
  ])
  expect(names("/duane:plan")).toEqual(["duane:skill:plan"])
})

test("a command whose own name starts with what is typed comes first", () => {
  expect(names("/pla")[0]).toBe("duane:skill:plan")
  // `c` is in `comments`, and in `pi-pstack`: the command named for it leads.
  expect(names("/c")).toEqual(["duane:comments", "pi-pstack:skill:plan"])
})

test("nothing once there is more than a first word, or no slash", () => {
  expect(names("/plan now")).toEqual([])
  expect(names("plan")).toEqual([])
  expect(names("/")).toHaveLength(4)
})
