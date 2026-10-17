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
export { ROOTLESS_UID } from "./disks.ts"
export { type Grant, grantChain } from "./grants.ts"
export {
  FOLDER_MOUNT,
  isProjectKey,
  LANE_FILES,
  type ProjectDisks,
  projectDisks,
} from "./layout.ts"
export {
  decodeLoaderLine,
  encodeLoaderCommand,
  isRaced,
  type LaneNamespace,
  type LoaderCommand,
  type LoaderLine,
  MACHINE_SOCKET,
  type ObserverCall,
  type ObserverFacts,
  type ObserverHello,
  type ObserverNotice,
  type ObserverPlan,
  observerVersion,
  planObserver,
  type ReleaseInodes,
} from "./observer.ts"
export type {
  DiskCall,
  LanehostCall,
  LanehostHello,
  LanehostResult,
  ProjectListed,
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
export { ONCE, SERVER, serverArgs } from "./serving.ts"
export { TAR_OUT } from "./tar-out.ts"

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

/** The machine role's server and a host's connection to it, from the root of pine·trie's install. */
export const OBSERVER_SERVER = "packages/lanehost/observer-server.ts"
export const OBSERVER_CONNECT = "packages/lanehost/observer-connect.ts"
/** The loader, in the machine role's image. */
export const OBSERVER_LOADER = "/usr/local/bin/observe"

/** Every source the machine role's image is made from, by path from pine·trie's root. */
export async function observerSources(): Promise<
  readonly { readonly path: string; readonly content: string }[]
> {
  const root = path.join(import.meta.dirname, "../..")
  const dirs = [
    "packages/lanehost/observer",
    "packages/lanehost",
    "packages/channel",
    "packages/core",
  ]
  const files = dirs.flatMap(d =>
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
