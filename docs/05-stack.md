# The stack, and why

TypeScript on Node 24 with no build step, a pnpm workspace, Vite and React
for the page, Vitest, Biome and Playwright. Most of it is inherited from
Kyneta's own conventions, so code moves between the two repos without
reformatting or rewiring.

## What Kyneta established

Read from Kyneta's `examples/`, and kept:

| Concern | Convention |
|---|---|
| Language | **TypeScript**, `strict: true`, `target ES2022`, `moduleResolution: "bundler"`, `noEmit`, `jsx: "react-jsx"` |
| Package manager | **pnpm** |
| Format + lint | **Biome**: `lineWidth 80`, `indentWidth 2`, spaces |
| Tests | **Vitest** |
| UI | **React + `@kyneta/react`** |
| Dev server | **Vite in middleware mode**, sharing one `node:http` server with `ws`, for `pnpm dev`; `pnpm serve` sends Vite's build from the same server, with no Vite (ADR-0148) |
| Verification | a `verify` cascade: fast problems first, then the slower ones |

Kyneta runs TypeScript on Node through `tsx`; pine·trie does not, since
Node 24 strips types natively (below).

The working agreements came with it: no backwards compatibility, delete old
code, fix a pre-existing problem when you see it, and no non-null
assertions (`!`), even in tests (`AGENTS.md`).

## TypeScript, strict, with no build step

Node 24 strips types natively, so `node host/dev.ts` runs as written and
imports name the real file (`./index.ts`; `allowImportingTsExtensions` in
`tsconfig.json`). Stripping does not support enums, namespaces, parameter
properties or decorators. A type error does not stop a run:
`pnpm run typecheck` (`tsc --noEmit`, and the interface's and shell's own
`tsconfig.json`) is the check.

`tsc` is TypeScript 7, the native compiler. It has no JavaScript API to
parse with, so `scripts/prose-names.ts` reads a file's comments with
`oxc-parser`, a root dev dependency beside it. Since TypeScript 6 a
`tsconfig.json` includes no `@types` package unless it names it, so the
root's names `node`.

Types carry the decisions a type system can check. An entry is immutable
and has a required unique id, so its fields are `readonly` (ADR-0004).
`seq` never crosses the wire (ADR-0013): it is never part of a stored or
sent shape, and `projectTranscript(entries, tipId)` cannot accept one. Ids
are branded (`EntryId`, `RunId`, `ThreadId`), minted only where they enter,
which `biome.json`'s `noRestrictedImports` enforces in core, the interface,
the page and the host.

## pnpm, with Kyneta linked

Kyneta is the local checkout, declared with `link:` (`link:../../../kyneta/…`,
from each package), which npm rejects and pnpm resolves. pnpm's
`node_modules` is strict, so a package reaches only what it declares: that
is what enforces every package boundary (`docs/01-architecture.md`). A
Kyneta package's peer dependencies must be declared beside it, though
nothing imports them, which the `//dependencies` note in
`packages/session/package.json` and `packages/web/package.json` says.

`packageManager` pins pnpm 10.18.0. Install with `--frozen-lockfile`: in a
lane, a rewrite of `pnpm-lock.yaml` would drop every macOS package
(`AGENTS.md`).

## Vite, in middleware mode

`apps/pinetrie/host/http.ts` runs Vite in middleware mode on the host's
one `node:http` server, so the page and the Exchange's websocket share a
port and an origin. The upgrade is routed: `/ws` is the Exchange's, and
any other admitted upgrade goes to Vite's HMR listener, which would
otherwise break silently. `pnpm build` writes the page to
`packages/web/dist/`, and `pnpm serve` sends it with no Vite, rebuilding a
page whose inputs changed (ADR-0148, `packages/web/TECHNICAL.md`).

The build targets `esnext`, since the client connects with a top-level
`await`. Do not add `vite-plugin-top-level-await`: it fails the production
build with an swc error, and a modern browser needs no rewrite.

## React and `@kyneta/react`

`packages/web` is React, rendering from the Exchange `connectSession`
(`@pinetrie/session`) owns, handed to `ExchangeProvider`, so Node and the
browser share one connection. What a person sees is decided in
`@pinetrie/interface`, with no React (ADR-0093).

The hooks, verified against Kyneta's source: **`useTracked(thunk)`** is the
derived read; `useValue` takes a `CallableRef`. `useDocStatus` returns the
union `"pending" | "empty" | "populated"`, not an object. A card's text is
bound to its textarea with Kyneta's `attach` (`packages/web/card-box.ts`).

React is held at 19.2, and why is in `packages/web/TECHNICAL.md`. TypeBox
is held at the version pi pins (1.3.27): pi's tools take our schemas, so
the two must be one copy, and it moves with pi.

## Node, not Bun

pi and `pi-agent-core` target Node, and Vite's dev server internals are
coupled to Node's `http`, `net` and `stream` modules.

## Vitest and Biome

Unit tests sit beside the code they test, run by `pnpm test`
(`vitest.config.mjs`). Biome formats and lints with Kyneta's settings
(`biome.json`); `pnpm run lint:fix` applies its fixes.

- **`linter.rules.preset` is `"recommended"` on purpose.** From Biome 2.5,
  a `rules` that configures a group without a preset drops the rules a
  domain recommends, so React's (`useExhaustiveDependencies`, on in
  `@pinetrie/web` because it depends on React) silently stop running, and
  every suppression of them reads as unused.
- **`noDescendingSpecificity` is off for `packages/web/index.html`.** From
  Biome 2.5 it finds selectors there it did not before. The page's
  stylesheet is ordered by component, each rule after the ones it
  overrides, so a lower specificity later is deliberate there.

## Playwright

`pnpm run e2e:browser` drives a real browser. The suite launches its own
Chromium headless shell: in a lane, the one in the default lane image
(`PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`), the build of the
`@playwright/test` the app declares; on the Mac, the one
`pnpm --filter @pinetrie/app exec playwright install chromium-headless-shell`
installs. No server, no endpoint, and a scripted model (ADR-0041).

## The cascade

`pnpm run verify` runs, stopping at the first failure:

```
lint → typecheck → test → proofs:unit → conformance → e2e → e2e:lanes
```

`pnpm run verify:all` adds `e2e:live` and `e2e:browser`. Each gate is in
`AGENTS.md`, Gates.
