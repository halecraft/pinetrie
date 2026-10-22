// lanehost/serving — a server's arguments, from the command that starts it
// (`serverArgs`) and back.

import type { Serving } from "./answer.ts"
import { FOLDER_MOUNT, isNestedDisk, type NestedDisk } from "./layout.ts"
import { isRole, type Role, type RoleFacts } from "./roles.ts"

/**
 * The arguments a role's server is started with. `cgroup` is where the
 * runtime bound the cgroup tree into the role's container; null where it
 * bound none.
 */
export const serverArgs = (
  role: Role,
  lanesDir: string,
  facts: RoleFacts,
  nested: NestedDisk,
  cgroup: string | null = null,
): readonly string[] => [
  role,
  lanesDir,
  JSON.stringify({ ...facts, nested, ...(cgroup === null ? {} : { cgroup }) }),
]

/**
 * `serverArgs` back; throws on arguments that are not a role's, or that name
 * no nested disk's values, which lanehost holds none of. The project's root
 * is at `FOLDER_MOUNT` unless the facts name another (`folder`), as a test
 * serving in its own process does.
 */
export function servingFrom(args: readonly string[]): Serving {
  const [role = "", lanesDir = "", facts = "{}"] = args
  if (!isRole(role)) throw new Error(`not a role: ${JSON.stringify(role)}`)
  if (!lanesDir.startsWith("/"))
    throw new Error(`not a lanes directory: ${lanesDir}`)
  const parsed = JSON.parse(facts) as {
    rootless?: unknown
    folder?: unknown
    nested?: unknown
    cgroup?: unknown
  }
  if (!isNestedDisk(parsed.nested))
    throw new Error(
      `no nested disk's owner and data root: ${JSON.stringify(parsed.nested ?? null)}`,
    )
  return {
    role,
    lanesDir,
    facts: { rootless: parsed.rootless === true },
    folder:
      typeof parsed.folder === "string" && parsed.folder.startsWith("/")
        ? parsed.folder
        : FOLDER_MOUNT,
    nested: parsed.nested,
    cgroup:
      typeof parsed.cgroup === "string" && parsed.cgroup.startsWith("/")
        ? parsed.cgroup
        : null,
  }
}
