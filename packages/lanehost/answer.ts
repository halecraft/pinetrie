// lanehost/answer — one call answered by the module it belongs to, in the
// role that serves it. The server and the one-shot command (`once.ts`) both
// answer through here.

import { mkdir } from "node:fs/promises"
import { diffBySend, diffByWalk } from "./diff.ts"
import {
  executeDiskSteps,
  isSubvolume,
  planDisk,
  planNestedDisk,
  readSnapshotFile,
} from "./disks.ts"
import {
  diffStats,
  executeApply,
  executeReadIn,
  executeStates,
  fileDiff,
  filesUnder,
  pathFacts,
  planApply,
  planReadIn,
  planStates,
  sameContent,
} from "./folder.ts"
import { applyGrant } from "./grants.ts"
import {
  isProjectKey,
  checkedDiskName as named,
  projectDisks,
} from "./layout.ts"
import { listProjects, recordProject, removeProject } from "./projects.ts"
import type { LanehostCall, LanehostResult } from "./protocol.ts"
import { moduleOf, planRoles, type Role, type RoleFacts } from "./roles.ts"

/** Where a server runs: its role, the lanes directory, and what its machine grants. */
export interface Serving {
  readonly role: Role
  readonly lanesDir: string
  readonly facts: RoleFacts
  /** Where the project's root is mounted read-only: `FOLDER_MOUNT` in a role's container. */
  readonly folder: string
}

const disksOf = (serving: Serving, key: string) => {
  if (!isProjectKey(key))
    throw new Error(`not a project's key: ${JSON.stringify(key)}`)
  return projectDisks(serving.lanesDir, key)
}

/** Answer `call`, or throw: a call of a module another role serves is refused. */
export async function answer<C extends LanehostCall>(
  call: C,
  serving: Serving,
): Promise<LanehostResult<C>> {
  const module = moduleOf(call)
  const role = planRoles(serving.facts).get(module)
  if (role !== serving.role)
    throw new Error(
      `${call.kind} is ${role ?? "no role"}'s, not ${serving.role}'s`,
    )
  return (await answerAny(call, serving)) as LanehostResult<C>
}

async function answerAny(
  call: LanehostCall,
  serving: Serving,
): Promise<unknown> {
  switch (call.kind) {
    case "disk":
      await executeDiskSteps(planDisk(call.op, disksOf(serving, call.project)))
      return null
    case "diskExists":
      return isSubvolume(disksOf(serving, call.project).lane(named(call.lane)))
    case "snapshotExists":
      return isSubvolume(
        disksOf(serving, call.project).snapshot(named(call.snapshot)),
      )
    case "statesDir":
      await mkdir(disksOf(serving, call.project).states(named(call.lane)), {
        recursive: true,
      })
      return null
    case "nestedDisk":
      await executeDiskSteps(
        planNestedDisk(call.lane, disksOf(serving, call.project)),
      )
      return null
    case "read":
      return readSnapshotFile(
        disksOf(serving, call.project),
        call.snapshot,
        call.path,
        call.limit,
      )
    case "pathFacts":
      return pathFacts(
        disksOf(serving, call.project),
        call.snapshot,
        call.paths,
      )
    case "fileDiff":
      return fileDiff(
        disksOf(serving, call.project),
        call.a,
        call.b,
        call.path,
        call.limit,
      )
    case "diffStats":
      return diffStats(
        disksOf(serving, call.project),
        call.a,
        call.b,
        call.paths,
      )
    case "filesUnder":
      return filesUnder(
        disksOf(serving, call.project),
        call.snapshot,
        call.paths,
      )
    case "sameContent":
      return sameContent(
        disksOf(serving, call.project),
        call.a,
        call.b,
        call.paths,
      )
    case "applyMerge":
      return executeApply(
        planApply(call, disksOf(serving, call.project)),
        call.markers,
      )
    case "readIn":
      return executeReadIn(
        planReadIn(call, serving.folder, disksOf(serving, call.project)),
      )
    case "states":
      await executeStates(
        planStates(call.lane, call.op, disksOf(serving, call.project)),
      )
      return null
    case "record":
      await recordProject(disksOf(serving, call.project), call.root)
      return null
    case "projects":
      return listProjects(serving.lanesDir)
    case "removeProject":
      await removeProject(disksOf(serving, call.project))
      return null
    case "grant": {
      const { kind: _, ...grant } = call
      await applyGrant(grant)
      return null
    }
    case "diff": {
      const disks = disksOf(serving, call.project)
      const from = disks.snapshot(named(call.from))
      const to = disks.snapshot(named(call.to))
      return serving.facts.rootless
        ? diffByWalk(from, to)
        : diffBySend(from, to)
    }
  }
}
