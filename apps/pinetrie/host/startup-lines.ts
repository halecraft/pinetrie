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
  ThreadId,
} from "@pinetrie/core"
import {
  fileStateWords,
  noModelWords,
  originWords,
  refusalWords,
} from "@pinetrie/interface"

import type {
  AllowedHost,
  DroppedIdentity,
  OutsideRefusal,
  PersonalOff,
  PersonalSsh,
  ServiceKeyCheck,
  ServiceKeyRefusal,
} from "@pinetrie/ssh"
import type { StoreChoice } from "./invocation.ts"
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

/** Which session the host serves: found, attached and where it was, or new. */
export function sessionLines(
  plan: OpenedPlan,
  home: string,
): readonly string[] {
  const { name, path } = plan.entry
  switch (plan.kind) {
    case "found":
      return [line("session", `${name} (${homePath(path, home)})`)]
    case "attached":
      return [
        line("session", `${name} (attached, was ${homePath(plan.from, home)})`),
      ]
    case "new":
      return [line("session", `${name} (new)`)]
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
  readonly personal: PersonalSsh
  readonly checks: readonly ServiceKeyCheck[]
  readonly failed: readonly { readonly name: string; readonly said: string }[]
  /** The service identities the agent holds. */
  readonly added: readonly string[]
  readonly dropped: readonly DroppedIdentity[]
  /** The allowed names and wildcards that kept no line of the person's `known_hosts`. */
  readonly unmatched: readonly AllowedHost[]
  readonly hasSsh: boolean
  readonly hasAgent: boolean
}): readonly string[] {
  const { personal } = facts
  const holds = [
    ...(personal.kind === "on"
      ? [
          `your identity (on approval${personal.hosts === "all" ? "" : `; hosts: ${personal.hosts.join(", ")}`})`,
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
    ...(personal.kind === "on" ? facts.unmatched.map(unmatchedLine) : []),
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

const unmatchedLine = (host: AllowedHost): string =>
  host.kind === "name" && host.checkedAs !== null
    ? `[host] lanes.ssh.hosts: ${host.name} has no key in your known_hosts (ssh checks it as ${host.checkedAs}), so your identity signs for it nowhere; ssh there once from this machine`
    : `[host] lanes.ssh.hosts: ${host.kind === "name" ? host.name : host.pattern} matches no line of your known_hosts, so your identity signs for it nowhere`

/** What the host says when a lane's personal signature is refused for a host not allowed. */
export const sshOutsideLine = (
  lane: ThreadId,
  refusal: OutsideRefusal,
): string =>
  `[host] lane ${lane}: your ssh identity can't sign for ${refusal.host ?? "a host"}${refusal.key === null ? "" : ` (${refusal.key})`}: its host key is outside lanes.ssh.hosts`

/** A start-up phase that took a second or more, worded; a quicker one says nothing. */
const startupPhaseLine = (what: string, ms: number): string | null =>
  ms < 1000 ? null : `[host] starting: ${what} took ${Math.round(ms)} ms`

/**
 * A stopwatch over a host's start: each `lap(what)` logs the time since the
 * last lap, or since it was made, when that is a second or more
 * (`startupPhaseLine`).
 */
export function startupLaps(
  log: (line: string) => void,
  clock: () => number = () => performance.now(),
): (what: string) => void {
  let last = clock()
  return what => {
    const now = clock()
    const said = startupPhaseLine(what, now - last)
    if (said !== null) log(said)
    last = now
  }
}
