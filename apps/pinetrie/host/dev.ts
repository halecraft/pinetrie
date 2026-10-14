// host/dev — `pnpm dev [folder]`: a host whose page Vite serves, reloading
// it when its code changes. `pnpm dev` sets NODE_ENV=production, so Vite
// serves React's production build and a long thread stays quick to type in;
// `pnpm dev:react` sets NODE_ENV=development, for React's warnings, render
// timeline and Fast Refresh. The rest is `server.ts`.
import { runHost } from "./server.ts"

await runHost("dev", async () => ({ kind: "vite" }))
