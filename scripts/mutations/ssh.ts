// Mutations for @pinetrie/ssh. Run: pnpm mutate scripts/mutations/ssh.ts
import type { Mutation } from "../mutate.ts"

const unit = ["pnpm", "exec", "vitest", "run", "packages/ssh"]
const patterns = "packages/ssh/patterns.ts"
const names = "packages/ssh/names.ts"
const relay = "packages/ssh/relay-step.ts"
const files = "packages/ssh/lane-files.ts"
const keys = "packages/ssh/keys.ts"
const agent = "packages/ssh/agent.ts"
const settings = "packages/ssh/settings.ts"
const config = "packages/ssh/config.ts"
const host = "packages/ssh/host.ts"

export const mutations: readonly Mutation[] = [
  // ── what a lane hands the host ──
  {
    name: "a negated host pattern does not fail its name",
    file: patterns,
    from: "      if (matchesPattern(name, pattern.slice(1))) return false\n",
    to: "      if (matchesPattern(name, pattern.slice(1))) positive = positive\n",
    command: unit,
    expect: "a negation that matches fails the name, whatever else matches",
  },
  {
    name: "a host name may start with a dash",
    file: names,
    from: "const NAME = /^[A-Za-z0-9._:[\\]][A-Za-z0-9._:[\\]-]*$/\n",
    to: "const NAME = /^[A-Za-z0-9._:[\\]-]+$/\n",
    command: unit,
    expect: "a leading dash, which ssh would read as an option, is refused",
  },
  {
    name: "a token's MAC is not checked",
    file: names,
    from: "  return given.length === expected.length && timingSafeEqual(given, expected)\n",
    to: "  return given.length === expected.length\n",
    command: unit,
    expect: "a lane changed under its MAC is refused",
  },
  // ── the relay ──
  {
    name: "a request the relay does not know is passed on",
    file: relay,
    from: '    case "other":\n      return { kind: "refuse" }\n',
    to: '    case "other":\n      return { kind: "list" }\n',
    command: unit,
    expect: "anything but listing, signing and binding is refused",
  },
  {
    name: "a service key in the person's agent too asks the owner",
    file: relay,
    from: "      if (facts.service.has(key))\n",
    to: "      if (facts.service.has(key) && !facts.personal?.has(key))\n",
    command: unit,
    expect:
      "a service key signs with no question, even when the person holds it too",
  },
  {
    name: "narrowed personal hosts ignore the bound host key",
    file: relay,
    from: '      if (allowed !== "all" && (hostKey === undefined || !allowed.has(hostKey)))\n',
    to: '      if (allowed !== "all" && hostKey === undefined)\n',
    command: unit,
    expect: "a sign for a host key the lane may not use is refused",
  },
  {
    name: "a session binding of another extension's name is taken",
    file: agent,
    from: '    if (name === null || ascii(name) !== SESSION_BIND) return { kind: "other" }\n',
    to: '    if (name === null) return { kind: "other" }\n',
    command: unit,
    expect: "an extension other than session binding is other",
  },
  // ── the lane's files ──
  {
    name: "every keyword reaches a lane's config",
    file: files,
    from: "      if (!isCarried(line.keyword)) continue\n",
    to: "      if (!isCarried(line.keyword) && false) continue\n",
    command: unit,
    expect: "a line that runs something on the host never reaches the lane",
  },
  {
    name: "a service IdentityFile may leave the service folder",
    file: files,
    from: '  return inside === "" || inside.startsWith("..") || path.isAbsolute(inside)\n',
    to: '  return inside === ""\n',
    command: unit,
    expect: "a service path that leaves the folder is dropped",
  },
  {
    name: "a block's IdentityFile is not pinned",
    file: files,
    from: '    if (pinned) lines.push("  IdentitiesOnly yes")\n',
    to: "",
    command: unit,
    expect: "an IdentityFile becomes its public key's copy, pinned",
  },
  {
    name: "narrowed, personal identity may sign for the service file's hosts",
    file: files,
    from: "          : new Set(kept.filter(l => l.marker === null).map(l => l.blob)),\n",
    to: "          : new Set(\n              [...service, ...kept]\n                .filter(l => l.marker === null)\n                .map(l => l.blob),\n            ),\n",
    command: unit,
    expect:
      "narrowed, personal identity may sign only for the person's kept keys",
  },
  {
    name: "a Match block's lines join the block before it",
    file: config,
    from: '    } else if (line.keyword === "match") current = null\n',
    to: "    }\n",
    command: unit,
    expect: "a Match block is skipped to the next Host",
  },
  // ── the host's socket ──
  {
    name: "the relay lists the person's keys first",
    file: host,
    from: "            [...serviceKeys, ...personalKeys].filter(k => {\n",
    to: "            [...personalKeys, ...serviceKeys].filter(k => {\n",
    command: unit,
    expect: "lists service keys first, each key once",
  },
  {
    name: "a personal sign is made whatever the policy says",
    file: host,
    from: "          return may\n",
    to: "          return may || true\n",
    command: unit,
    expect: "a personal sign the policy refuses fails",
  },
  {
    name: "a binding is remembered without its signature checked",
    file: host,
    from: "          if (!isSuccess(checked ?? null)) return FAILURE\n",
    to: "",
    command: unit,
    expect: "a binding the service agent refuses is not remembered",
  },
  {
    name: "the relay never ends its side of a lane's connection",
    file: host,
    from: "        socket.end()\n",
    to: "",
    command: unit,
    timeoutMs: 120_000,
    expect: "serve relays a lane's agent connection, named by its token",
  },
  {
    name: "a cut leaves the lane's connections open",
    file: host,
    from: "      for (const socket of held.get(lane) ?? []) socket.destroy()\n",
    to: "",
    command: unit,
    expect: "cut closes one lane's connections and not another's",
  },
  {
    name: "the broker connects a name the host runs a program for",
    file: "packages/ssh/resolve.ts",
    from: '  if (command !== undefined && command !== "none")\n',
    to: "  if (false)\n",
    command: unit,
    expect: "refuses a name the host's config runs a program for",
  },
  // ── the owner's answers ──
  {
    name: "anyone answers for the owner's ssh",
    file: "packages/rules/access.ts",
    from: "  if (input.owner === null || sender !== input.owner)\n",
    to: "  if (input.owner === null)\n",
    command: ["pnpm", "exec", "vitest", "run", "packages/rules"],
    expect: "only the owner answers",
  },
  {
    name: "an approved lane can be approved again, not revoked",
    file: "packages/rules/access.ts",
    from: '  approved: ["revoke"],\n',
    to: '  approved: ["approve"],\n',
    command: ["pnpm", "exec", "vitest", "run", "packages/rules"],
    expect: "a revoke is a refusal that says it was approved first",
  },
  {
    name: "any refusal cuts the lane's sessions",
    file: "packages/rules/access.ts",
    from: '  if (next.kind === "refused" && prev?.kind === "approved") return "cut"\n',
    to: '  if (next.kind === "refused") return "cut"\n',
    command: ["pnpm", "exec", "vitest", "run", "packages/rules"],
    expect: "a refusal or no answer refuses what waits",
  },
  {
    name: "a starting host leaves lanes waiting",
    file: "packages/rules/access.ts",
    from: '    .filter(r => r.personal?.kind === "waiting")\n',
    to: "    .filter(() => false)\n",
    command: ["pnpm", "exec", "vitest", "run", "packages/rules"],
    expect: "a starting host leaves nothing waiting",
  },
  {
    name: "everyone is offered the owner's answers",
    file: "packages/interface/access-view.ts",
    from: "    answers: isYou ? answersFor(record) : [],\n",
    to: "    answers: answersFor(record),\n",
    command: ["pnpm", "exec", "vitest", "run", "packages/interface"],
    expect: "sees whom the lane waits for, and no answer to give",
  },
  {
    name: "a lane's ssh ask reaches everyone's inbox",
    file: "packages/interface/attention.ts",
    from: "  if (input.owner === me)\n",
    to: "  if (input.owner !== null)\n",
    command: ["pnpm", "exec", "vitest", "run", "packages/interface"],
    expect:
      "a lane waiting on your ssh needs you, its owner, even unfollowed and running",
  },
  // ── the ssh scenario, in a real lane ──
  {
    name: "the relay lists the person's keys first, in a lane",
    file: host,
    from: "            [...serviceKeys, ...personalKeys].filter(k => {\n",
    to: "            [...personalKeys, ...serviceKeys].filter(k => {\n",
    suite: "lanes",
    scenario: "ssh",
    expect: "a lane lists the service key before the personal one",
  },
  {
    name: "a service key is signed for as a personal one, in a lane",
    file: relay,
    from: "      if (facts.service.has(key))\n",
    to: "      if (false && facts.service.has(key))\n",
    suite: "lanes",
    scenario: "ssh",
    expect: "a service signature needs no approval",
  },
  {
    name: "a lane signs with the owner's identity unasked",
    file: "apps/pinetrie/host/work/ssh.ts",
    from: '    if (record.personal?.kind === "approved") return true\n',
    to: "    if (true) return true\n",
    suite: "lanes",
    scenario: "ssh",
    expect: "a personal signature waits for its owner's approval",
  },
  {
    name: "a token that does not check still names a lane",
    file: "packages/ssh/hop-line.ts",
    from: "  if (lane === null) return null\n",
    to: '  if (lane === null) return { kind: "agent", lane: "forged" }\n',
    suite: "lanes",
    scenario: "ssh",
    expect: "a connection with another lane's token gets nothing",
  },
  {
    name: "the host never brokers a connection",
    file: "apps/pinetrie/host/work/ssh.ts",
    from: "    combinedConfig: hasSsh ? combined : null,\n",
    to: "    combinedConfig: null,\n",
    suite: "lanes",
    scenario: "ssh",
    expect: "the broker connects a host's alias from the host",
  },
  {
    name: "a revoke leaves the lane's connections open",
    file: "apps/pinetrie/host/work/ssh.ts",
    from: "        host.cut(lane)\n",
    to: "",
    suite: "lanes",
    scenario: "ssh",
    expect: "a revoke ends the lane's open connection",
  },
  {
    name: "a hop outlives the host's end of its connection",
    file: "packages/ssh/hop.ts",
    from: '    up.once("end", done)\n',
    to: "",
    command: unit,
    timeoutMs: 120_000,
    expect:
      "connect ends when the host cuts its lane, whatever is left of its input",
  },
  // ── keys and settings ──
  {
    name: "a key others can read is a service identity",
    file: keys,
    from: '  if ((files.mode & 0o077) !== 0) return refused("readable")\n',
    to: "",
    command: unit,
    expect: "a key group or others can read is refused, as ssh refuses it",
  },
  {
    name: "an OpenSSH key's cipher is not read",
    file: keys,
    from: '    return cipher === null ? null : ascii(cipher) !== "none"\n',
    to: "    return cipher === null ? null : false\n",
    command: unit,
    expect:
      "an OpenSSH key with cipher none has no passphrase; another cipher has one",
  },
  {
    name: "a project's grant overrides the person declining it",
    file: settings,
    from: "  const declined = own === false || fields.personal === false\n",
    to: "  const declined = false\n",
    command: unit,
    expect: "the user config declines it, whatever the project grants",
  },
  {
    name: "malformed hosts widen personal identity to every host",
    file: settings,
    from: '        { kind: "off", why: "invalid-hosts" }\n',
    to: '        { kind: "on", hosts: "all" }\n',
    command: unit,
    expect: "malformed hosts turn personal identity off, and are refused",
  },
]
