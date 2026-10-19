// pi/deep-packages — the pi packages `deep.ts` reaches into by file. Plain
// data, apart from `deep.ts`, so the package build reads it without loading
// pi: `deep.ts` loads it at the top level.

/** The packages whose unexported files `deep.ts` loads: dependencies no import names. */
export const DEEP_PACKAGES = [
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-coding-agent",
] as const

export type DeepPackage = (typeof DEEP_PACKAGES)[number]
