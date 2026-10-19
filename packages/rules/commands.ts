// commands — your pi skills and prompt templates, as `/package:name`
// commands.

import { Type } from "typebox"
import { choiceSchema, decodeRecord, fixedKey } from "./decode.ts"
import type { RecordSpec } from "./records.ts"

/** The one `pinetrie.commands` value's key: what the host's pi loaded. */
export const COMMANDS_KEY = "commands"

const COMMAND_KINDS = ["skill", "prompt"] as const

const CommandSummarySchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  kind: choiceSchema(COMMAND_KINDS),
  description: Type.String(),
  argumentHint: Type.Union([Type.String(), Type.Null()]),
})

const CommandsRecordSchema = Type.Object({
  commands: Type.Array(CommandSummarySchema),
})

/** A command runs a pi skill or expands a pi prompt template. */
type CommandKind = (typeof COMMAND_KINDS)[number]

/** A command as people see it: in the composer's completion and on a sent message. */
export interface CommandSummary {
  /** Qualified, without the slash: "duane:comments" or "duane:skill:plan". */
  readonly name: string
  readonly kind: CommandKind
  readonly description: string
  readonly argumentHint: string | null
}

/** What a command message stores: which file it ran, and what it expanded to. */
export interface CommandRef {
  readonly name: string
  readonly kind: CommandKind
  /** The skill's or template's file on the host: its identity. */
  readonly file: string
  /** sha256 of the file's text when it was sent. */
  readonly hash: string
  /** What the model reads in place of the typed text. */
  readonly expanded: string
}

/** The commands the host's pi loaded, as people see them. */
interface CommandsRecord {
  readonly commands: readonly CommandSummary[]
}

/** What the host's pi loaded, at its one key. */
export const COMMANDS: RecordSpec<
  CommandsRecord,
  typeof COMMANDS_KEY,
  "session"
> = {
  namespace: "pinetrie.commands",
  home: "session",
  keyOf: () => COMMANDS_KEY,
  encode: r => ({ commands: r.commands.map(c => ({ ...c })) }),
  decode: (contents, key) =>
    decodeRecord(
      CommandsRecordSchema,
      contents,
      fixedKey(COMMANDS_KEY, key),
      r => r,
    ),
}

/** A command as pi loaded it, before it has a label: what the host gathers. */
export interface GatheredCommand {
  readonly kind: CommandKind
  /** pi's name for it, unqualified: "plan". */
  readonly name: string
  readonly description: string
  readonly argumentHint: string | null
  readonly file: string
  /** The directory a skill's relative paths resolve against. */
  readonly dir: string
  /** The directory mounted for it in lanes: its package's root, else `dir`. */
  readonly root: string
  /** Where it came from: a listed package's path, a listing layer, or `pinetrie`. What a rename is keyed by. */
  readonly source: string
  /** What its label may come from, most preferred first. */
  readonly names: {
    /** pinetrie's own skills. */
    readonly pinetrie: boolean
    /** `.claude-plugin/plugin.json`'s `name`, as Claude names the plugin. */
    readonly plugin: string | null
    /** `package.json`'s `name`, scope included. */
    readonly packageName: string | null
    /** The layer that listed a loose skill's or template's folder: "user", "project", … */
    readonly scope: string
  }
}

/** A command as the host holds it: its summary, and where its text is. */
export interface CommandSource extends CommandSummary {
  readonly file: string
  readonly dir: string
  readonly root: string
}

/** A package name without its scope: `@zenspc/pi-pstack` → `pi-pstack`. */
const unscoped = (name: string): string =>
  name.startsWith("@") ? (name.split("/")[1] ?? name) : name

/** The label a command's package gets, before clashes are checked. */
function labelOf(
  c: GatheredCommand,
  renames: Readonly<Record<string, string>>,
): string {
  const renamed = renames[c.source]
  if (renamed !== undefined) return renamed
  if (c.names.pinetrie) return "pinetrie"
  if (c.names.plugin !== null && c.names.plugin !== "") return c.names.plugin
  if (c.names.packageName !== null && c.names.packageName !== "")
    return unscoped(c.names.packageName)
  return c.names.scope
}

/** A command's qualified name, without the slash. */
const qualified = (label: string, kind: CommandKind, name: string): string =>
  kind === "skill" ? `${label}:skill:${name}` : `${label}:${name}`

/**
 * Every command under its package's label, and what is refused.
 * - A label is `commands.names`' rename (keyed by the command's source: a
 *   listed package's path), else `pinetrie` for pinetrie's own, else
 *   `plugin.json`'s name, else the package name without its scope, else the
 *   layer that listed its folder.
 * - Two sources with one label are refused together: a person renames one,
 *   rather than load order choosing.
 * - Two commands with one qualified name within a source are refused too.
 */
export function labelCommands(
  gathered: readonly GatheredCommand[],
  renames: Readonly<Record<string, string>>,
): {
  readonly commands: readonly CommandSource[]
  readonly refused: readonly {
    readonly name: string
    readonly reason: string
  }[]
} {
  const sourcesOf = new Map<string, Set<string>>()
  for (const c of gathered) {
    const label = labelOf(c, renames)
    const sources = sourcesOf.get(label) ?? new Set<string>()
    sources.add(c.source)
    sourcesOf.set(label, sources)
  }
  const refused: { name: string; reason: string }[] = []
  for (const [label, sources] of sourcesOf)
    if (sources.size > 1)
      refused.push({
        name: `${label}:`,
        reason: `the label ${label} is claimed by ${[...sources].join(" and ")}: rename one in commands.names`,
      })
  const named = gathered
    .filter(c => (sourcesOf.get(labelOf(c, renames))?.size ?? 0) === 1)
    .map(
      (c): CommandSource => ({
        name: qualified(labelOf(c, renames), c.kind, c.name),
        kind: c.kind,
        description: c.description,
        argumentHint: c.argumentHint,
        file: c.file,
        dir: c.dir,
        root: c.root,
      }),
    )
  const counts = new Map<string, number>()
  for (const c of named) counts.set(c.name, (counts.get(c.name) ?? 0) + 1)
  for (const [name, count] of counts)
    if (count > 1)
      refused.push({
        name,
        reason: `${count} commands in one package are named ${name}`,
      })
  return {
    commands: named.filter(c => counts.get(c.name) === 1),
    refused,
  }
}

/**
 * A message's command, when its first word is one: `/` then two
 * `:`-separated parts (a prompt), or three with `skill` in the middle (a
 * skill). Anything else, `/etc/hosts` included, is ordinary text.
 */
export function parseCommand(
  text: string,
): { readonly name: string; readonly args: string } | null {
  const match = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text.trim())
  const token = match?.[1]
  if (token === undefined) return null
  const parts = token.split(":")
  const valid =
    parts.every(p => p !== "") &&
    (parts.length === 2 || (parts.length === 3 && parts[1] === "skill"))
  return valid ? { name: token, args: (match?.[2] ?? "").trim() } : null
}

/** The command a qualified name names, or null. */
export const resolveCommand = <C extends CommandSummary>(
  name: string,
  commands: readonly C[],
): C | null => commands.find(c => c.name === name) ?? null

/**
 * A skill as the model reads it: pi's block, byte for byte, as
 * `_expandSkillCommand` in pi-coding-agent's `dist/core/agent-session.js`
 * builds it. `file` and `dir` are already in the thread's terms: host paths,
 * or lane paths for a thread of its own.
 */
export const expandSkill = (input: {
  /** pi's name for the skill, unqualified. */
  readonly name: string
  readonly file: string
  readonly dir: string
  /** The skill's text after its frontmatter, trimmed. */
  readonly body: string
  readonly args: string
}): string => {
  const block = `<skill name="${input.name}" location="${input.file}">\nReferences are relative to ${input.dir}.\n\n${input.body}\n</skill>`
  return input.args === "" ? block : `${block}\n\n${input.args}`
}

/** Whether `label` can label a package's commands: `commands.names`' values. */
export const isCommandLabel = (label: string): boolean =>
  /^[A-Za-z0-9._-]+$/.test(label)
