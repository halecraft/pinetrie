// Bundle the browser client. One dev dependency (esbuild), no config file.
import { build } from "esbuild"
import { copyFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"

const root = new URL("../", import.meta.url)

const result = await build({
  entryPoints: [fileURLToPath(new URL("client/app.mjs", root))],
  outfile: fileURLToPath(new URL("client/app.bundle.js", root)),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  sourcemap: false,
  logLevel: "info",
})

if (result.errors.length > 0) process.exit(1)

// loro-crdt's bundler entry keeps `new URL("./loro_wasm_bg.wasm", import.meta.url)`,
// so the browser fetches the wasm relative to the bundle's own URL. The bundle
// is served at /app.js, so the wasm must be served at /loro_wasm_bg.wasm.
//
// RESOLVE it rather than hardcoding `node_modules/loro-crdt/...`. esbuild finds
// loro-crdt by Node resolution, which follows our symlink into the Kyneta
// workspace's pnpm store; a hardcoded path can point at a *different* copy.
// When it does, the wasm-bindgen glue in the bundle and the .wasm disagree and
// the browser fails at instantiation with a LinkError naming a `__wbg_*`
// symbol — which is what happened here (glue 1.16.1 vs a stale local wasm).
const require = createRequire(import.meta.url)
const wasmSource = require.resolve("loro-crdt/bundler/loro_wasm_bg.wasm")
const loroVersion = require("loro-crdt/package.json").version

await copyFile(wasmSource, fileURLToPath(new URL("client/loro_wasm_bg.wasm", root)))

console.log(`built client/app.bundle.js`)
console.log(`  loro-crdt ${loroVersion}`)
console.log(`  wasm from ${wasmSource}`)
