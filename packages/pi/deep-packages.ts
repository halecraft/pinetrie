// pi/deep-packages — the pi packages `deep.ts` reaches into by file, and
// where each one is. It loads no pi, so the package build reads it without
// loading pi, which `deep.ts` does at its top level.

/** The packages whose unexported files `deep.ts` loads: dependencies no import names. */
export const DEEP_PACKAGES = [
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-coding-agent",
] as const

export type DeepPackage = (typeof DEEP_PACKAGES)[number]

/**
 * A package's own folder, from where Node resolves its entry: pnpm keeps
 * each package in a store folder of its own, so one shared base would find
 * only the first; npm keeps them side by side.
 */
export function deepPackageDir(pkg: DeepPackage): URL {
  const entry = import.meta.resolve(pkg)
  const marker = `/node_modules/${pkg}/`
  const at = entry.lastIndexOf(marker)
  if (at < 0) throw new Error(`${pkg} resolved outside node_modules: ${entry}`)
  return new URL(entry.slice(0, at + marker.length))
}
