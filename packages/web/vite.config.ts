import { readdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"
import { STAMP_FILE, stampInputs } from "./stamp.ts"

const root = fileURLToPath(new URL(".", import.meta.url))

/** Every file under `dir`, for the stamp: Vite copies `public/` without reading it. */
const filesUnder = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter(e => e.isFile())
    .map(e => path.join(e.parentPath, e.name))

/** Writes `dist/inputs.json`: what the build read, so a host can tell when it is stale. */
const stamp = (mode: string): Plugin => ({
  name: "pinetrie-stamp",
  apply: "build",
  generateBundle() {
    const files = [
      ...this.getWatchFiles().filter(f => path.isAbsolute(f)),
      path.join(root, "vite.config.ts"),
      ...filesUnder(path.join(root, "public")),
    ]
    this.emitFile({
      type: "asset",
      fileName: STAMP_FILE,
      source: JSON.stringify(stampInputs(files, mode)),
    })
  },
})

// `target: esnext` because the client connects with a top-level `await`
// (`main.tsx`), which a modern browser supports natively.
export default defineConfig(({ mode }) => ({
  // This file lives in the page's package, so that directory is Vite's root.
  root,
  plugins: [react(), stamp(mode)],
  // The linked Kyneta checkout resolves its own React: without this the
  // build bundles two, and the page fails on its first hook. Vite's dev
  // server hides it.
  resolve: { dedupe: ["react", "react-dom"] },
  // One dependency cache per React build (`pnpm dev` is production,
  // `pnpm dev:react` and the suites development). Vite's cache hash
  // includes NODE_ENV, so a shared one is optimized again at every switch.
  // Relative to `root`.
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
}))
