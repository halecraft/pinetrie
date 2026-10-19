// install — pine·trie's own install: where it is, which form its files are
// in, and the scripts it runs in other processes. Only this module knows a
// script's path: a caller gets a whole command (`scriptCommand`), so a path
// cannot be written, or misspelt, anywhere else.

import path from "node:path"

/** An install of pine·trie: its root, and the form its files are in. */
export interface Install {
  readonly root: string
  /** `source`: the repo's `.ts`, which Node strips as it loads; `built`: the package's `.js`. */
  readonly form: "source" | "built"
}

/**
 * This process's own install: the root two levels above this file, in the
 * form this file is in. The package build keeps the repo's layout, so the
 * root is the same distance away in both forms.
 */
export const thisInstall: Install = {
  root: path.resolve(import.meta.dirname, "../.."),
  form: import.meta.filename.endsWith(".ts") ? "source" : "built",
}

/** Where every lane and lanehost container mounts an install, read-only. */
export const PINETRIE_MOUNT = "/pinetrie"

/** An install of `install`'s form, as a container sees it at the mount. */
export const inMount = (install: Pick<Install, "form">): Install => ({
  root: PINETRIE_MOUNT,
  form: install.form,
})

/** The scripts pine·trie runs in another process, each a path from the root without its extension. */
const SCRIPTS = {
  laneHelper: "packages/pi/lane-helper",
  hop: "packages/ssh/hop",
  lanehostServer: "packages/lanehost/server",
  lanehostOnce: "packages/lanehost/once",
  tarOut: "packages/lanehost/tar-out",
  fileOut: "packages/lanehost/file-out",
  observerServer: "packages/lanehost/observer-server",
  observerConnect: "packages/lanehost/observer-connect",
} as const

export type ScriptName = keyof typeof SCRIPTS

const extension = (form: Install["form"]): string =>
  form === "source" ? ".ts" : ".js"

/** The argv that runs `name` from `install`: how Node starts there (`node`), then the script. */
export const scriptCommand = (
  install: Install,
  name: ScriptName,
  node: readonly string[],
): readonly string[] => [
  ...node,
  `${install.root}/${SCRIPTS[name]}${extension(install.form)}`,
]

/** Every script's path from the root, without its extension: what the package build starts from. */
export const SCRIPT_ENTRIES: readonly string[] = Object.values(SCRIPTS)

/** The page's package, whose `dist/` a host serves. */
export const pageDir = (install: Install): string =>
  path.join(install.root, "packages", "web")
