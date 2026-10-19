// host/serve — `pnpm serve [folder]`: the page rebuilt first when its inputs
// changed since its build, or it was never built (`ensurePage`), then the
// host `pinetrie serve` runs (`serve-built.ts`).
import { ensurePage } from "./page-build.ts"
import { serveBuilt } from "./serve-built.ts"

await ensurePage(console.log)
await serveBuilt(process.argv.slice(2))
