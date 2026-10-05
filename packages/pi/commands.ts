// pi/commands — every skill and prompt template pi loaded, as commands to be
// labelled (ADR-0036), and a command's file as the model reads it.
//
// pi keeps the first skill or template of each name and drops the rest,
// with a `collision` diagnostic naming the loser's file. A command is named
// by its package, so each of those is reachable too: this loads them again
// by file. What a command's label may come from is read from its package's
// root: Claude's `.claude-plugin/plugin.json`, and `package.json`.

import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { type CommandRef, hostPathInLane } from "@pinetrie/core"
import {
  type CommandSource,
  expandSkill,
  type GatheredCommand,
  resolveCommand,
} from "@pinetrie/rules"
import {
  type DefaultResourceLoader,
  loadPromptTemplates,
  loadSkillsFromDir,
  parseCommandArgs,
  substituteArgs,
} from "./deep.ts"
import { sha256Of } from "./images.ts"

type Loader = InstanceType<typeof DefaultResourceLoader>
type Skill = ReturnType<Loader["getSkills"]>["skills"][number]
type Template = ReturnType<Loader["getPrompts"]>["prompts"][number]
type Diagnostic = ReturnType<Loader["getSkills"]>["diagnostics"][number]

const readJsonName = async (file: string): Promise<string | null> => {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as {
      name?: unknown
    }
    return typeof parsed.name === "string" ? parsed.name : null
  } catch {
    return null
  }
}

const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  )

/** The nearest directory at or above `file` holding a `package.json`, or null. */
async function packageRootOf(file: string): Promise<string | null> {
  for (let dir = path.dirname(file); ; dir = path.dirname(dir)) {
    if (await exists(path.join(dir, "package.json"))) return dir
    if (path.dirname(dir) === dir) return null
  }
}

/** What a skill or template came from, as a command needs it. */
interface Origin {
  readonly source: string
  readonly scope: string
  /** Its package's root, when it came from a package. */
  readonly root: string | null
}

async function namesOf(
  file: string,
  origin: Origin,
  pinetrieSkills: string,
): Promise<GatheredCommand["names"]> {
  const root = origin.root
  return {
    pinetrie:
      pinetrieSkills !== "" && file.startsWith(`${pinetrieSkills}${path.sep}`),
    plugin:
      root === null
        ? null
        : await readJsonName(path.join(root, ".claude-plugin", "plugin.json")),
    packageName:
      root === null
        ? null
        : await readJsonName(path.join(root, "package.json")),
    scope: origin.scope,
  }
}

const originOf = (info: {
  readonly source: string
  readonly scope: string
  readonly origin: string
  readonly baseDir?: string
}): Origin => ({
  source: info.source,
  scope: info.scope,
  root: info.origin === "package" ? (info.baseDir ?? null) : null,
})

/** A skill pi dropped for its name, loaded again from its own directory. */
async function loserSkill(d: Diagnostic): Promise<Skill | null> {
  const file = d.collision?.loserPath
  if (file === undefined) return null
  const source = d.collision?.loserSource ?? "user"
  // A skill is a directory holding SKILL.md, or a lone Markdown file.
  for (const dir of [path.dirname(path.dirname(file)), path.dirname(file)]) {
    const found = loadSkillsFromDir({ dir, source }).skills.find(
      s => s.filePath === file,
    )
    if (found !== undefined) return found
  }
  return null
}

/** A template pi dropped for its name, loaded again from its file. */
function loserTemplate(d: Diagnostic, cwd: string, agentDir: string) {
  const file = d.collision?.loserPath
  if (file === undefined) return null
  return (
    loadPromptTemplates({
      cwd,
      agentDir,
      promptPaths: [file],
      includeDefaults: false,
    }).templates.find(t => t.filePath === file) ?? null
  )
}

/**
 * pinetrie's own skills alone, as commands: what a scripted or named model has
 * when it loads nothing of pi's, so `pinetrie:skill:resolve-conflicts` is a
 * command whatever the model.
 */
export function pinetrieCommands(pinetrieSkills: string): GatheredCommand[] {
  return loadSkillsFromDir({
    dir: pinetrieSkills,
    source: "pinetrie",
  }).skills.map(s => ({
    kind: "skill",
    name: s.name,
    description: s.description,
    argumentHint: null,
    file: s.filePath,
    dir: s.baseDir,
    root: pinetrieSkills,
    source: "pinetrie",
    names: { pinetrie: true, plugin: null, packageName: null, scope: "user" },
  }))
}

/**
 * Every skill and prompt template the loader found, the ones it dropped for
 * their names included, as commands to be labelled. A dropped one's source
 * is its diagnostic's `loserSource`, else it is taken as the user's; its
 * package root is the nearest `package.json` above it.
 */
export async function gatherCommands(
  loader: Loader,
  where: { readonly cwd: string; readonly agentDir: string },
  pinetrieSkills: string,
): Promise<GatheredCommand[]> {
  const skills = loader.getSkills()
  const prompts = loader.getPrompts()
  const lostSkills = await Promise.all(
    skills.diagnostics
      .filter(d => d.collision?.resourceType === "skill")
      .map(loserSkill),
  )
  const lostTemplates = prompts.diagnostics
    .filter(d => d.collision?.resourceType === "prompt")
    .map(d => loserTemplate(d, where.cwd, where.agentDir))

  const originFor = async (
    info: Skill["sourceInfo"],
    file: string,
    lost: boolean,
  ): Promise<Origin> =>
    lost
      ? {
          source: info.source,
          scope: info.scope,
          root: await packageRootOf(file),
        }
      : originOf(info)

  const out: GatheredCommand[] = []
  const skill = async (s: Skill, lost: boolean) => {
    const origin = await originFor(s.sourceInfo, s.filePath, lost)
    out.push({
      kind: "skill",
      name: s.name,
      description: s.description,
      argumentHint: null,
      file: s.filePath,
      dir: s.baseDir,
      root: origin.root ?? s.baseDir,
      source: origin.source,
      names: await namesOf(s.filePath, origin, pinetrieSkills),
    })
  }
  const template = async (t: Template, lost: boolean) => {
    const origin = await originFor(t.sourceInfo, t.filePath, lost)
    const dir = path.dirname(t.filePath)
    out.push({
      kind: "prompt",
      name: t.name,
      description: t.description,
      argumentHint: t.argumentHint ?? null,
      file: t.filePath,
      dir,
      root: origin.root ?? dir,
      source: origin.source,
      names: await namesOf(t.filePath, origin, pinetrieSkills),
    })
  }
  for (const s of skills.skills) await skill(s, false)
  for (const s of lostSkills) if (s !== null) await skill(s, true)
  for (const t of prompts.prompts) await template(t, false)
  for (const t of lostTemplates) if (t !== null) await template(t, true)
  return out
}

/**
 * A skill file's instructions: its text after the frontmatter block. Never
 * parses the frontmatter, so a file whose YAML is broken still reads.
 */
export function withoutFrontmatter(text: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(text)
  return (match === null ? text : text.slice(match[0].length)).trim()
}

const hashOf = (text: string): string =>
  sha256Of(new TextEncoder().encode(text))

/** A skill file's text -> its instructions, as the host reads it, and its hash. */
export const skillOf = (file: string, text: string) => ({
  path: file,
  content: withoutFrontmatter(text),
  hash: hashOf(text),
})

/**
 * A command's text as the model reads it: a skill's block (pi's format), or
 * a template with its arguments. `inLane`: the thread works in its own copy,
 * so a skill's paths are the lane's (`/mnt/host`).
 */
export function expandCommand(
  command: CommandSource,
  text: string,
  args: string,
  inLane: boolean,
): CommandRef {
  const where = (p: string) => (inLane ? hostPathInLane(p) : p)
  // pi's name for it: the last part of the qualified name.
  const name = command.name.split(":").at(-1) ?? command.name
  const expanded =
    command.kind === "skill"
      ? expandSkill({
          name,
          file: where(command.file),
          dir: where(command.dir),
          body: withoutFrontmatter(text),
          args,
        })
      : substituteArgs(withoutFrontmatter(text), parseCommandArgs(args))
  return {
    name: command.name,
    kind: command.kind,
    file: command.file,
    hash: hashOf(text),
    expanded,
  }
}

export interface CommandFiles {
  /** Every command pi loaded, labelled by package (ADR-0036). */
  commands(): readonly CommandSource[]
  /** Commands refused for their labels, with why. */
  refusedCommands(): readonly {
    readonly name: string
    readonly reason: string
  }[]
  /**
   * A skill by its qualified name, e.g. `pinetrie:skill:resolve-conflicts`,
   * read now. Null if no command has that name, or its file is unreadable.
   */
  skill(name: string): Promise<ReturnType<typeof skillOf> | null>
  /** `expandCommand` over the command's file as it is now; null if unreadable. */
  expand(
    command: CommandSource,
    args: string,
    inLane: boolean,
  ): Promise<CommandRef | null>
}

const readText = (file: string): Promise<string | null> =>
  readFile(file, "utf8").catch(() => null)

/** The labelled commands, and each one's file read when it is asked for. */
export function commandFiles(labelled: {
  readonly commands: readonly CommandSource[]
  readonly refused: readonly {
    readonly name: string
    readonly reason: string
  }[]
}): CommandFiles {
  return {
    commands: () => labelled.commands,
    refusedCommands: () => labelled.refused,
    async skill(name) {
      const file = resolveCommand(name, labelled.commands)?.file
      if (file === undefined) return null
      const text = await readText(file)
      return text === null ? null : skillOf(file, text)
    },
    async expand(command, args, inLane) {
      const text = await readText(command.file)
      return text === null ? null : expandCommand(command, text, args, inLane)
    },
  }
}
