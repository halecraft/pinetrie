// The model setup: commands from the listed packages, the plan of what pi's
// code is given, and why a host has no model.

import path from "node:path"
import { labelCommands } from "@pinetrie/rules"
import { expect, test } from "vitest"
import { bindAgentDir } from "./agent-dir.ts"
import { commandOrigin } from "./commands.ts"
import {
  imageModelFor,
  isOwnContextFile,
  loadModelSetup,
  type ModelChoice,
  modelState,
  NO_RESOURCES,
  planModelSetup,
  type ResourceLists,
  titleModel,
} from "./config.ts"
import { scriptedModel } from "./scripted.ts"
import { testPlaces } from "./start-pi.ts"

const fixtures = path.join(import.meta.dirname, "fixtures")
const FIXTURE_PACKAGES = ["fixture-pkg", "other-pkg"].map(p =>
  path.join(fixtures, p),
)
const SKILLS = path.join(import.meta.dirname, "skills")

const setupWith = (
  choice: ModelChoice,
  lists: ResourceLists = NO_RESOURCES,
) => {
  const places = testPlaces()
  return loadModelSetup(choice, {
    cwd: fixtures,
    places,
    binding: bindAgentDir(places.configDir),
    lists,
    skillsDir: SKILLS,
  })
}

const scripted = (): ModelChoice => ({
  kind: "scripted",
  script: scriptedModel(),
})

test("every skill and template of the listed packages, the ones pi dropped for their names included, each under its package", async () => {
  const setup = await setupWith(scripted(), {
    ...NO_RESOURCES,
    packages: FIXTURE_PACKAGES,
  })
  // pi's model sees one `hello`, and pine·trie's own skills after it.
  expect(setup.skills?.map(s => s.name)).toContain("hello")
  const { commands, refused } = labelCommands(setup.commands, {})
  expect(refused).toEqual([])
  const named = commands
    .map(c => c.name)
    .filter(n => !n.startsWith("pinetrie:"))
    .sort()
  expect(named).toEqual([
    "fixture:greet",
    "fixture:skill:explain",
    "fixture:skill:hello",
    "pi-other:skill:hello",
  ])
  const hello = commands.find(c => c.name === "fixture:skill:hello")
  expect(hello?.root).toBe(path.join(fixtures, "fixture-pkg"))
  expect(commands.find(c => c.name === "fixture:greet")?.argumentHint).toBe(
    "<name>",
  )
})

test("a scripted model with nothing listed loads nothing of pi's, and still has pinetrie's own skills as commands", async () => {
  const setup = await setupWith(scripted())
  expect(setup.skills).toEqual([])
  expect(
    labelCommands(setup.commands, {})
      .commands.map(c => c.name)
      .sort(),
  ).toEqual([
    "pinetrie:skill:agents-round",
    "pinetrie:skill:ask-digest",
    "pinetrie:skill:column-banner",
    "pinetrie:skill:commit-message",
    "pinetrie:skill:offer-stack",
    "pinetrie:skill:resolve-conflicts",
    "pinetrie:skill:tab-title",
  ])
})

test("a scripted model answers commit messages from a provider of its own: the run's script is untouched", async () => {
  const script = scriptedModel({
    describe: { reply: context => `feat: ${context.at(-1)?.length}` },
  })
  script.use([{ text: "the run's reply" }])
  const setup = await setupWith({ kind: "scripted", script })
  const { describeModel, model } = setup
  if (describeModel === null || model.kind !== "model")
    throw new Error("no model")
  const ask = (text: string) =>
    setup.models.completeSimple(describeModel, {
      systemPrompt: "write one",
      messages: [{ role: "user", content: text, timestamp: 0 }],
    })
  const text = (m: Awaited<ReturnType<typeof ask>>) =>
    m.content.flatMap(p => (p.type === "text" ? [p.text] : [])).join("")
  expect(text(await ask("abc"))).toBe("feat: 3")
  expect(text(await ask("abcd"))).toBe("feat: 4")
  const run = await setup.models.completeSimple(model.model, {
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

test("titleModel: the named model, else the describe model, and whether pi had the one named", async () => {
  const setup = await setupWith(scripted())
  if (setup.model.kind !== "model") throw new Error("no model")
  const own = setup.model.model
  const run = { provider: own.provider, model: own.id }
  expect(titleModel(setup, null, false)).toEqual({
    model: setup.describeModel,
    found: true,
  })
  expect(titleModel(setup, run, false)).toEqual({ model: own, found: true })
  expect(titleModel(setup, { provider: "no", model: "such" }, false)).toEqual({
    model: setup.describeModel,
    found: false,
  })
  // A scripted model's titles come from its describe provider, whatever is named.
  expect(titleModel(setup, run, true)).toEqual({
    model: setup.describeModel,
    found: true,
  })
})

test("a configured host with no model named has none, and says why", async () => {
  const setup = await setupWith({ kind: "configured", model: null })
  expect(setup.model).toEqual({ kind: "none", why: "unset", named: null })
  expect(setup.describeModel).toBeNull()
})

test("modelState: unset, not found, no credential, or the model", () => {
  const named = { provider: "anthropic", model: "x" }
  expect(modelState({ named: null, found: 1, credential: true })).toEqual({
    kind: "none",
    why: "unset",
    named: null,
  })
  expect(
    modelState({ named, found: undefined, credential: true }).kind === "none" &&
      modelState({ named, found: undefined, credential: true }),
  ).toMatchObject({ why: "not-found" })
  expect(modelState({ named, found: 1, credential: false })).toMatchObject({
    why: "no-credential",
  })
  expect(modelState({ named, found: 1, credential: true })).toEqual({
    kind: "model",
    model: 1,
  })
})

describe_plan()

function describe_plan() {
  const places = {
    configDir: "/home/ada/.config/pinetrie",
    credentials: "/home/ada/.local/share/pinetrie/auth.json",
    models: "/home/ada/.config/pinetrie/models.json",
  }
  const plan = (lists: ResourceLists, exists: (p: string) => boolean) =>
    planModelSetup({
      places,
      lists,
      project: "/home/ada/proj",
      pinetrieSkills: "/pinetrie/skills",
      loads: true,
      exists,
    })

  test("the loader is given pine·trie's config directory, its lists, and nothing it did not list", () => {
    const p = plan(
      {
        packages: ["/pkgs/duane"],
        skills: [{ path: "/home/ada/proj/skills", layer: "project" }],
        prompts: [],
      },
      () => true,
    )
    expect(p.runtime).toEqual({
      authPath: places.credentials,
      modelsPath: places.models,
    })
    expect(p.loader).toMatchObject({
      agentDir: places.configDir,
      extensionPaths: ["/pkgs/duane"],
      skillPaths: [
        "/home/ada/proj/skills",
        `${places.configDir}/skills`,
        "/pinetrie/skills",
      ],
      promptPaths: [`${places.configDir}/prompts`],
    })
  })

  test("a listed package that is not a folder is refused, and never given to pi", () => {
    const p = plan(
      { ...NO_RESOURCES, packages: ["/pkgs/gone", "/pkgs/here"] },
      f => f === "/pkgs/here",
    )
    expect(p.refused).toEqual(["/pkgs/gone"])
    expect(p.loader?.extensionPaths).toEqual(["/pkgs/here"])
  })

  test("an AGENTS.md above the project is not a context file; pine·trie's own and the project's are", () => {
    const keep = (f: string) =>
      isOwnContextFile(f, "/home/ada/proj", places.configDir)
    expect(keep("/home/ada/AGENTS.md")).toBe(false)
    expect(keep("/AGENTS.md")).toBe(false)
    expect(keep(`${places.configDir}/AGENTS.md`)).toBe(true)
    expect(keep("/home/ada/proj/AGENTS.md")).toBe(true)
    expect(keep("/home/ada/proj/sub/CLAUDE.md")).toBe(true)
  })
}

test("a command is labelled by what pine·trie listed: a package's root, else the layer that listed its folder", () => {
  const listing = {
    packages: ["/ai/duane", "/ai/pstack"],
    loose: [{ path: "/proj/skills", layer: "project" as const }],
  }
  expect(
    commandOrigin("/ai/duane/skills/plan/SKILL.md", listing, "/p"),
  ).toEqual({ source: "/ai/duane", scope: "user", root: "/ai/duane" })
  expect(commandOrigin("/proj/skills/x/SKILL.md", listing, "/p")).toEqual({
    source: "project",
    scope: "project",
    root: null,
  })
  expect(commandOrigin("/p/tab-title/SKILL.md", listing, "/p").source).toBe(
    "pinetrie",
  )
})

test("loading the setup unbound, or taking its model without asking whether there is one, does not compile", () => {
  const places = testPlaces()
  const unbound = () =>
    loadModelSetup(
      { kind: "configured", model: null },
      // @ts-expect-error: pi's agent directory must be bound first
      { cwd: fixtures, places, lists: NO_RESOURCES, skillsDir: SKILLS },
    )
  const unswitched = (setup: Awaited<ReturnType<typeof loadModelSetup>>) =>
    // @ts-expect-error: a host may have no model
    setup.model.model.id
  expect([typeof unbound, typeof unswitched]).toEqual(["function", "function"])
})
