// pnpm build — the page into `packages/web/dist/`, then the lane VM's image
// where this machine runs one (`pnpm vm:build`'s path, never forced).
// Exits 1 when the image is needed and cannot be built.

import { buildPage } from "../host/page.ts"

console.log("[build] the page")
const started = Date.now()
await buildPage()
console.log(
  `[build] the page, built in ${((Date.now() - started) / 1000).toFixed(1)} s`,
)
await import("./vm-build.ts")
