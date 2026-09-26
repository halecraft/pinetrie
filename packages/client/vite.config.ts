import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// `target: esnext` because the client connects with a top-level `await`
// (`app.tsx`), which a modern browser supports natively.
export default defineConfig({
  // This file lives in the client package, so that directory is Vite's root.
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react()],
  build: { target: "esnext" },
  esbuild: { target: "esnext" },
  optimizeDeps: { esbuildOptions: { target: "esnext" } },
  // The linked Kyneta sources sit outside the package, in the sibling kyneta
  // checkout.
  server: {
    fs: { allow: [fileURLToPath(new URL("../../..", import.meta.url))] },
  },
})
