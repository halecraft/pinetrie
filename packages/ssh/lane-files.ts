// ssh/lane-files — what every lane is given at `/pinetrie-ssh`: an ssh config
// made from the service folder's and the person's, the host keys it may
// trust, and the public keys its `IdentityFile`s point to. Built from typed
// lines, so only `CARRIED` keywords and pine·trie's own reach a lane.

import { createHash, createHmac } from "node:crypto"
import path from "node:path"
import {
  configPath,
  parseSshConfig,
  type SshBlock,
  type SshLine,
} from "./config.ts"
import type { SshName } from "./names.ts"
import { type HostPattern, matchesPattern } from "./patterns.ts"

/** Where the lane's files are mounted. */
export const LANE_SSH_DIR = "/pinetrie-ssh"

/**
 * A pattern of `lanes.ssh.hosts`, a name carrying the name ssh checks its
 * host's key under, as the host's `ssh -G` resolved it: null where the host
 * has no ssh, or `ssh -G` failed.
 */
export type AllowedHost =
  | Exclude<HostPattern, { readonly kind: "name" }>
  | {
      readonly kind: "name"
      readonly name: SshName
      readonly checkedAs: string | null
    }

export type AllowedHosts = "all" | readonly AllowedHost[]

/**
 * The keywords a lane's config carries, each with ssh's own spelling for the
 * line written. Anything else, `ProxyCommand`, `LocalCommand` and `Match`
 * above all, runs or decides on the host and is not the lane's to read.
 */
const CARRIED = {
  hostname: "HostName",
  port: "Port",
  user: "User",
  hostkeyalias: "HostKeyAlias",
  proxyjump: "ProxyJump",
  identityfile: "IdentityFile",
  identitiesonly: "IdentitiesOnly",
  forwardagent: "ForwardAgent",
  serveraliveinterval: "ServerAliveInterval",
  serveralivecountmax: "ServerAliveCountMax",
} as const
type CarriedKeyword = keyof typeof CARRIED

const isCarried = (k: string): k is CarriedKeyword => Object.hasOwn(CARRIED, k)

/** The folders a config's paths are read against. */
interface SshDirs {
  readonly home: string
  /** The service folder: where a relative service `IdentityFile` is. */
  readonly service: string
}

export type ConfigSide = "service" | "personal"

/** Why an `IdentityFile` did not reach the lane. */
export type DroppedWhy =
  /** A service `IdentityFile` that resolves outside the service folder. */
  | "outside-folder"
  /** A relative personal path, which ssh resolves where it is run. */
  | "relative"
  /** A token only ssh can expand for one connection (`%h`, `%r`). */
  | "token"
  /** No public key beside it. */
  | "no-pub"

export interface DroppedIdentity {
  readonly side: ConfigSide
  readonly file: string
  readonly why: DroppedWhy
}

type IdentityRef =
  | { readonly kind: "path"; readonly path: string }
  | { readonly kind: "dropped"; readonly why: Exclude<DroppedWhy, "no-pub"> }

/**
 * Where an `IdentityFile` argument names, as the host reads it: `%d` is the
 * home directory, and the rest as `configPath` reads a path. A relative
 * personal path is dropped, since ssh resolves it where it runs; a relative
 * service path is in the service folder, and must stay there.
 */
export function identityRef(
  arg: string,
  side: ConfigSide,
  dirs: SshDirs,
): IdentityRef {
  if (/%[^d%]/.test(arg)) return { kind: "dropped", why: "token" }
  const p = arg.replaceAll("%d", dirs.home).replaceAll("%%", "%")
  if (side === "personal")
    return p === "~" || p.startsWith("~/") || path.isAbsolute(p)
      ? { kind: "path", path: configPath(p, dirs.home, dirs.home) }
      : { kind: "dropped", why: "relative" }
  const resolved = configPath(p, dirs.service, dirs.home)
  const inside = path.relative(dirs.service, resolved)
  return inside === "" || inside.startsWith("..") || path.isAbsolute(inside)
    ? { kind: "dropped", why: "outside-folder" }
    : { kind: "path", path: resolved }
}

/** Every private key path the configs name: the host reads each one's `.pub`. */
export function identityPaths(
  configs: {
    readonly service: string | null
    readonly personal: string | null
  },
  dirs: SshDirs,
): readonly string[] {
  const paths = new Set<string>()
  const add = (text: string | null, side: ConfigSide) => {
    for (const block of text === null ? [] : parseSshConfig(text))
      for (const line of block.lines)
        if (line.keyword === "identityfile")
          for (const arg of line.args) {
            const ref = identityRef(arg, side, dirs)
            if (ref.kind === "path") paths.add(ref.path)
          }
  }
  add(configs.service, "service")
  add(configs.personal, "personal")
  return [...paths]
}

export interface SshSources {
  /** The service folder's config, its `Include`s in place; null if absent. */
  readonly service: string | null
  /** `~/.ssh/config`, its `Include`s in place; null if absent. */
  readonly personal: string | null
  /** The public key line beside each path `identityPaths` named. */
  readonly pubs: ReadonlyMap<string, string>
  readonly knownHosts: {
    readonly service: string | null
    readonly personal: string | null
  }
}

/** What the relay knows of host keys: which personal identity may sign for. */
export interface HostKeyFacts {
  /** Key blobs, base64; `"all"` when personal hosts are not narrowed. */
  readonly personal: "all" | ReadonlySet<string>
  /**
   * A name for each key a line of either file names in clear, kept for the
   * lane or not: the host's own, for wording a request or a refusal.
   */
  readonly names: ReadonlyMap<string, string>
}

interface LaneSshFiles {
  readonly config: string
  readonly knownHosts: string
  /** File name under `keys/` → public key line. */
  readonly keys: ReadonlyMap<string, string>
  readonly hostKeys: HostKeyFacts
  readonly dropped: readonly DroppedIdentity[]
  /** The allowed names and wildcards that kept no line of the person's `known_hosts`. */
  readonly unmatched: readonly AllowedHost[]
}

/** The public key file a lane is given for a key: named by what it holds. */
export const keyFileName = (pub: string): string =>
  `${createHash("sha256").update(pub.trim()).digest("hex").slice(0, 32)}.pub`

const quoted = (arg: string): string =>
  /^[^\s"'#\\]+$/.test(arg) ? arg : `"${arg.replaceAll(/["\\]/g, "\\$&")}"`

/**
 * A lane's files.
 * - Every `Host` block of the service config, then of the person's when
 *   personal identity is on (`allowed` not null), keeping only `CARRIED`
 *   lines: ssh keeps a
 *   setting's first value, so the service's wins, and `IdentityFile`s add
 *   up, the service's first.
 * - An `IdentityFile` becomes its public key's copy under `keys/`, and a
 *   block keeping one says `IdentitiesOnly yes`, in place of any it
 *   carried, so an agent holding many keys does not use up the server's
 *   tries.
 * - Every personal block is carried, narrowed or not: a block of patterns
 *   cannot be told apart from the hosts it would serve, and its defaults
 *   (`Host *`) serve the allowed ones too. The relay decides by key.
 * - `connect` is the hop's command for `ProxyCommand`, as shell text, in
 *   the last `Host *` alone (its `%` doubled, which ssh would read as a
 *   token), so a block's `ProxyJump`, which comes first, still wins, as it
 *   does on the host. Null where the host cannot broker: then lanes connect
 *   directly.
 */
export function planLaneSsh(
  sources: SshSources,
  allowed: AllowedHosts | null,
  dirs: SshDirs,
  connect: string | null,
): LaneSshFiles {
  const keys = new Map<string, string>()
  const dropped: DroppedIdentity[] = []

  const render = (block: SshBlock, side: ConfigSide): string[] => {
    const lines: string[] = []
    let pinned = false
    let only: string | null = null
    for (const line of block.lines) {
      if (!isCarried(line.keyword)) continue
      if (line.keyword === "identitiesonly") {
        only = `  IdentitiesOnly ${line.args.map(quoted).join(" ")}`
        continue
      }
      if (line.keyword === "identityfile") {
        for (const file of identityFiles(
          line,
          side,
          dirs,
          sources.pubs,
          dropped,
        )) {
          keys.set(keyFileName(file), file)
          lines.push(`  IdentityFile ${LANE_SSH_DIR}/keys/${keyFileName(file)}`)
          pinned = true
        }
        continue
      }
      lines.push(
        `  ${CARRIED[line.keyword]} ${line.args.map(quoted).join(" ")}`,
      )
    }
    if (pinned) lines.push("  IdentitiesOnly yes")
    if (!pinned && only !== null) lines.push(only)
    return lines.length === 0
      ? []
      : [`Host ${block.patterns.map(quoted).join(" ")}`, ...lines]
  }

  const blocks = [
    ...(sources.service === null
      ? []
      : parseSshConfig(sources.service)
    ).flatMap(b => render(b, "service")),
    ...(allowed === null || sources.personal === null
      ? []
      : parseSshConfig(sources.personal).flatMap(b => render(b, "personal"))),
  ]
  const config = [
    ...blocks,
    "Host *",
    ...(connect === null
      ? []
      : [`  ProxyCommand ${connect.replaceAll("%", "%%")} %n %p`]),
    `  GlobalKnownHostsFile ${LANE_SSH_DIR}/known_hosts`,
    "  StrictHostKeyChecking yes",
    "",
  ].join("\n")
  const known = laneKnownHosts(sources.knownHosts, allowed)
  return {
    config,
    knownHosts: known.text,
    keys,
    hostKeys: known.facts,
    dropped,
    unmatched: known.unmatched,
  }
}

function identityFiles(
  line: SshLine,
  side: ConfigSide,
  dirs: SshDirs,
  pubs: ReadonlyMap<string, string>,
  dropped: DroppedIdentity[],
): readonly string[] {
  return line.args.flatMap(arg => {
    const ref = identityRef(arg, side, dirs)
    if (ref.kind === "dropped") {
      dropped.push({ side, file: arg, why: ref.why })
      return []
    }
    const pub = pubs.get(ref.path)
    if (pub === undefined) {
      dropped.push({ side, file: arg, why: "no-pub" })
      return []
    }
    return [pub.trim()]
  })
}

interface KnownHostLine {
  readonly raw: string
  readonly marker: string | null
  readonly hosts: readonly string[]
  readonly blob: string
}

function parseKnownHost(raw: string): KnownHostLine | null {
  const text = raw.trim()
  if (text === "" || text.startsWith("#")) return null
  const words = text.split(/\s+/)
  const marker = words[0]?.startsWith("@") ? (words.shift() ?? null) : null
  const [hosts, , blob] = words
  return hosts === undefined || blob === undefined
    ? null
    : { raw: text, marker, hosts: hosts.split(","), blob }
}

/** A host field's entry without its port: `[name]:2222` is `name`. */
const bareHost = (entry: string): string =>
  /^\[([^\]]+)\]:\d+$/.exec(entry)?.[1] ?? entry

/** A host as ssh records it in `known_hosts`: bare on port 22, else `[host]:port`. */
export const knownHostsName = (host: string, port: number): string =>
  port === 22 ? host : `[${host}]:${port}`

/**
 * Whether a hashed entry (`|1|salt|hash`) is one of `names`, hashed as
 * OpenSSH's `hostfile.c` does: HMAC-SHA1 of the name under the salt. Only a
 * concrete name can be hashed, so a wildcard never matches one.
 */
export function hashedHostMatches(
  entry: string,
  names: readonly string[],
): boolean {
  const [, magic, salt, hash] = entry.split("|")
  if (magic !== "1" || salt === undefined || hash === undefined) return false
  const key = Buffer.from(salt, "base64")
  return names.some(
    n => createHmac("sha1", key).update(n).digest("base64") === hash,
  )
}

/**
 * Whether a `known_hosts` entry names an allowed name or wildcard. A clear
 * entry matches by pattern, its port aside, or equals a name's checked name;
 * a hashed entry matches only a whole name, which ssh hashes lowercased, so
 * a wildcard never matches one.
 */
function isEntryMatched(
  entry: string,
  host: Exclude<AllowedHost, { readonly kind: "not" }>,
): boolean {
  if (entry.startsWith("!")) return false
  const checked =
    host.kind === "name" && host.checkedAs !== null ? [host.checkedAs] : []
  if (entry.startsWith("|"))
    return (
      host.kind === "name" &&
      hashedHostMatches(entry, [host.name.toLowerCase(), ...checked])
    )
  return (
    matchesPattern(
      bareHost(entry),
      host.kind === "name" ? host.name : host.pattern,
    ) || checked.includes(entry.toLowerCase())
  )
}

/**
 * The lane's `known_hosts`. Not narrowed: both files whole. Narrowed: the
 * service file whole, and the person's lines whose entries an allowed name
 * or wildcard matches and no negation does, `@revoked` lines always.
 * Personal identity may sign only for the keys of the person's lines kept,
 * never the service file's. `unmatched` is each allowed name or wildcard
 * that kept no line.
 */
export function laneKnownHosts(
  files: { readonly service: string | null; readonly personal: string | null },
  allowed: AllowedHosts | null,
): {
  readonly text: string
  readonly facts: HostKeyFacts
  readonly unmatched: readonly AllowedHost[]
} {
  const parse = (t: string | null) =>
    (t ?? "").split("\n").flatMap(l => {
      const line = parseKnownHost(l)
      return line === null ? [] : [line]
    })
  const service = parse(files.service)
  const personal = allowed === null ? [] : parse(files.personal)
  const narrowed = allowed === null || allowed === "all" ? [] : allowed
  const positive = narrowed.flatMap(h => (h.kind === "not" ? [] : [h]))
  const isVetoed = (entry: string) =>
    !entry.startsWith("|") &&
    narrowed.some(
      h => h.kind === "not" && matchesPattern(bareHost(entry), h.pattern),
    )
  const kept = personal.filter(
    line =>
      allowed === "all" ||
      line.marker === "@revoked" ||
      line.hosts.some(
        entry =>
          !isVetoed(entry) && positive.some(h => isEntryMatched(entry, h)),
      ),
  )
  const names = new Map<string, string>()
  for (const line of [...service, ...personal])
    if (line.marker === null) {
      const name = line.hosts.find(
        e => !e.startsWith("|") && !e.startsWith("!"),
      )
      if (name !== undefined && !names.has(line.blob))
        names.set(line.blob, bareHost(name))
    }
  return {
    text: [...service, ...kept].map(l => `${l.raw}\n`).join(""),
    facts: {
      personal:
        allowed === "all"
          ? "all"
          : new Set(kept.filter(l => l.marker === null).map(l => l.blob)),
      names,
    },
    unmatched: positive.filter(
      h =>
        !kept.some(
          l =>
            l.marker !== "@revoked" &&
            l.hosts.some(entry => isEntryMatched(entry, h)),
        ),
    ),
  }
}
