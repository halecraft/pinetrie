// host/startup-lines — the words of the lines a starting host logs about what
// it serves and what it read: the project, the store, the user config (and a
// project's broken `pinetrie.json`), the model, and where to open the host.
// A line about the session's state stays beside what computes it, such as
// `rootsOpenedWords` in `docs.ts`.

import type { ConfigRead } from "@pinetrie/lanes"
import type { FieldSource, ModelOrigin } from "@pinetrie/pi"
import type {
  DroppedIdentity,
  PersonalOff,
  ServiceKeyCheck,
  ServiceKeyRefusal,
  SshSettingRefusal,
  SshSettings,
} from "@pinetrie/ssh"
import type { StoreChoice } from "./invocation.ts"

/** `[host] label` padded so the values line up. */
const line = (label: string, value: string): string =>
  `[host] ${label.padEnd(11)} ${value}`

export const projectLine = (root: string): string => line("project", root)

export const storeLine = (store: StoreChoice): string =>
  line(
    "store",
    store.from === "PINETRIE_STORE"
      ? `${store.file} (PINETRIE_STORE)`
      : store.file,
  )

const brokenWords = (file: string, reason: string): string =>
  `${file} is broken, so none of it applies: ${reason}`

/** The user config: read, missing or broken. */
export function configLine(file: string, read: ConfigRead): string {
  switch (read.kind) {
    case "read":
      return line("config", file)
    case "missing":
      return line("config", `${file} (none)`)
    case "broken":
      return line("config", brokenWords(file, read.reason))
  }
}

/** A project's config file that exists but could not be read or parsed. */
export const brokenConfigLine = (file: string, reason: string): string =>
  `[host] ${brokenWords(file, reason)}`

// `server.ts` is the only caller that overrides a configured model, from
// these variables.
const OVERRIDES = {
  provider: "PINETRIE_PROVIDER",
  model: "PINETRIE_MODEL",
} as const

/**
 * Where a configured model's provider and model came from; null for a named
 * or scripted model, which only the suites run.
 */
export function originWords(origin: ModelOrigin): string | null {
  if (origin.kind !== "configured") return null
  const { provider, model } = origin
  if (provider.kind === "override" && model.kind === "override")
    return `${OVERRIDES.provider}, ${OVERRIDES.model}`
  if (
    provider.kind === "settings" &&
    model.kind === "settings" &&
    provider.file === model.file
  )
    return `from ${provider.file}`
  const say = (field: "provider" | "model", from: FieldSource) =>
    from.kind === "override" ? OVERRIDES[field] : `${field} from ${from.file}`
  return `${say("provider", provider)}; ${say("model", model)}`
}

export function agentReadyLine(agent: {
  readonly label: string
  readonly origin: ModelOrigin
  /** The directory tools work in; null with tools off. */
  readonly tools: string | null
}): string {
  const origin = originWords(agent.origin)
  const model = origin === null ? agent.label : `${agent.label} (${origin})`
  const tools = agent.tools === null ? "off" : `on, in ${agent.tools}`
  return `[host] agent ready — model ${model}; tools ${tools}`
}

export const listeningLine = (url: string): string => line("listening", url)

export const openLine = (invite: string): string => line("open", invite)

const PERSONAL_OFF: Readonly<Record<PersonalOff, string | null>> = {
  // Neither config asked for it: nothing to say.
  "not-granted": null,
  declined: "your ssh identity: declined in your config",
  "invalid-hosts":
    "your ssh identity: off, since lanes.ssh.hosts is not a list of host patterns",
  "no-owner":
    "your ssh identity: off, since your config names no owner (owner: your email) to approve it",
  "no-agent":
    "your ssh identity: off, since this host has no ssh agent (SSH_AUTH_SOCK)",
}

const KEY_REFUSED: Readonly<Record<ServiceKeyRefusal, string>> = {
  readable: "group or others can read it (chmod 600 it)",
  passphrase: "it has a passphrase, which nobody is there to type",
  "no-pub": "no public key beside it",
  "not-a-key": "it is not a private key",
}

const DROPPED: Readonly<Record<DroppedIdentity["why"], string>> = {
  "outside-folder": "it is outside the service folder",
  relative: "ssh reads a relative path where it runs",
  token: "it names a token only ssh expands, per connection",
  "no-pub": "no public key beside it",
}

/** What a starting host says of lanes' ssh: what they hold, and each thing it refused. */
export function sshLines(facts: {
  readonly settings: SshSettings
  readonly refusedSettings: readonly SshSettingRefusal[]
  readonly checks: readonly ServiceKeyCheck[]
  readonly failed: readonly { readonly name: string; readonly said: string }[]
  /** The service identities the agent holds. */
  readonly added: readonly string[]
  readonly dropped: readonly DroppedIdentity[]
  readonly hasSsh: boolean
  readonly hasAgent: boolean
  /** The user config's file, which the settings are in. */
  readonly file: string
}): readonly string[] {
  const { personal, approvalSeconds } = facts.settings
  const holds = [
    ...(personal.kind === "on"
      ? [
          `your identity (on approval, ${approvalSeconds} s${personal.hosts === "all" ? "" : `; hosts: ${personal.hosts.join(", ")}`})`,
        ]
      : []),
    ...(facts.added.length === 0
      ? []
      : [`service identities ${facts.added.join(", ")}`]),
  ]
  const off = personal.kind === "off" ? PERSONAL_OFF[personal.why] : null
  return [
    ...facts.refusedSettings.map(
      r => `[host] ${r.setting} in ${facts.file} is not taken: ${r.written}`,
    ),
    ...(holds.length === 0 ? [] : [`[host] lanes' ssh: ${holds.join(", ")}`]),
    ...(off === null ? [] : [`[host] ${off}`]),
    ...facts.checks.flatMap(c =>
      c.kind === "refused"
        ? [
            `[host] ssh service key ${c.name} is not used: ${KEY_REFUSED[c.why]}`,
          ]
        : [],
    ),
    ...facts.failed.map(
      f =>
        `[host] ssh service key ${f.name} is not used: ssh-add said ${f.said}`,
    ),
    ...facts.dropped.map(
      d =>
        `[host] ${d.side === "service" ? "the service" : "your"} ssh config's IdentityFile ${d.file} is not given to lanes: ${DROPPED[d.why]}`,
    ),
    ...(holds.length > 0 && !facts.hasSsh
      ? [
          "[host] this host has no ssh: lanes connect directly, without your ssh config's names",
        ]
      : []),
    ...(holds.length > 0 && !facts.hasAgent
      ? [
          "[host] this host has no ssh-agent: no service identities, and narrowed hosts refuse your identity",
        ]
      : []),
  ]
}
