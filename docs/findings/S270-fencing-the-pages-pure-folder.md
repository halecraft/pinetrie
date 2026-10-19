# S270 — A pure folder inside the page cannot be fenced by resolution, but a TypeScript config that stubs React, with Biome's restricted imports, refuses every spelling that reaches React or a component

- **Status:** Answered
- **Led to:** ADR-0194

**Question.** Modules that decide from the browser's inputs but draw
nothing (S269) would move from `@pinetrie/interface` to a pure folder in
`@pinetrie/web`, keeping tests that need no DOM. `docs/01-architecture.md`
("Every boundary is enforced by resolution") records why pine·trie
dropped a syntax scan: three spellings evaded it. Can a folder's purity,
no React, no component or hook, no DOM, be enforced as firmly?

1. Can resolution fence a folder inside a package that declares React?
2. What does a TypeScript config refuse, and what does Biome's
   `noRestrictedImports` refuse, of each spelling: a static import, a
   type-only import, `export … from`, `export *`, a bare side-effect
   import, a subpath, `import("…")` with a string and with a template
   literal, a computed `import(n)`, `createRequire`, JSX, an import of a
   component or hook that imports React itself, a DOM global, `fetch`?

**Kill criterion.** If a spelling the bundler would follow passes both
checks, the pure modules go to a workspace package of their own instead,
fenced by resolution.

**Throw away.** The probes (`packages/web/__probe__/`, `/tmp/probe/`),
deleted.

## Answers

1. **No.** A `package.json` in a folder under `packages/web/` resolves
   `react` anyway: Node walks up to `packages/web/node_modules`. Measured:
   `import("react")` from such a folder resolves.
2. **Together they refuse every spelling the bundler follows:**

   | spelling | `tsc` with React stubbed | Biome |
   |---|---|---|
   | `import { useState } from "react"` | ✅ TS2305 | ✅ |
   | `import type { FC } from "react"` | ✅ TS2305 | ✅ |
   | `export { memo } from "react"` | — | ✅ |
   | `export * from "react-dom/client"` | ❌ (an empty stub exports nothing) | ✅ with a `react-dom/**` pattern |
   | `import "react"` | ❌ (resolves to the stub) | ✅ |
   | `react/jsx-runtime` | ✅ | ✅ with a `react/**` pattern |
   | `await import("react")` | ✅ TS2339 | ✅ |
   | ``await import(`react`)`` | ✅ TS2339 | ❌ |
   | `await import(n)` | — | ❌ |
   | `createRequire(…)("react")` | — | ✅ (`noNodejsModules` refuses `node:module`) |
   | JSX in a `.tsx` there | ✅ TS7026 | — |
   | a component or hook imported (`../use-drag.ts`) | ✅ its own React imports fail, transitively | ✅ with `../*.tsx`, `../use-*` patterns |
   | `window`, `document` | ✅ TS2304 (no DOM library) | — |
   | `fetch`, `Blob`, `URL` | ❌ (Node's types declare them) | ❌ by default |
   | `fetch` named bare | ❌ | ✅ with `noRestrictedGlobals` denying it |
   | `globalThis.fetch` | ❌ | ❌ |

   A computed `import(n)` passes both, but no bundler follows it: in the
   page it would fail at run time, as in any package. `fetch` passes both,
   as it passes interface's own check today (S269); refusing it would
   need a config without Node's types, and core and rules use
   `TextEncoder`, `AbortSignal` and `URL` from them (measured: 104
   errors with `types: []`, all in packages the folder imports). Biome's
   `noRestrictedGlobals`, denying `fetch`, `XMLHttpRequest` and
   `WebSocket`, refuses each named bare, and not `globalThis.fetch`: a
   fence for the usual spelling, in interface as in the folder.

**The config that measured this:** it extends the root's, sets
`lib: ["ESNext"]` as `packages/interface/tsconfig.json` does, and maps
`react`, `react/*`, `react-dom`, `react-dom/*` and `@kyneta/react` to an
empty `.d.ts` through `paths`. It type-checks the folder and everything it
imports, so a component or hook it reaches fails in the component's own
file. `pnpm run typecheck` would run it as it runs interface's.

**Biome is no syntax scan of the kind that failed:** it parses, as the
page's `noNodejsModules` fence and the id-minting fence in `biome.json`
already rely on. Its gap is the template-literal import, which the
TypeScript config covers; the config's gaps are `export *` and a bare
import, which Biome covers.

**So the folder is fenced as firmly as a package** for every spelling a
bundler follows, and the kill criterion is not met. A workspace package
would be no firmer against a global, since resolution fences imports
only, and would add a manifest, a lockfile importer written by hand
(AGENTS.md) and another index to keep, for one importer.

**Corrected by S273:** both checks fail only the type check and the lint;
a React import in the folder still resolves in Vitest and in Vite. A
package fails at every stage, and its cost here was overstated.

**Measured** 2026-10-19 with Biome 2.5.15 and TypeScript 7.0.2, the
workspace's.
