// host/serve-built — `pinetrie serve [folder]`: a host serving Vite's build
// of the page as it is, with no Vite in the process. An installed package
// ships its page built, and has no sources to build it from.
import { readBuiltPage } from "./page.ts"
import { runHost } from "./server.ts"

/** Serve the folder `args` name, or the current one, until a signal. */
export const serveBuilt = (args: readonly string[]): Promise<void> =>
  runHost("serve", args, readBuiltPage)
