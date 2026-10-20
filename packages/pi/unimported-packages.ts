// pi/unimported-packages — the dependencies no import names: the pi packages
// `deep.ts` reaches into by file, and the pi extension pine·trie ships and
// gives pi's loader by folder. It loads no pi, so the package build reads it
// without loading pi, which `deep.ts` does at its top level.

import { findPackageJSON } from "node:module"
import path from "node:path"

/** The pi packages whose unexported files `deep.ts` loads. */
export const DEEP_PACKAGES = [
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-coding-agent",
] as const

export type DeepPackage = (typeof DEEP_PACKAGES)[number]

/** The extension pine·trie ships, and the provider whose subscription requests it shapes. */
export const ANTHROPIC_AUTH = {
  package: "@gotgenes/pi-anthropic-auth",
  provider: "anthropic",
} as const

/** Every dependency no import names: the package build declares each one. */
export const UNIMPORTED_PACKAGES = [
  ...DEEP_PACKAGES,
  ANTHROPIC_AUTH.package,
] as const

export type UnimportedPackage = (typeof UNIMPORTED_PACKAGES)[number]

/**
 * A package's own folder. It is found from this module's real path: pnpm
 * links a global install into place, and nothing resolves from the link's
 * path. pi's packages export no `package.json`, and only an `import`
 * condition, so `require.resolve` cannot find their folder.
 */
export function packageFolder(pkg: UnimportedPackage): string {
  const manifest = findPackageJSON(pkg, import.meta.url)
  if (manifest === undefined)
    throw new Error(`${pkg} is not installed beside pine·trie`)
  return path.dirname(manifest)
}
