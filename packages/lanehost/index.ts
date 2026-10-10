// @pinetrie/lanehost — everything the host asks of the machine its lanes'
// disks are on, outside a lane (ADR-0129, TECHNICAL.md). The host imports its
// client and its layout; the server runs in a role's container.

import path from "node:path"

export {
  type Lanehost,
  type LanehostChannel,
  lanehostClient,
} from "./client.ts"
export { ROOTLESS_UID } from "./disks.ts"
export { type Grant, grantChain } from "./grants.ts"
export { isProjectKey, type ProjectDisks, projectDisks } from "./layout.ts"
export type {
  DiskCall,
  LanehostCall,
  LanehostHello,
  LanehostResult,
  ProjectListed,
  SnapshotListed,
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

/** The image a role's container runs, on the host. */
export const LANEHOST_CONTAINERFILE = path.join(
  import.meta.dirname,
  "lanehost.Containerfile",
)
