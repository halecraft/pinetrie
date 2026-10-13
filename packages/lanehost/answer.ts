// lanehost/answer — one call answered by the module it belongs to, in the
// role that serves it. The server and the one-shot command (`once.ts`) both
// answer through here.

import { diffBySend, diffByWalk } from "./diff.ts"
import {
  executeDiskSteps,
  isSubvolume,
  planDisk,
  planNestedDisk,
  readLaneFile,
} from "./disks.ts"
import { applyGrant } from "./grants.ts"
import { isDiskName, isProjectKey, projectDisks } from "./layout.ts"
import { listProjects, recordProject, removeProject } from "./projects.ts"
import type { LanehostCall, LanehostResult } from "./protocol.ts"
import { moduleOf, planRoles, type Role, type RoleFacts } from "./roles.ts"

/** Where a server runs: its role, the lanes directory, and what its machine grants. */
export interface Serving {
  readonly role: Role
  readonly lanesDir: string
  readonly facts: RoleFacts
}

const disksOf = (serving: Serving, key: string) => {
  if (!isProjectKey(key))
    throw new Error(`not a project's key: ${JSON.stringify(key)}`)
  return projectDisks(serving.lanesDir, key)
}

const named = (name: string): string => {
  if (!isDiskName(name))
    throw new Error(`not a disk's name: ${JSON.stringify(name)}`)
  return name
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
    case "nestedDisk":
      await executeDiskSteps(
        planNestedDisk(call.lane, disksOf(serving, call.project)),
      )
      return null
    case "read":
      return readLaneFile(
        disksOf(serving, call.project),
        call.snapshot,
        call.file,
      )
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
