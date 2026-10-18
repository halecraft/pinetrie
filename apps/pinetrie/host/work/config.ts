// host/work/config — `pinetrie.json` as a fact of a state: accepted work's
// copy, read at accepted work (`Destination.fileAt`) at startup and each time
// accepted work moves; and each lane's own copy, read at its newest state in
// the destination before its container starts, beside the copy it started
// on. A lane runs with accepted work's grants, less what its own copy dropped
// from that start (`effectiveLaneConfig`), so a lane can give up a grant at
// once, and gains one only through acceptance. Each copy is decoded by the
// host's table (`settings.ts`), and every setting is settled with the layers
// read at startup.
// Your repo's names (`accepted`, `wip`, `publish`) are read from the working
// copy's file, at startup: they find accepted work, so they cannot come from
// it (`openProject`).

import {
  type DecodedProject,
  decodeProject,
  projectCopy,
  type StartLayers,
} from "@pinetrie/config"
import {
  PRODUCT_NAME,
  PROJECT_CONFIG_FILE,
  type ThreadId,
} from "@pinetrie/core"
import { refusalWords } from "@pinetrie/interface"
import {
  configChangeNote,
  effectiveLaneConfig,
  type LaneAuthority,
  normalShared,
  type ReadSite,
  type SharedDir,
} from "@pinetrie/lanes"
import {
  decodeAuthority,
  type HostReport,
  type HostSettings,
  laneAuthority,
  laneCopy,
  SETTINGS,
  settleHost,
} from "../settings.ts"
import type { OpenProject } from "./adapter.ts"

/** Accepted work's copy of `pinetrie.json`, settled with the start layers. */
export interface AcceptedLanes {
  readonly copy: DecodedProject<HostSettings, "accepted">
  readonly authority: LaneAuthority
  /** Every setting, with accepted work's copy as each lane's before it gives anything up. */
  readonly report: HostReport
  readonly shared: readonly SharedDir[]
}

export interface LaneConfigs {
  /** Accepted work's now. */
  accepted(): AcceptedLanes
  /**
   * Accepted work's, read again after it moved, not yet in force: what its
   * lanes may mount is shared before any lane can read it. Not pure: it
   * prepares the shared directories (`prepareShared`).
   */
  readAccepted(): Promise<AcceptedLanes>
  /** Put `next` in force; says what changed, and tells `onShared`'s listeners. */
  takeAccepted(next: AcceptedLanes): void
  /** Called with the shared directories each time accepted work's change them. */
  onShared(listener: (shared: readonly SharedDir[]) => void): void
  /** Called with accepted work's config each time it is taken. */
  onTaken(listener: (next: AcceptedLanes) => void): void
  /**
   * Read `lane`'s own copy from its newest commit in your repo, and keep
   * the config it runs with. A lane with none there yet runs with accepted
   * work's.
   */
  readLane(lane: ThreadId): Promise<LaneAuthority>
  /** What `lane` runs with, as last read; accepted work's before any read. */
  laneConfig(lane: ThreadId): LaneAuthority
  /** The shared directories `lane` mounts: yours always, the project's as its config allows. */
  laneShared(lane: ThreadId): readonly SharedDir[]
  /**
   * What a lane's agent is told of the `pinetrie.json` it just wrote, given
   * the file's text (null when there is none): what it changes
   * (`configChangeNote`), and each key not taken.
   */
  configNote(text: string | null): string | null
}

/** `pinetrie.json` at accepted work, as its site is named in a refusal. */
const ACCEPTED_FILE = `${PROJECT_CONFIG_FILE} at accepted work`

export async function startLaneConfigs(input: {
  readonly root: string
  readonly project: Pick<OpenProject, "fileAt" | "prepareShared">
  /** The layers read once, at startup. */
  readonly start: StartLayers<HostSettings>
  /** The working copy's `pinetrie.json`, read at startup. */
  readonly working: DecodedProject<HostSettings, "working">
  readonly log: (m: string) => void
}): Promise<LaneConfigs> {
  const { root, project, start, working, log } = input
  /** `pinetrie.json`'s text at `site`; null when the site is not there. */
  const textAt = async (
    site: ReadSite,
  ): Promise<{ readonly text: string | null } | null> => {
    const read = await project.fileAt(site, PROJECT_CONFIG_FILE)
    return read.kind === "no-site" ? null : { text: read.text }
  }
  const authorityAt = async (site: ReadSite): Promise<LaneAuthority | null> => {
    const read = await textAt(site)
    return read === null
      ? null
      : decodeAuthority(root, PROJECT_CONFIG_FILE, read.text).authority
  }
  /**
   * Each lane's own copy as last read, and its base's: the copy it started
   * on. Null when it has no commit in your repo yet.
   */
  const lanes = new Map<
    ThreadId,
    { readonly base: LaneAuthority; readonly own: LaneAuthority } | null
  >()

  const settledFor = (
    copy: DecodedProject<HostSettings, "accepted">,
    authority: LaneAuthority,
  ): HostReport =>
    settleHost(start, { working, accepted: copy, lane: laneCopy(authority) })

  async function readAccepted(): Promise<AcceptedLanes> {
    // Accepted work is always a site: none there grants nothing.
    const read = await textAt({ kind: "accepted" })
    const text = read?.text ?? null
    const copy = decodeProject(
      SETTINGS,
      projectCopy(
        "accepted",
        ACCEPTED_FILE,
        text === null ? { kind: "missing" } : { kind: "text", text },
      ),
    )
    const authority = laneAuthority(copy.values, root)
    const report = settledFor(copy, authority)
    const sharing = await project.prepareShared(
      report.settled["lanes.shared"].value,
    )
    for (const r of sharing.refused)
      log(`[host] ${r.path} is not shared: ${r.reason}`)
    return { copy, authority, report, shared: sharing.shared }
  }

  /** The person's own shared directories, and the file each is in. */
  const personal = (): ReadonlyMap<string, string> =>
    new Map(
      [start.user, start.local].flatMap(layer =>
        layer === null
          ? []
          : (layer.values["lanes.shared"] ?? []).map(
              p => [normalShared(p), layer.file] as const,
            ),
      ),
    )

  /** What accepted work grants, and what its copy refused, said once per change. */
  const describe = (a: AcceptedLanes): string[] => {
    const { grants } = a.authority
    const on = [
      grants.ssh ? "your ssh identity" : null,
      ...grants.env.map(e => `$${e}`),
      ...grants.mounts.map(m => m.source),
    ].filter(g => g !== null)
    const personalShares = personal()
    return [
      ...a.copy.refusals.map(r => `[host] ${refusalWords(r)}`),
      ...(on.length > 0 ? [`[host] lanes are granted: ${on.join(", ")}`] : []),
      ...a.shared.map(d => {
        const from = personalShares.get(d.path) ?? PROJECT_CONFIG_FILE
        return `[host] ${d.path}/ is shared read-write with every lane (${from})`
      }),
    ]
  }

  let accepted = await readAccepted()
  const sharedListeners: ((shared: readonly SharedDir[]) => void)[] = []
  const takenListeners: ((next: AcceptedLanes) => void)[] = []
  for (const line of describe(accepted)) log(line)

  /** Accepted work's shared directories that `authority`'s lane mounts. */
  const allowed = (authority: LaneAuthority) => {
    const paths = new Set(
      settledFor(accepted.copy, authority).settled["lanes.shared"].value.map(
        normalShared,
      ),
    )
    return accepted.shared.filter(d => paths.has(d.path))
  }

  return {
    accepted: () => accepted,
    readAccepted,
    takeAccepted(next) {
      const before = describe(accepted).join("\n")
      const sharedBefore = accepted.shared.map(d => d.path).join("\n")
      accepted = next
      if (describe(next).join("\n") !== before)
        for (const line of describe(next)) log(line)
      if (next.shared.map(d => d.path).join("\n") !== sharedBefore)
        for (const listener of sharedListeners) listener(next.shared)
      for (const listener of takenListeners) listener(next)
    },
    onTaken(listener) {
      takenListeners.push(listener)
    },
    onShared(listener) {
      sharedListeners.push(listener)
    },
    async readLane(lane) {
      const own = await authorityAt({ kind: "tip", lane })
      // A lane with no base to compare with has given up nothing.
      const copies =
        own === null
          ? null
          : { base: (await authorityAt({ kind: "start", lane })) ?? own, own }
      lanes.set(lane, copies)
      return effectiveLaneConfig(accepted.authority, copies)
    },
    laneConfig: lane =>
      effectiveLaneConfig(accepted.authority, lanes.get(lane) ?? null),
    configNote(text) {
      const written = decodeAuthority(root, PROJECT_CONFIG_FILE, text)
      const notTaken = written.refusals.map(
        r => `${PRODUCT_NAME}: ${refusalWords(r)}.`,
      )
      const change = written.refusals.some(r => r.why === "broken")
        ? `${PRODUCT_NAME}: this lane keeps what accepted work's grants until ${PROJECT_CONFIG_FILE} can be read.`
        : configChangeNote(accepted.authority, written.authority)
      const lines = [...notTaken, ...(change === null ? [] : [change])]
      return lines.length === 0 ? null : lines.join("\n")
    },
    laneShared: lane =>
      allowed(effectiveLaneConfig(accepted.authority, lanes.get(lane) ?? null)),
  }
}
