// host/work/config — `pinetrie.json`'s `lanes` key as a fact of a state:
// accepted work's copy, read at accepted work (`Destination.fileAt`) at
// startup and each time accepted work moves; and each lane's own copy, read
// at its newest point in the destination before its container starts,
// beside the copy it started on. A lane runs with accepted work's, less what its own copy dropped from
// that start (`effectiveLaneConfig`), so a lane can give up a grant at once,
// and gains one only through acceptance.
// Your repo's names (`accepted`, `wip`, `publish`) are not read here: they
// find accepted work, so they come from your config and your working copy's
// `pinetrie.json`, at startup.

import {
  PRODUCT_NAME,
  PROJECT_CONFIG_FILE,
  type ThreadId,
} from "@pinetrie/core"
import type { Point } from "@pinetrie/lanes"
import {
  configChangeNote,
  decodeLaneConfig,
  effectiveLaneConfig,
  type LaneAuthority,
  type LaneConfig,
  NO_GRANTS,
  normalShared,
  type SharedDir,
} from "@pinetrie/lanes"
import { brokenConfigLine } from "../startup-lines.ts"
import type { OpenProject } from "./adapter.ts"

/**
 * `pinetrie.json`'s grants and shared directories as read: none when the
 * file is not there; one that is not JSON grants nothing too, and is logged.
 */
function authorityLogged(
  read: { readonly at: string; readonly text: string | null },
  root: string,
  log: (m: string) => void,
): LaneAuthority {
  let json: unknown = null
  if (read.text !== null)
    try {
      json = JSON.parse(read.text)
    } catch (error) {
      log(
        brokenConfigLine(`${PROJECT_CONFIG_FILE} at ${read.at}`, String(error)),
      )
    }
  const { grants, shared } = decodeLaneConfig(json, root)
  return { grants, shared }
}

/** Accepted work's lane config, and the shared directories it and your config make. */
export interface AcceptedLanes {
  readonly authority: LaneAuthority
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
   * What a lane's agent is told of the `pinetrie.json` it just wrote,
   * given the file's text (null when there is none): `configChangeNote`.
   */
  configNote(text: string | null): string | null
}

export async function startLaneConfigs(input: {
  readonly root: string
  readonly project: Pick<OpenProject, "fileAt" | "prepareShared">
  /** Your config's `lanes`, read at startup: its shared directories always apply. */
  readonly user: LaneConfig
  readonly userFile: string
  readonly log: (m: string) => void
}): Promise<LaneConfigs> {
  const { root, project, user, log } = input
  /** `pinetrie.json` at `point`, decoded; null when the point is not there. */
  const authorityAt = async (point: Point): Promise<LaneAuthority | null> => {
    const read = await project.fileAt(point, PROJECT_CONFIG_FILE)
    return read.kind === "no-point" ? null : authorityLogged(read, root, log)
  }
  /**
   * Each lane's own copy as last read, and its base's: the copy it started
   * on. Null when it has no commit in your repo yet.
   */
  const lanes = new Map<
    ThreadId,
    { readonly base: LaneAuthority; readonly own: LaneAuthority } | null
  >()

  async function readAccepted(): Promise<AcceptedLanes> {
    // Accepted work is always a point: none there grants nothing.
    const authority = (await authorityAt({ kind: "accepted" })) ?? {
      grants: NO_GRANTS,
      shared: [],
    }
    const sharing = await project.prepareShared({
      user: user.shared,
      project: authority.shared,
    })
    for (const r of sharing.refused)
      log(`[host] ${r.path} is not shared: ${r.reason}`)
    return { authority, shared: sharing.shared }
  }

  /** What accepted work grants, said once per change. */
  const describe = (a: AcceptedLanes): string[] => {
    const { grants } = a.authority
    const on = [
      grants.ssh ? "your ssh identity" : null,
      ...grants.env.map(e => `$${e}`),
      ...grants.mounts.map(m => m.source),
    ].filter(g => g !== null)
    return [
      ...(on.length > 0 ? [`[host] lanes are granted: ${on.join(", ")}`] : []),
      ...a.shared.map(d => {
        const from = user.shared.some(p => normalShared(p) === d.path)
          ? input.userFile
          : PROJECT_CONFIG_FILE
        return `[host] ${d.path}/ is shared read-write with every lane (${from})`
      }),
    ]
  }

  let accepted = await readAccepted()
  const sharedListeners: ((shared: readonly SharedDir[]) => void)[] = []
  for (const line of describe(accepted)) log(line)

  const allowed = (a: LaneAuthority) => {
    const paths = new Set([
      ...a.shared.map(normalShared),
      ...user.shared.map(normalShared),
    ])
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
      let json: unknown = null
      try {
        json = text === null ? null : JSON.parse(text)
      } catch {
        return `${PRODUCT_NAME}: ${PROJECT_CONFIG_FILE} is not JSON: this lane keeps what accepted work's grants until it is.`
      }
      const { grants, shared } = decodeLaneConfig(json, root)
      return configChangeNote(accepted.authority, { grants, shared })
    },
    laneShared: lane =>
      allowed(effectiveLaneConfig(accepted.authority, lanes.get(lane) ?? null)),
  }
}
