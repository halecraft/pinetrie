// @pinetrie/config — pine·trie's config: settings declared once with their
// rules, each layer's file decoded against them, and one pure settle. This
// lists every name another package imports; a name only this package and its
// tests use is imported from its module.

export {
  type DecodedProject,
  decodeEnv,
  decodeLayer,
  decodeProject,
  type FileRead,
  type LayerValues,
  projectCopy,
  type Refusal,
} from "./decode.ts"
export {
  choice,
  count,
  decoded,
  flag,
  hostCode,
  list,
  record,
  refused,
  shaped,
  size,
  text,
} from "./kinds.ts"
export { type ConfigPlaces, configPlaces, ownDirs } from "./places.ts"
export {
  readConfigFile,
  readStartLayers,
  type StartLayers,
} from "./read.ts"
export {
  decodeSessions,
  EMPTY_REGISTRY,
  encodeSessions,
  planRename,
  planSession,
  type Registry,
  type RegistryProblem,
  type RenamePlan,
  registryWaitWords,
  type SessionName,
  type SessionPlan,
  type SessionRefusal,
  type SessionServed,
  sessionLockLostWords,
  sessionWords,
} from "./sessions.ts"
export { defineTable, join, limited, pick } from "./setting.ts"
export { type ConfigReport, type Settled, settle } from "./settle.ts"
