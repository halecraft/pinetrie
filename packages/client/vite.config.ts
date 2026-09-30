import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// `target: esnext` because the client connects with a top-level `await`
// (`app.tsx`), which a modern browser supports natively.
export default defineConfig({
  // This file lives in the client package, so that directory is Vite's root.
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react()],
  // One dependency cache per React build (`pnpm run host` is production,
  // `host:react-dev` and the suites development). Vite's cache hash includes
  // NODE_ENV, so a shared one is optimized again at every switch. Relative to
  // `root`.
  cacheDir:
    process.env.NODE_ENV === "production"
      ? "node_modules/.vite-react-prod"
      : "node_modules/.vite",
  build: { target: "esnext" },
  esbuild: { target: "esnext" },
  optimizeDeps: { esbuildOptions: { target: "esnext" } },
  // The linked Kyneta sources sit outside the package, in the sibling kyneta
  // checkout.
  server: {
    fs: { allow: [fileURLToPath(new URL("../../..", import.meta.url))] },
  },
})
