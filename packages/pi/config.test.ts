// Commands from pi's loader (ADR-0036), over a fixture pi directory whose
// settings list two packages that each have a skill named `hello`.

import path from "node:path"
import { labelCommands } from "@pineta/marginalia"
import { expect, test } from "vitest"
import { setUpModel } from "./config.ts"
import { scriptedModel } from "./scripted.ts"

const agentDir = path.join(import.meta.dirname, "fixtures", "pi-agent")

test("every skill and template pi loaded, the ones it dropped for their names included, each under its package", async () => {
  const setup = await setUpModel(
    { kind: "scripted", script: scriptedModel() },
    { cwd: agentDir, agentDir },
  )
  // pi's model sees one `hello`; as commands, both are reachable.
  expect(setup.skills?.map(s => s.name).sort()).toEqual(["explain", "hello"])
  const { commands, refused } = labelCommands(setup.commands, {})
  expect(refused).toEqual([])
  expect(commands.map(c => c.name).sort()).toEqual([
    "fixture:greet",
    "fixture:skill:explain",
    "fixture:skill:hello",
    "pi-other:skill:hello",
  ])
  const hello = commands.find(c => c.name === "fixture:skill:hello")
  expect(hello?.root).toBe(path.join(agentDir, "..", "fixture-pkg"))
  expect(commands.find(c => c.name === "fixture:greet")?.argumentHint).toBe(
    "<name>",
  )
})

test("a scripted model given no agent directory loads nothing of pi's, and still has Pineta's own skills as commands", async () => {
  const setup = await setUpModel(
    { kind: "scripted", script: scriptedModel() },
    {
      cwd: agentDir,
      skillsDir: path.join(import.meta.dirname, "skills"),
    },
  )
  expect(setup.skills).toEqual([])
  expect(labelCommands(setup.commands, {}).commands.map(c => c.name)).toEqual([
    "pineta:skill:resolve-conflicts",
  ])
})
