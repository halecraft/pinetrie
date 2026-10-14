// host/page — the page a host serves: through Vite (`pnpm dev`), or Vite's
// build of it in the page's `dist/` (`pnpm serve`, `pnpm build`), rebuilt
// before serving when anything it read has changed (`isStampFresh`).

import { readdir, readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import path from "node:path"
import { isStampFresh, type PageStamp, STAMP_FILE } from "@pinetrie/web/stamp"
import { build } from "vite"

/** What a host serves the page from. */
export type PageSource =
  | { readonly kind: "vite" }
  /** The built page: every file's path in `dist/`, relative, read once at start. */
  | {
      readonly kind: "built"
      readonly dir: string
      readonly files: ReadonlySet<string>
    }

/**
 * The page's package. Found by module resolution, not a relative path: the
 * app depends on it, and where it sits on disk is its business.
 */
export const pageDir = (): string =>
  path.dirname(
    createRequire(import.meta.url).resolve("@pinetrie/web/package.json"),
  )

export const pageDistDir = (): string => path.join(pageDir(), "dist")

/** The mode a host builds and serves the page in: React's production build. */
const MODE = "production"

/** Build the page into `dist/` with its own Vite config. */
export async function buildPage(): Promise<void> {
  await build({
    configFile: path.join(pageDir(), "vite.config.ts"),
    mode: MODE,
    logLevel: "error",
  })
}

/** Whether `dist/` is the page as its inputs stand now. */
async function isPageFresh(): Promise<boolean> {
  const stamp = await readFile(path.join(pageDistDir(), STAMP_FILE), "utf8")
    .then(t => JSON.parse(t) as PageStamp)
    .catch(() => null)
  return stamp !== null && isStampFresh(stamp, MODE)
}

/** Build the page unless `dist/` is fresh, saying so first. */
export async function ensurePage(log: (line: string) => void): Promise<void> {
  if (await isPageFresh()) return
  log(
    "[host] the page changed since it was built, or never was: building it (about 3 s)",
  )
  await buildPage()
}

/**
 * The built page to serve: every file in `dist/` but the stamp, which names
 * this machine's paths.
 */
export async function readBuiltPage(): Promise<PageSource> {
  const dir = pageDistDir()
  const files = (await readdir(dir, { recursive: true, withFileTypes: true }))
    .filter(e => e.isFile())
    .map(e => path.relative(dir, path.join(e.parentPath, e.name)))
    .filter(f => f !== STAMP_FILE)
  return { kind: "built", dir, files: new Set(files) }
}
