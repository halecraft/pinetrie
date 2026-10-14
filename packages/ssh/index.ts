// @pinetrie/ssh — a lane's ssh through its host: the settings, the lane's
// files, the host's socket and the service agent (TECHNICAL.md). This lists
// every name another package imports; a name only this package and its
// tests use is imported from its module.

export { inlineIncludes, missingIncludes } from "./config.ts"
export { HOP_AGENT_SOCKET, SOCKET_ENV, TOKEN_ENV } from "./hop.ts"
export { hostSocketIn, type SshHost, startSshHost } from "./host.ts"
export {
  type ServiceKeyCheck,
  type ServiceKeyRefusal,
  serviceKeyCheck,
  type UsableServiceKey,
} from "./keys.ts"
export {
  type DroppedIdentity,
  identityPaths,
  LANE_SSH_DIR,
  planLaneSsh,
} from "./lane-files.ts"
export { laneToken } from "./names.ts"
export type { HostPatterns } from "./patterns.ts"
export { runProgram, startServiceAgent } from "./programs.ts"
export {
  DEFAULT_APPROVAL_SECONDS,
  MAX_APPROVAL_SECONDS,
  MIN_APPROVAL_SECONDS,
  type PersonalChoice,
  type PersonalOff,
  parseHostPatterns,
  type SshSettings,
  settingsOnHost,
  sshSettings,
} from "./settings.ts"
