// host/page-build — the page through Vite: built into `dist/` (`pnpm
// build`, `pnpm serve`, the package build), rebuilt before serving when
// anything it read has changed (`isStampFresh`), and served live
// (`pnpm dev`, the suites). The `pinetrie` command never loads this module,
// so Vite is no dependency of the package.

import { readFile } from "node:fs/promises"
import path from "node:path"
import { pageDir, thisInstall } from "@pinetrie/install"
import { isStampFresh, type PageStamp, STAMP_FILE } from "@pinetrie/web/stamp"
import { build, createServer } from "vite"
import { type PageSource, pageDistDir } from "./page.ts"

/** The mode a host builds and serves the page in: React's production build. */
const MODE = "production"

/** Build the page into `dist/` with its own Vite config. */
export async function buildPage(): Promise<void> {
  await build({
    configFile: path.join(pageDir(thisInstall), "vite.config.ts"),
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
 * The page served live by Vite: index.html, module transforms, wasm, HMR,
 * on the host's own server, so there is one port and one origin.
 */
export const livePage = (): PageSource => ({
  kind: "vite",
  open: upgrades =>
    createServer({
      root: pageDir(thisInstall),
      configFile: path.join(pageDir(thisInstall), "vite.config.ts"),
      server: {
        middlewareMode: true,
        // Vite's HMR listener sits on `upgrades`, which never binds, so an
        // upgrade reaches it only through the host's `"vite"` route,
        // admitted. Without one, Vite opens port 24678 and its client
        // connects there.
        ws: { server: upgrades },
        // Admission decides which `Host` gets in (admission.ts): off
        // loopback, any name with the key, such as a tunnel's.
        allowedHosts: true,
      },
    }),
})
