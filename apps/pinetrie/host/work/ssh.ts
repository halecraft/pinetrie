// host/work/ssh — lanes' ssh through the host (`@pinetrie/ssh`): what the
// host reads of the person's and the service folder's ssh files, the files
// every lane is given, the socket lanes reach it through, and the owner's
// answers, which live in each lane's `pinetrie.access` record. The relay
// asks; this module waits on the record, and carries out what each change
// to it means (`planAccessChange`).

import { randomBytes } from "node:crypto"
import {
  chmod,
  glob,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { subscribe } from "@kyneta/schema"
import {
  type AccessRecord,
  isThreadId,
  type PersonalAccess,
  shellWord,
  type ThreadId,
  type WriterId,
} from "@pinetrie/core"
import {
  type LaneAttached,
  type LaneFiles,
  type LaneOwner,
  type Mount,
  NOTHING_ATTACHED,
  PINETRIE_MOUNT,
  runtimeNode,
} from "@pinetrie/lanes"
import { readRecords } from "@pinetrie/reads"
import {
  ACCESS,
  emptyAccess,
  planAccessAsk,
  planAccessChange,
  planAccessTimeout,
  planAccessUse,
  setRecord,
} from "@pinetrie/rules"
import {
  HOP_AGENT_SOCKET,
  identityPaths,
  inlineIncludes,
  LANE_SSH_DIR,
  laneToken,
  missingIncludes,
  planLaneSsh,
  runProgram,
  SOCKET_ENV,
  type SshHost,
  type SshSettings,
  serviceKeyCheck,
  settingsOnHost,
  sshSettings,
  startServiceAgent,
  startSshHost,
  TOKEN_ENV,
  type UsableServiceKey,
} from "@pinetrie/ssh"
import type { Basics } from "../basics.ts"
import type { Records } from "../records.ts"
import { sshLines } from "../startup-lines.ts"

/** Where a lane finds the host's socket. */
const HOST_SOCKET_IN_LANE = "/run/pinetrie/ssh-host.sock"
/** The hop, in pine·trie's install as every lane mounts it. */
export const HOP_IN_LANE = `${PINETRIE_MOUNT}/packages/ssh/hop.ts`

/** Where the person's ssh files are, and their agent. */
export interface PersonalSshPlaces {
  /** `~/.ssh`: its `config` and `known_hosts`. */
  readonly dir: string
  /** `SSH_AUTH_SOCK`; null with none. */
  readonly agent: string | null
}

export interface LaneSsh {
  /** What a lane is given: nothing, unless it holds an identity. */
  attachedFor(lane: LaneOwner): LaneAttached
  /** The host paths every lane holding an identity mounts. */
  readonly mounts: readonly Mount[]
  /** What a lane's agent is told it holds: its own grant decides your identity. */
  holdsFor(lane: LaneOwner): {
    readonly personal: boolean
    readonly services: readonly string[]
  }
  /** `listener` hears a lane whose sessions must end now. */
  onCut(listener: (lane: ThreadId) => void): void
  close(): Promise<void>
}

const NO_SSH: LaneSsh = {
  attachedFor: () => NOTHING_ATTACHED,
  mounts: [],
  holdsFor: () => ({ personal: false, services: [] }),
  onCut: () => {},
  close: async () => {},
}

/**
 * A directory for the host's ssh sockets, its own, under the system's
 * temporary directory: a socket's path is limited to 104 bytes on macOS, which
 * a project's own path could pass. Searchable by all, since a nested lane's
 * rootless Docker mounts its socket as another user; listable by none.
 */
export async function prepareSshDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "pinetrie-ssh-"))
  await chmod(dir, 0o711)
  return dir
}

/** The host's socket in `prepareSshDir`'s directory, as `startSshHost` makes it. */
export const hostSocketIn = (dir: string): string =>
  path.join(dir, "relay.sock")

const readText = (file: string): Promise<string | null> =>
  readFile(file, "utf8").catch(() => null)

/** A config's text with its `Include`s in place: each read as `missingIncludes` names it. */
async function configWithIncludes(
  file: string,
  base: string,
  home: string,
): Promise<string | null> {
  const text = await readText(file)
  if (text === null) return null
  const roots = { base, home }
  const files = new Map<string, readonly string[]>()
  for (let round = 0; round < 16; round++) {
    const missing = missingIncludes(text, roots, files)
    if (missing.length === 0) break
    for (const pattern of missing) {
      const matched: string[] = []
      for await (const f of glob(pattern)) matched.push(f)
      const texts = await Promise.all(matched.sort().map(readText))
      files.set(
        pattern,
        texts.filter((t): t is string => t !== null),
      )
    }
  }
  return inlineIncludes(text, roots, files)
}

/** The service folder's key pairs: every file with a `.pub` beside it. */
async function serviceKeyFiles(dir: string) {
  const names = await readdir(dir).catch(() => [] as string[])
  const pairs = names.filter(
    n =>
      !n.startsWith(".") && !n.endsWith(".pub") && names.includes(`${n}.pub`),
  )
  return Promise.all(
    pairs.map(async name => {
      const file = path.join(dir, name)
      return {
        name,
        path: file,
        privateText: (await readText(file)) ?? "",
        mode: (await stat(file)).mode & 0o777,
        pub: await readText(`${file}.pub`),
      }
    }),
  )
}

/**
 * The secret every lane's token is made under, made once per session, and
 * readable by you alone whatever its directory's mode. A file that is no
 * secret is removed first: writing over it would keep its mode.
 */
export async function sshSecret(file: string): Promise<Uint8Array> {
  const kept = await readFile(file).catch(() => null)
  if (kept !== null && kept.length === 32) return kept
  const made = randomBytes(32)
  await rm(file, { force: true })
  await writeFile(file, made, { mode: 0o600, flag: "wx" })
  return made
}

/**
 * Lanes' ssh, started before any lane is: the service agent and the host's
 * socket, the lanes' files written. Nothing at all when lanes hold no
 * identity: no personal one, and no usable key in the service folder.
 */
export async function startLaneSsh(input: {
  readonly basics: Pick<Basics, "session" | "log" | "now">
  readonly records: Pick<Records, "writeValues">
  /** Where the lanes' ssh files and the secret are kept (`sessionFiles`). */
  readonly files: Pick<LaneFiles, "laneSsh" | "sshSecret">
  /** `lanes.ssh`'s settled values, under accepted work's grant (`sshChoice`). */
  readonly choice: Parameters<typeof sshSettings>[0]
  /** The service identities' folder: `ssh/` in pine·trie's config directory. */
  readonly serviceDir: string
  /** Whether a lane's own config keeps the project's grant (`effectiveLaneConfig`). */
  readonly laneGrant: (lane: ThreadId) => boolean
  readonly owner: WriterId | null
  readonly personal: PersonalSshPlaces
  /** The directory the host's socket is in (`prepareSshDir`). */
  readonly dir: string
}): Promise<LaneSsh> {
  const { basics, records, personal: places } = input
  const { log } = basics

  // --- gather -------------------------------------------------------------
  const settings: SshSettings = settingsOnHost(sshSettings(input.choice), {
    owner: input.owner !== null,
    agent: places.agent !== null,
  })
  const { personal: personalSsh } = settings
  const personalOn = personalSsh.kind === "on"
  const home = path.dirname(places.dir)
  const { serviceDir } = input
  const keyFiles = await serviceKeyFiles(serviceDir)
  const serviceConfigFile = path.join(serviceDir, "config")
  const personalConfigFile = path.join(places.dir, "config")
  const service = await configWithIncludes(serviceConfigFile, serviceDir, home)
  const personal = personalOn
    ? await configWithIncludes(personalConfigFile, places.dir, home)
    : null
  const dirs = { home, service: serviceDir }
  const pubs = new Map<string, string>()
  for (const p of identityPaths({ service, personal }, dirs)) {
    const pub = await readText(`${p}.pub`)
    if (pub !== null) pubs.set(p, pub)
  }
  const knownHosts = {
    service: await readText(path.join(serviceDir, "known_hosts")),
    personal: personalOn
      ? await readText(path.join(places.dir, "known_hosts"))
      : null,
  }
  const hasSsh = (await runProgram(["ssh", "-V"])).code === 0

  // --- plan ---------------------------------------------------------------
  const checks = keyFiles.map(serviceKeyCheck)
  const usable = checks.flatMap(c => (c.kind === "usable" ? [c.key] : []))
  const hop = runtimeNode(HOP_IN_LANE).map(shellWord).join(" ")
  const connect = hasSsh ? `${hop} connect` : null
  const files = planLaneSsh(
    { service, personal, pubs, knownHosts },
    settings.personal,
    dirs,
    connect,
  )

  // --- execute ------------------------------------------------------------
  const serviceAgent = await startServiceAgent({ dir: input.dir, keys: usable })
  const added: readonly UsableServiceKey[] = serviceAgent?.added ?? []
  for (const line of sshLines({
    settings,
    checks,
    failed: serviceAgent?.failed ?? [],
    added: added.map(k => k.name),
    dropped: files.dropped,
    hasSsh,
    hasAgent: serviceAgent !== null,
  }))
    log(line)
  if (!personalOn && added.length === 0) {
    serviceAgent?.close()
    return NO_SSH
  }

  const { laneSsh, sshSecret: secretFile } = input.files
  await mkdir(path.join(laneSsh, "keys"), { recursive: true })
  await writeFile(path.join(laneSsh, "config"), files.config)
  await writeFile(path.join(laneSsh, "known_hosts"), files.knownHosts)
  for (const [name, pub] of files.keys)
    await writeFile(path.join(laneSsh, "keys", name), `${pub}\n`)
  const secret = await sshSecret(secretFile)
  const combined = path.join(input.dir, "combined")
  await writeFile(
    combined,
    [
      ...(service === null ? [] : [`Include ${serviceConfigFile}`]),
      ...(personal === null ? [] : [`Include ${personalConfigFile}`]),
      "",
    ].join("\n"),
  )

  /** Requests held for each lane's owner, each settled as its record changes. */
  const waiting = new Map<ThreadId, ((may: boolean) => void)[]>()
  const cutListeners: ((lane: ThreadId) => void)[] = []
  /** Each ask's deadline: cleared at close, so none writes after the documents close. */
  const timers = new Set<NodeJS.Timeout>()
  const readAccess = (lane: ThreadId): AccessRecord =>
    readRecords(basics.session, ACCESS).get(lane) ?? emptyAccess(lane)
  const write = (record: AccessRecord) =>
    records.writeValues([setRecord(ACCESS, record)])
  const settle = (lane: ThreadId, may: boolean) => {
    for (const resolve of waiting.get(lane) ?? []) resolve(may)
    waiting.delete(lane)
  }

  /**
   * Whether a lane may ask for your identity at all: your config grants it,
   * or the project does and the lane's own config has not given it up.
   */
  const laneMayAsk = (lane: LaneOwner): boolean =>
    personalSsh.kind === "on" &&
    (personalSsh.own || (isThreadId(lane) && input.laneGrant(lane)))

  async function mayUsePersonal(lane: string, host: string | null) {
    if (!isThreadId(lane) || !laneMayAsk(lane)) return false
    const record = readAccess(lane)
    if (record.personal?.kind === "approved") return true
    if (record.personal?.kind === "refused") return false
    const asked = new Promise<boolean>(resolve => {
      waiting.set(lane, [...(waiting.get(lane) ?? []), resolve])
    })
    if (record.personal?.kind !== "waiting") {
      await write(planAccessAsk({ record, host, now: basics.now() }))
      const timer = setTimeout(() => {
        timers.delete(timer)
        const now = readAccess(lane)
        if (now.personal?.kind === "waiting")
          void write(planAccessTimeout(now, basics.now()))
      }, settings.approvalSeconds * 1000)
      timers.add(timer)
    }
    return asked
  }

  const host: SshHost = await startSshHost({
    dir: input.dir,
    secret,
    personalAgent: personalOn ? places.agent : null,
    serviceAgent: serviceAgent?.socket ?? null,
    serviceKeys: added,
    hostKeys: files.hostKeys,
    combinedConfig: hasSsh ? combined : null,
    mayUsePersonal,
    used: (lane, use) => {
      if (!isThreadId(lane)) return
      const next = planAccessUse(readAccess(lane), use)
      if (next !== null) void write(next)
    },
  })

  // Every change to a lane's record is carried out here, whoever made it:
  // an answer, a timeout, a starting host's recovery.
  const seen = new Map<ThreadId, PersonalAccess | null>(
    [...readRecords(basics.session, ACCESS)].map(([lane, r]) => [
      lane,
      r.personal,
    ]),
  )
  const follow = () => {
    for (const [lane, record] of readRecords(basics.session, ACCESS)) {
      const effect = planAccessChange(seen.get(lane) ?? null, record.personal)
      seen.set(lane, record.personal)
      if (effect === "release") settle(lane, true)
      else if (effect === "refuse") settle(lane, false)
      else if (effect === "cut") {
        settle(lane, false)
        host.cut(lane)
        for (const listener of cutListeners) listener(lane)
      }
    }
  }
  const unsubscribe = subscribe(basics.session.records, follow)

  const mounts: Mount[] = [
    { source: laneSsh, target: LANE_SSH_DIR, readonly: true },
  ]
  return {
    attachedFor: lane =>
      added.length === 0 && !laneMayAsk(lane)
        ? NOTHING_ATTACHED
        : {
            hostSocket: HOST_SOCKET_IN_LANE,
            mounts,
            env: {
              SSH_AUTH_SOCK: HOP_AGENT_SOCKET,
              [TOKEN_ENV]: laneToken(secret, lane),
              [SOCKET_ENV]: HOST_SOCKET_IN_LANE,
            },
            // Started again if it exits: an agent that kills it loses ssh for a
            // second, not until the lane's next run.
            starts: [`while :; do ${hop} serve; sleep 1; done`],
          },
    mounts,
    holdsFor: lane => ({
      personal: laneMayAsk(lane),
      services: added.map(k => k.name),
    }),
    onCut: listener => void cutListeners.push(listener),
    async close() {
      unsubscribe()
      for (const timer of timers) clearTimeout(timer)
      for (const lane of [...waiting.keys()]) settle(lane, false)
      await host.close()
      serviceAgent?.close()
    },
  }
}
