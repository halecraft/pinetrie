// @pinetrie/lanehost — everything the host asks of the machine its lanes'
// disks are on, outside a lane. The host imports its
// client and its layout; the server runs in a role's container.

import { readdirSync } from "node:fs"
import { readFile } from "node:fs/promises"
import path from "node:path"

export {
  type Lanehost,
  type LanehostChannel,
  lanehostClient,
} from "./client.ts"
export { ClientClosed } from "./closed.ts"
export { lanehostDisks } from "./disks-client.ts"
export { type Grant, grantChain } from "./grants.ts"
export {
  FOLDER_MOUNT,
  isProjectKey,
  type NestedDisk,
  type ProjectDisks,
  projectDisks,
} from "./layout.ts"
export {
  type MachineRead,
  memoryCounters,
  parseInactiveFile,
  parseLimitHits,
  parseMemoryMax,
  parsePressure,
  SERVICES_CGROUP,
} from "./machine.ts"
export { holdingMount, type Mount } from "./mountinfo.ts"
export {
  ATTRIBUTION_HOOKS,
  attributionLine,
  decodeLoaderLine,
  encodeLoaderCommand,
  isRaced,
  type LaneNamespace,
  type LoaderCommand,
  type LoaderLine,
  MACHINE_SOCKET,
  OBSERVER_BUDGET,
  type ObserverCall,
  type ObserverFacts,
  type ObserverHello,
  type ObserverNotice,
  type ObserverPlan,
  observerHeapBytes,
  observerMemoryBytes,
  observerVersion,
  planAttribution,
  planObserver,
  type ReleaseInodes,
} from "./observer.ts"
export type {
  LanehostCall,
  LanehostHello,
  LanehostResult,
  ProjectListed,
  StoreListing,
} from "./protocol.ts"
export {
  isRole,
  type Module,
  planRoles,
  ROLE_NAMES,
  ROLES,
  type Role,
  type RoleFacts,
  type RoleSpec,
} from "./roles.ts"
export { serverArgs } from "./serving.ts"

/** The observer's loader and its suite's guest, built for the machine's architecture. */
export const OBSERVER_CONTAINERFILE = path.join(
  import.meta.dirname,
  "observer/observer.Containerfile",
)

/** The image a role's container runs, on the host. */
export const LANEHOST_CONTAINERFILE = path.join(
  import.meta.dirname,
  "lanehost.Containerfile",
)

export {
  connectObserver,
  type ObserverChannel,
  type ObserverClient,
  observerClient,
} from "./observer-client.ts"

/** The loader, in the machine role's image. */
export const OBSERVER_LOADER = "/usr/local/bin/observe"

/**
 * The folders the machine role's image is made from, by path from pine·trie's
 * root: the observer's server and every module it loads must be in them
 * (`scripts/shipped.test.ts`).
 */
export const OBSERVER_SOURCE_DIRS = [
  "packages/lanehost/observer",
  "packages/lanehost",
  "packages/channel",
  "packages/core",
] as const

/** Every source the machine role's image is made from, from the install at `root`, by path from it. */
export async function observerSources(
  root: string,
): Promise<readonly { readonly path: string; readonly content: string }[]> {
  const files = OBSERVER_SOURCE_DIRS.flatMap(d =>
    readdirSync(path.join(root, d), { withFileTypes: true })
      .filter(e => e.isFile() && !e.name.endsWith(".test.ts"))
      .map(e => `${d}/${e.name}`),
  )
  return Promise.all(
    files.map(async f => ({
      path: f,
      content: await readFile(path.join(root, f), "utf8"),
    })),
  )
}
