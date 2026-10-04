// Commands from pi's loader (ADR-0036), over a fixture pi directory whose
// settings list two packages that each have a skill named `hello`.

import path from "node:path"
import { labelCommands } from "@pineta/marginalia"
import { expect, test } from "vitest"
import { imageModelFor, setUpModel, titleModelOf } from "./config.ts"
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
  expect(
    labelCommands(setup.commands, {})
      .commands.map(c => c.name)
      .sort(),
  ).toEqual([
    "pineta:skill:ask-digest",
    "pineta:skill:column-banner",
    "pineta:skill:commit-message",
    "pineta:skill:offer-stack",
    "pineta:skill:resolve-conflicts",
    "pineta:skill:tab-title",
  ])
})

test("a scripted model answers commit messages from a provider of its own: the run's script is untouched (S48 item 22)", async () => {
  const script = scriptedModel({
    describe: { reply: context => `feat: ${context.at(-1)?.length}` },
  })
  script.use([{ text: "the run's reply" }])
  const setup = await setUpModel(
    { kind: "scripted", script },
    { cwd: agentDir },
  )
  const ask = (text: string) =>
    setup.models.completeSimple(setup.describeModel, {
      systemPrompt: "write one",
      messages: [{ role: "user", content: text, timestamp: 0 }],
    })
  const text = (m: Awaited<ReturnType<typeof ask>>) =>
    m.content.flatMap(p => (p.type === "text" ? [p.text] : [])).join("")
  expect(text(await ask("abc"))).toBe("feat: 3")
  expect(text(await ask("abcd"))).toBe("feat: 4")
  const run = await setup.models.completeSimple(setup.model, {
    systemPrompt: "answer",
    messages: [{ role: "user", content: "go", timestamp: 0 }],
  })
  expect(text(run)).toBe("the run's reply")
})

test("imageModelFor: pi-ai's entry, else one for an unlisted OpenRouter id, else none", () => {
  const listed = imageModelFor(
    undefined,
    "openrouter",
    "recraft/recraft-v4.1-flash",
  )
  expect(listed).toMatchObject({
    id: "recraft/recraft-v4.1-flash",
    api: "openrouter-images",
    provider: "openrouter",
    output: ["image"],
  })
  if (listed === undefined) throw new Error("no model")
  expect(imageModelFor(listed, "openrouter", "other")).toBe(listed)
  expect(imageModelFor(undefined, "elsewhere", "x")).toBeUndefined()
})

test("titleModelOf: the named model, else the describe model, and whether pi had the one named", async () => {
  const setup = await setUpModel(
    { kind: "scripted", script: scriptedModel() },
    { cwd: agentDir },
  )
  const run = { provider: setup.model.provider, model: setup.model.id }
  expect(titleModelOf(setup, null, false)).toEqual({
    model: setup.describeModel,
    found: true,
  })
  expect(titleModelOf(setup, run, false)).toEqual({
    model: setup.model,
    found: true,
  })
  expect(titleModelOf(setup, { provider: "no", model: "such" }, false)).toEqual(
    { model: setup.describeModel, found: false },
  )
  // A scripted model's titles come from its describe provider, whatever is named.
  expect(titleModelOf(setup, run, true)).toEqual({
    model: setup.describeModel,
    found: true,
  })
})
