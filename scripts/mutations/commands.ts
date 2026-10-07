// Mutations for commands (ADR-0036). Run: pnpm mutate scripts/mutations/commands.ts
import type { Mutation } from "../mutate.ts"

const vitest = (path: string) => ["pnpm", "exec", "vitest", "run", path]
const commands = "packages/rules/commands.ts"

export const mutations: readonly Mutation[] = [
  {
    name: "expandSkill drops pi's references line",
    file: commands,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: "\\nReferences are relative to ${input.dir}.\\n",
    to: "\\n",
    command: vitest("packages/rules"),
    expect: "expandSkill: pi's block, byte for byte",
  },
  {
    name: "parseCommand takes a bare /plan",
    file: commands,
    from: '    (parts.length === 2 || (parts.length === 3 && parts[1] === "skill"))',
    to: '    (parts.length >= 1 || (parts.length === 3 && parts[1] === "skill"))',
    command: vitest("packages/rules"),
    expect: "anything else is ordinary text",
  },
  {
    name: "a command does not compel the agent",
    file: "packages/rules/chat.ts",
    from: "    command: command !== null,\n",
    to: "    command: false,\n",
    command: vitest("packages/rules"),
    expect: "it is for the agent, whoever else it names",
  },
  {
    name: "an unknown command is sent as text",
    file: "packages/rules/chat.ts",
    from: '  if (command !== null && "unknown" in command)',
    to: "  if (false)",
    command: vitest("packages/rules"),
    expect: "an unknown command is refused, naming it",
  },
  {
    name: "a host record is written though unchanged",
    file: "packages/rules/records.ts",
    from: "  stored === undefined || !sameJson(spec.encode(record), spec.encode(stored))",
    to: "  true",
    command: vitest("packages/rules"),
    expect: "an unchanged host record is not written again",
  },
  {
    name: "your home directory is mounted into lanes",
    file: "packages/lanes/plan.ts",
    from: "        : isWithin(input.home, root)",
    to: "        : false",
    command: vitest("packages/lanes"),
    expect: "never your home directory, / or pi's agent directory",
  },
  {
    name: "commands pi dropped for their names are not gathered",
    file: "packages/pi/commands.ts",
    from: "  for (const s of lostSkills) if (s !== null) await skill(s, true)\n",
    to: "",
    command: vitest("packages/pi/config.test.ts"),
    expect: "the ones it dropped for their names included",
  },
  {
    name: "completion matches only the package",
    file: "packages/interface/commands.ts",
    from: "    return wanted.every(w => parts.some(p => p.includes(w)))",
    to: '    return wanted.every(w => (parts[0] ?? "").includes(w))',
    command: vitest("packages/interface/commands.test.ts"),
    expect: "a name typed alone finds it in every package",
  },
  {
    name: "an unreadable command is sent as text",
    file: "packages/rules/chat.ts",
    from: '  if (command !== null && "unreadable" in command)',
    to: "  if (false)",
    command: vitest("packages/rules"),
    expect: "a command whose file cannot be read is refused, saying so",
  },
]
