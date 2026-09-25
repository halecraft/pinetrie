import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import wasm from "vite-plugin-wasm"

// loro-crdt ships a wasm-bindgen bundler entry (`new URL("./loro_wasm_bg.wasm",
// import.meta.url)`). vite-plugin-wasm handles that as a first-class concern,
// replacing the hand-rolled copy step in the old esbuild script — the step that
// caused a version-mismatch LinkError by resolving the wasm from a different
// copy than the bundler used.
//
// `target: esnext` because wasm init is top-level await. The usual companion
// plugin (vite-plugin-top-level-await) is deliberately NOT used: it rewrites
// TLA for browsers that lack it, and it currently fails the build with an swc
// error. Our target is a modern browser, which supports TLA natively.
export default defineConfig({
  // This file lives in the client package, so that directory is Vite's root.
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react(), wasm()],
  build: { target: "esnext" },
  esbuild: { target: "esnext" },
  optimizeDeps: { esbuildOptions: { target: "esnext" } },
  // The wasm and the linked Kyneta sources sit outside the package, under the
  // workspace root and the sibling kyneta checkout.
  server: {
    fs: { allow: [fileURLToPath(new URL("../../..", import.meta.url))] },
  },
})
