// host/serve — `pnpm serve [folder]`: a host serving Vite's build of the
// page, with no Vite in the process. A page whose inputs changed since its
// build, or that was never built, is built first (`ensurePage`). The rest
// is `server.ts`.
import { ensurePage, readBuiltPage } from "./page.ts"
import { runHost } from "./server.ts"

await runHost("serve", async () => {
  await ensurePage(console.log)
  return readBuiltPage()
})
