// pi/commands — every skill and prompt template pi loaded, as commands to be
// labelled, and a command's file as the model reads it.
//
// pi keeps the first skill or template of each name and drops the rest,
// with a `collision` diagnostic naming the loser's file. A command is named
// by its package, so each of those is reachable too: this loads them again
// by file. What a command's label may come from is read from its package's
// root: Claude's `.claude-plugin/plugin.json`, and `package.json`.

import { readFile } from "node:fs/promises"
import path from "node:path"
import { type ConfigLayer, isWithin, laneSkillPath } from "@pinetrie/core"
import {
  type CommandRef,
  type CommandSource,
  expandSkill,
  type GatheredCommand,
  resolveCommand,
} from "@pinetrie/rules"
import {
  loadPromptTemplates,
  loadSkillsFromDir,
  type openLoader,
  parseCommandArgs,
  substituteArgs,
} from "./deep.ts"
import { blobSha256 } from "./images.ts"
import { readManifest } from "./manifest.ts"

type Loader = Awaited<ReturnType<typeof openLoader>>
type Skill = ReturnType<Loader["getSkills"]>["skills"][number]
type Template = ReturnType<Loader["getPrompts"]>["prompts"][number]
type Diagnostic = ReturnType<Loader["getSkills"]>["diagnostics"][number]

/** What the config listed for pi's loader: package folders, and folders of skills or prompts with the layer that listed each. */
export interface Listing {
  readonly packages: readonly string[]
  readonly loose: readonly {
    readonly path: string
    readonly layer: ConfigLayer
  }[]
}

/** What a skill or template came from, as a command needs it. */
interface Origin {
  /** The listed package's path as written, else the listing layer, else `pinetrie`. */
  readonly source: string
  readonly scope: string
  /** Its package's root, when it came from a package. */
  readonly root: string | null
}

/** The longest of `roots` that holds `file`. */
const holding = (roots: readonly string[], file: string): string | null =>
  roots
    .filter(r => isWithin(file, r))
    .reduce<string | null>(
      (best, r) => (best === null || r.length > best.length ? r : best),
      null,
    )

/**
 * Where `file` came from: a listed package, whose path is its source and
 * root; pine·trie's own skills; or a listed folder, labelled by the layer
 * that listed it. Read from what pine·trie listed, never from pi's record of
 * it: pi records a package's skills with no root, and an added path's as
 * `temporary`.
 */
export function commandOrigin(
  file: string,
  listing: Listing,
  pinetrieSkills: string,
): Origin {
  if (pinetrieSkills !== "" && isWithin(file, pinetrieSkills))
    return { source: "pinetrie", scope: "pinetrie", root: null }
  const pkg = holding(listing.packages, file)
  if (pkg !== null) return { source: pkg, scope: "user", root: pkg }
  const folder = holding(
    listing.loose.map(f => f.path),
    file,
  )
  const layer =
    listing.loose.find(f => f.path === folder)?.layer ?? ("user" as const)
  return { source: layer, scope: layer, root: null }
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
        : (await readManifest(path.join(root, ".claude-plugin", "plugin.json")))
            .name,
    packageName:
      root === null
        ? null
        : (await readManifest(path.join(root, "package.json"))).name,
    scope: origin.scope,
  }
}

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
function loserTemplate(d: Diagnostic, cwd: string, configDir: string) {
  const file = d.collision?.loserPath
  if (file === undefined) return null
  return (
    loadPromptTemplates({
      cwd,
      agentDir: configDir,
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
 * their names included, as commands to be labelled, each by where pine·trie
 * listed it (`commandOrigin`).
 */
export async function gatherCommands(
  loader: Loader,
  where: { readonly cwd: string; readonly configDir: string },
  listing: Listing,
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
    .map(d => loserTemplate(d, where.cwd, where.configDir))

  const out: GatheredCommand[] = []
  const skill = async (s: Skill) => {
    const origin = commandOrigin(s.filePath, listing, pinetrieSkills)
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
  const template = async (t: Template) => {
    const origin = commandOrigin(t.filePath, listing, pinetrieSkills)
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
  for (const s of skills.skills) await skill(s)
  for (const s of lostSkills) if (s !== null) await skill(s)
  for (const t of prompts.prompts) await template(t)
  for (const t of lostTemplates) if (t !== null) await template(t)
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
  blobSha256(new TextEncoder().encode(text))

/** A skill file's text -> its instructions, as the host reads it, and its hash. */
export const parseSkill = (file: string, text: string) => ({
  path: file,
  content: withoutFrontmatter(text),
  hash: hashOf(text),
})

/**
 * A command's text as the model reads it: a skill's block (pi's format), or
 * a template with its arguments. `inLane`: the thread works in its own copy,
 * so a skill's paths are the lane's (`laneSkillPath`: in its copy of
 * `project`, else under `/mnt/host`).
 */
export function expandCommand(
  command: CommandSource,
  text: string,
  args: string,
  inLane: boolean,
  project: string | null = null,
): CommandRef {
  const where = (p: string) => (inLane ? laneSkillPath(p, project) : p)
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
  /** Every command pi loaded, labelled by package. */
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
  skill(name: string): Promise<ReturnType<typeof parseSkill> | null>
  /** `expandCommand` over the command's file as it is now; null if unreadable. */
  expand(
    command: CommandSource,
    args: string,
    inLane: boolean,
  ): Promise<CommandRef | null>
}

const readText = (file: string): Promise<string | null> =>
  readFile(file, "utf8").catch(() => null)

/** The labelled commands, and each one's file read when it is asked for; `project` places a skill in a lane (`laneSkillPath`). */
export function commandFiles(
  labelled: {
    readonly commands: readonly CommandSource[]
    readonly refused: readonly {
      readonly name: string
      readonly reason: string
    }[]
  },
  project: string | null = null,
): CommandFiles {
  return {
    commands: () => labelled.commands,
    refusedCommands: () => labelled.refused,
    async skill(name) {
      const file = resolveCommand(name, labelled.commands)?.file
      if (file === undefined) return null
      const text = await readText(file)
      return text === null ? null : parseSkill(file, text)
    },
    async expand(command, args, inLane) {
      const text = await readText(command.file)
      return text === null
        ? null
        : expandCommand(command, text, args, inLane, project)
    },
  }
}
