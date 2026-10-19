// host/page — the page a host serves: Vite's, live, under `pnpm dev` (made
// by `page-build.ts`), or Vite's build of it in the page's `dist/`. Nothing
// here loads Vite, so the installed `pinetrie` command never does.

import { readdir } from "node:fs/promises"
import type { IncomingMessage, Server, ServerResponse } from "node:http"
import path from "node:path"
import { pageDir, thisInstall } from "@pinetrie/install"
import { STAMP_FILE } from "@pinetrie/web/stamp"

/** Vite's dev server, as the host uses it. */
export interface LivePage {
  readonly middlewares: (req: IncomingMessage, res: ServerResponse) => void
  close(): Promise<void>
}

/** What a host serves the page from. */
export type PageSource =
  /** Vite, opened on the host's server, its HMR listener on `upgrades`. */
  | {
      readonly kind: "vite"
      readonly open: (upgrades: Server) => Promise<LivePage>
    }
  /** The built page: every file's path in `dist/`, relative, read once at start. */
  | {
      readonly kind: "built"
      readonly dir: string
      readonly files: ReadonlySet<string>
    }

/** No page: every request for one is a 404. A host only the suites' sessions reach serves this. */
export const NO_PAGE: PageSource = { kind: "built", dir: "", files: new Set() }

/** Where the page's build is. */
export const pageDistDir = (): string => path.join(pageDir(thisInstall), "dist")

/**
 * The built page to serve: every file in `dist/` but the stamp, which names
 * the paths of the machine that built it.
 */
export async function readBuiltPage(): Promise<PageSource> {
  const dir = pageDistDir()
  const files = (await readdir(dir, { recursive: true, withFileTypes: true }))
    .filter(e => e.isFile())
    .map(e => path.relative(dir, path.join(e.parentPath, e.name)))
    .filter(f => f !== STAMP_FILE)
  return { kind: "built", dir, files: new Set(files) }
}
