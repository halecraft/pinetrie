import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import wasm from "vite-plugin-wasm"

// The client lives in client/, so that is Vite's root and index.html sits
// beside the sources it imports.
//
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
  root: "client",
  plugins: [react(), wasm()],
  build: { target: "esnext" },
  esbuild: { target: "esnext" },
  optimizeDeps: { esbuildOptions: { target: "esnext" } },
  server: { fs: { allow: [".."] } },
})
