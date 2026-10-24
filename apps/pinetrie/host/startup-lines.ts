// host/startup-lines — the words of the lines a starting host logs about what
// it serves and what it read: the project, the session, the store, each config file and
// what it refused, the model, and where to open the host; and its start's
// checklist (`start-checklist.ts`), drawn or as a line per step. Config words are
// `@pinetrie/interface`'s, shared with the setup page.
// A line about the session's state stays beside what computes it, such as
// `rootsOpenedWords` in `docs.ts`.

import {
  assertNever,
  type ConfigFileState,
  type ConfigOrigin,
  type ConfigRefusal,
  type ThreadId,
} from "@pinetrie/core"
import {
  fileStateWords,
  noModelWords,
  originWords,
  refusalWords,
  repairProgressWords,
  subscriptionWords,
} from "@pinetrie/interface"
import type { ModelLine, SetupSubscription } from "@pinetrie/rules"
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
import {
  type Build,
  type Checklist,
  canBuild,
  type Ended,
  type LaneMachine,
  type StartStep,
  type StartTimes,
  type StartWork,
  stepEstimate,
} from "./start-checklist.ts"

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

/** Who shapes a subscription's requests, and the warning when nothing does; none for a suite's model. */
export function subscriptionLines(
  s: SetupSubscription | null,
): readonly string[] {
  if (s === null) return []
  const words = subscriptionWords(s)
  return [
    line(s.provider, words.line),
    ...(words.warning === null ? [] : [`[host] ${words.warning}`]),
  ]
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

/** A step's name, as the checklist says it. */
export function startStepWords(step: StartStep, machine: LaneMachine): string {
  switch (step) {
    case "lane-machine":
      return machine === "lane-vm" ? "the lane VM" : "Docker"
    case "store":
      return "the store and the session"
    case "project":
      return "the project and its config"
    case "model":
      return "the model"
    case "roots":
      return "the threads the last host left running"
    case "lane-work":
      return "lanes' configs and ssh"
    case "lane-images":
      return "the lane images"
    case "lane-runtime":
      return "the lane runtime"
    case "lanehost":
      return "the lanes' disks and grants"
    case "observer":
      return "the observer"
    case "base-snapshot":
      return "the base snapshot"
    case "agent":
      return "the agent"
    case "listening":
      return "the server"
    default:
      return assertNever(step)
  }
}

/** What a step waits on, as the checklist says it. */
export function workWords(work: StartWork): string {
  switch (work.kind) {
    case "build":
      return buildingWords(work.build)
    case "stopping-left":
      return `stopping ${work.count} ${work.count === 1 ? "container" : "containers"} the last host left`
    default:
      return assertNever(work)
  }
}

function buildingWords(build: Build): string {
  switch (build.kind) {
    case "vm-launcher":
      return "building the lane VM's launcher"
    case "vm-image": {
      const first = [
        ...(build.compile ? ["compiling its builder"] : []),
        ...(build.fetch
          ? ["fetching Alpine's kernel and root, 43 MB, once"]
          : []),
      ]
      return first.length === 0
        ? "building the lane VM's image"
        : `building the lane VM's image: ${first.join(" and ")} first`
    }
    case "image":
      return build.image === "lane"
        ? "building the lane image"
        : build.image === "lanehost"
          ? "building lanehost's image"
          : "building the observer's image"
    case "runtime":
      return "extracting the lane runtime"
    case "base-snapshot":
      return "making the base snapshot"
    case "vm-disk-repair":
      return repairProgressWords("booting-repair", build.progress)
    default:
      return assertNever(build)
  }
}

/** A duration in ms, as a person reads it: `4.2 s` under a minute, else `2:05`. */
export function durationWords(ms: number): string {
  const seconds = Math.max(0, ms) / 1000
  if (seconds < 60) return `${seconds.toFixed(1)} s`
  const whole = Math.round(seconds)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`
}

/** How a step that ended came out, after its name. */
const endedWords = (e: Ended, machine: LaneMachine): string => {
  const name = startStepWords(e.step, machine)
  if (e.kind === "never-ran") return `✗ ${name}: never ran`
  const how =
    e.built !== null ? ", built" : canBuild(e.step) ? ", up to date" : ""
  return `✓ ${name}${how} (${durationWords(e.took)})`
}

/**
 * The checklist as a terminal draws it, one line per step, at `now` (ms,
 * on the events' clock).
 */
export function checklistLines(
  list: Checklist,
  machine: LaneMachine,
  now: number,
): readonly string[] {
  const lines = list.ended.map(e => `  ${endedWords(e, machine)}`)
  const current = list.now
  if (current?.kind === "failed")
    lines.push(`  ✗ ${startStepWords(current.step, machine)}: ${current.why}`)
  else if (current?.kind === "running") {
    const doing =
      current.working === null ? "" : `: ${workWords(current.working)}`
    const estimate = stepEstimate(
      current.step,
      current.built !== null,
      list.times,
    )
    lines.push(
      `  ▸ ${startStepWords(current.step, machine)}${doing} · ${durationWords(now - current.since)} of about ${durationWords(estimate)}`,
    )
  }
  for (const step of list.waiting)
    lines.push(`  · ${startStepWords(step, machine)}`)
  return lines
}

/** A step's end, or a never-ran step, as the line form prints it. */
export const endedLine = (e: Ended, machine: LaneMachine): string =>
  `[host] ${endedWords(e, machine)}`

/** A failed step, as the line form prints it. */
export const failedLine = (
  step: StartStep,
  why: string,
  machine: LaneMachine,
): string => `[host] ✗ ${startStepWords(step, machine)}: ${why}`

/**
 * Work beginning, as the line form prints it; a build in a step with what
 * the step is expected to take when it builds.
 */
export const workingLine = (
  work: StartWork,
  step: StartStep | null,
  times: StartTimes,
): string =>
  step === null || work.kind !== "build"
    ? `[host] ${workWords(work)}`
    : `[host] ${workWords(work)} (about ${durationWords(stepEstimate(step, true, times))})`
