// host/startup-lines — the words of the lines a starting host logs about what
// it serves and what it read: the project, the session, the store, each config file and
// what it refused, the model, and where to open the host. Config words are
// `@pinetrie/interface`'s, shared with the setup page.
// A line about the session's state stays beside what computes it, such as
// `rootsOpenedWords` in `docs.ts`.

import type {
  ConfigFileState,
  ConfigOrigin,
  ConfigRefusal,
  ModelLine,
} from "@pinetrie/core"
import {
  fileStateWords,
  noModelWords,
  originWords,
  refusalWords,
} from "@pinetrie/interface"

import type {
  DroppedIdentity,
  PersonalOff,
  ServiceKeyCheck,
  ServiceKeyRefusal,
  SshSettings,
} from "@pinetrie/ssh"
import type { HostCommand, StoreChoice } from "./invocation.ts"
import type { OpenedPlan } from "./sessions.ts"

/** `[host] label` padded so the values line up. */
const line = (label: string, value: string): string =>
  `[host] ${label.padEnd(11)} ${value}`

export const projectLine = (root: string): string => line("project", root)

/** `file` under `home` as `~/…`; anywhere else, as it is. */
export const homePath = (file: string, home: string): string =>
  file === home
    ? "~"
    : file.startsWith(`${home}/`)
      ? `~/${file.slice(home.length + 1)}`
      : file

/**
 * Which session the host serves; for a new one whose base name a gone
 * folder had, where that was and the command that attaches it.
 */
export function sessionLines(
  plan: OpenedPlan,
  home: string,
  command: HostCommand,
): readonly string[] {
  const { name, path } = plan.entry
  switch (plan.kind) {
    case "found":
      return [line("session", `${name} (${homePath(path, home)})`)]
    case "attached":
      return [
        line("session", `${name} (attached, was ${homePath(plan.from, home)})`),
      ]
    case "new": {
      const moved = plan.movedFrom
      return [
        line("session", `${name} (new)`),
        ...(moved === null
          ? []
          : [
              `[host]   ${moved.name} was at ${homePath(moved.path, home)}, which is gone: PINETRIE_SESSION=${moved.name} pnpm ${command} ${homePath(path, home)} attaches it`,
            ]),
      ]
    }
  }
}

export const storeLine = (store: StoreChoice): string =>
  line(
    "store",
    store.from === "PINETRIE_STORE"
      ? `${store.file} (PINETRIE_STORE)`
      : store.file,
  )

/** What the host read of its config: a line per layer's file, then one per refusal. */
export function reportLines(report: {
  readonly files: readonly {
    readonly file: string
    readonly state: ConfigFileState
  }[]
  readonly refusals: readonly ConfigRefusal[]
}): readonly string[] {
  return [
    ...report.files.map(f => line("config", fileStateWords(f.file, f.state))),
    ...report.refusals.map(r => `[host] ${refusalWords(r)}`),
  ]
}

/**
 * The agent's model and where it came from (`origins` null for a named or
 * scripted model, which only the suites run), or why there is none; and its
 * tools.
 */
export function agentReadyLine(agent: {
  readonly model: ModelLine
  readonly origins: readonly ConfigOrigin[] | null
  /** The directory tools work in; null with tools off. */
  readonly tools: string | null
}): string {
  const { model, origins } = agent
  const which =
    model.kind === "none"
      ? `no model: ${noModelWords(model.why, model.named)}`
      : `model ${model.label}${origins === null ? "" : ` (${originWords(origins)})`}`
  const tools = agent.tools === null ? "off" : `on, in ${agent.tools}`
  return `[host] agent ready — ${which}; tools ${tools}`
}

/** Where the setup page is, said when the host has no model. */
export const setupLine = (url: string): string => line("setup", `${url}#setup`)

export const listeningLine = (url: string): string => line("listening", url)

export const openLine = (invite: string): string => line("open", invite)

const PERSONAL_OFF: Readonly<Record<PersonalOff, string | null>> = {
  // Neither config asked for it: nothing to say.
  "not-granted": null,
  declined: "your ssh identity: declined in your config",
  forbidden: "your ssh identity: off, since the machine's config forbids it",
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
  readonly checks: readonly ServiceKeyCheck[]
  readonly failed: readonly { readonly name: string; readonly said: string }[]
  /** The service identities the agent holds. */
  readonly added: readonly string[]
  readonly dropped: readonly DroppedIdentity[]
  readonly hasSsh: boolean
  readonly hasAgent: boolean
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
