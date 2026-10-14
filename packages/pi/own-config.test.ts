// pi's code over pine·trie's config, with a sentinel in every place pi would
// look on its own: none of them reaches what the host uses. A home of the
// test's own stands in for the person's; pi's agent directory is bound to
// pine·trie's config directory in it, as `server.ts` binds it.

import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { labelCommands } from "@pinetrie/rules"
import { expect, test } from "vitest"
import { bindAgentDir } from "./agent-dir.ts"
import { loadModelSetup } from "./config.ts"
import { openLoader } from "./deep.ts"

const root = realpathSync(mkdtempSync(path.join(tmpdir(), "pinetrie-own-")))
const home = path.join(root, "home")
const piDir = path.join(home, ".pi", "agent")
const configDir = path.join(home, ".config", "pinetrie")
const project = path.join(home, "proj")
const put = (file: string, text: string) => {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, text)
}
const skill = (name: string) =>
  `---\nname: ${name}\ndescription: sentinel ${name}\n---\nsentinel ${name}\n`

// pi's agent directory, the home above the project, and the project's own.
put(path.join(piDir, "AGENTS.md"), "sentinel pi AGENTS\n")
put(path.join(piDir, "skills", "pi-skill", "SKILL.md"), skill("pi-skill"))
put(path.join(piDir, "prompts", "pi-prompt.md"), "sentinel pi prompt\n")
put(path.join(piDir, "agent-dir-ext.json"), '{ "name": "pi-dir-provider" }')
put(path.join(home, "AGENTS.md"), "sentinel home AGENTS\n")
put(path.join(project, "AGENTS.md"), "sentinel project AGENTS\n")
put(path.join(project, ".pi", "SYSTEM.md"), "sentinel project SYSTEM\n")
put(path.join(project, ".pi", "skills", "dot-pi", "SKILL.md"), skill("dot-pi"))
put(
  path.join(project, ".agents", "skills", "dot-agents", "SKILL.md"),
  skill("dot-agents"),
)
// pine·trie's own.
put(path.join(configDir, "AGENTS.md"), "sentinel ours AGENTS\n")
put(path.join(configDir, "skills", "ours", "SKILL.md"), skill("ours"))
put(path.join(configDir, "agent-dir-ext.json"), '{ "name": "ours-provider" }')
put(path.join(project, "team-skills", "team", "SKILL.md"), skill("team"))

const places = {
  configDir,
  credentials: path.join(home, ".local", "share", "pinetrie", "auth.json"),
  models: path.join(configDir, "models.json"),
}
const binding = bindAgentDir(configDir)
const EXTENSION = path.join(import.meta.dirname, "fixtures", "agent-dir-ext")

const loaded = () =>
  loadModelSetup(
    { kind: "configured", model: null },
    {
      cwd: project,
      places,
      binding,
      lists: {
        packages: [EXTENSION],
        skills: [{ path: path.join(project, "team-skills"), layer: "project" }],
        prompts: [],
      },
      skillsDir: path.join(import.meta.dirname, "skills"),
    },
  )

test("nothing of pi's directories, a project's .pi/ or .agents/, or above the project reaches the setup", async () => {
  const setup = await loaded()
  const names = (setup.skills ?? []).map(s => s.name)
  expect(names).toContain("ours")
  expect(names).toContain("team")
  for (const sentinel of ["pi-skill", "dot-pi", "dot-agents"])
    expect(names).not.toContain(sentinel)
  const commands = labelCommands(setup.commands, {}).commands.map(c => c.name)
  expect(commands).not.toContain("user:pi-prompt")
  expect((setup.contextFiles ?? []).map(f => f.path).sort()).toEqual([
    path.join(configDir, "AGENTS.md"),
    path.join(project, "AGENTS.md"),
  ])
})

test("an extension's own config is read from pine·trie's config directory", async () => {
  const setup = await loaded()
  const providers = setup.models.getProviders().map(p => p.id)
  expect(providers).toContain("ours-provider")
  expect(providers).not.toContain("pi-dir-provider")
})

test("a project's .pi/SYSTEM.md is not read: the project is untrusted", async () => {
  const loader = await openLoader({
    cwd: project,
    agentDir: configDir,
    extensionPaths: [],
    skillPaths: [],
    promptPaths: [],
    keepContextFile: () => true,
  })
  expect(loader.getSystemPrompt()).toBeUndefined()
})
