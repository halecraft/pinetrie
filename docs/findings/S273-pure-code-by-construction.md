# S273 — Pure code type-checked against a short list of allowed globals cannot name `fetch` at all, and a package fences React where a folder's config cannot

- **Status:** Answered
- **Led to:** ADR-0194

**Question.** S270 fenced a pure folder inside the page with a TypeScript
config and Biome, and denied `fetch` with Biome's `noRestrictedGlobals`,
which `globalThis.fetch` passes. pine·trie prefers what holds by
construction to what a check finds (`docs/01-architecture.md`, "The pi
rule is correct-by-construction, not checked").

1. Which globals do `@pinetrie/interface`, `@pinetrie/shell` and the
   page's pure modules, with everything they import, actually name? Can
   they be type-checked against exactly those, so that `fetch`,
   `globalThis.fetch`, `process`, `Buffer`, `XMLHttpRequest` and
   `localStorage` do not exist there?
2. Where does each kind of fence fail: the folder's config, and a
   package's manifest?

**Kill criterion.** If the list of globals needed grows past what pure
code plainly needs (text codecs, URLs, an abort signal), or cannot be
written without Node's types, the no-I/O rule stays Biome's.

**Throw away.** The probe configs and declarations under `/tmp/allow/`,
deleted.

## Answers

1. **Eight globals, and nothing else.** With `lib: ["ESNext"]` and
   `types: []`, type-checking interface (its tests and fixtures aside),
   shell, and the page's pure modules (`popover-place.ts`,
   `image-click.ts`, `colors.ts`, `same-props.ts`, `message-props.ts`)
   with everything they import named only:

   | global | named by |
   |---|---|
   | `TextEncoder`, `TextDecoder` | `packages/core/images.ts`, `packages/rules/review.ts`, `packages/rules/shares.ts` |
   | `URL`, `URLSearchParams` | `packages/rules/review.ts` |
   | `AbortSignal` | `packages/core/runs.ts` |
   | `crypto` | `packages/session/` (`connect.ts`, `ids.ts`, `host-line.ts`, `acting.ts`) |
   | `setTimeout`, `clearTimeout` | `packages/session/` (`connect.ts`, `attention-doc.ts`, `inventory-slots.ts`) |

   Plus `fetch` and `Blob` in `packages/interface/upload.ts`, and the DOM
   types `MouseEvent` (in a `Pick`, `image-click.ts`) and `DOMRect`
   (`popover-place.ts`), each a type a structural one replaces.

   A declaration file of those eight (classes and functions with the
   members used, about ten lines) type-checks all of it but those four
   names. In the same config, a probe's `fetch(…)`, `globalThis.fetch(…)`
   (TS7017: `typeof globalThis` has no such member), `process.env`,
   `Buffer.from`, `new XMLHttpRequest()` and `localStorage` each fail,
   and `new TextEncoder()` passes. The kill criterion is not met.

   The session's timers and `crypto` are on the list because interface
   imports the session, and TypeScript checks every file a program
   reaches. Once `SessionClient.upload` takes its `fetch` from its caller,
   as `connectSession` already takes the `WebSocket` constructor, the
   session names no `fetch` of its own, and only the caller (the page's
   `main.tsx`, a Node program) does.
2. **The folder's config fails only `tsc -p` on it.** A React import in
   the folder resolves in Vitest and in Vite, since `packages/web`
   declares React (S270). **A package's manifest fails at type-check, in
   Vitest and in Vite alike**: an undeclared import is `TS2307` and
   `ERR_MODULE_NOT_FOUND` (`docs/01-architecture.md`, "Every boundary is
   enforced by resolution"). The globals list is the type checker's, like
   the branded ids: it fails `pnpm run typecheck`, which `pnpm run verify`
   runs, and never a run, since Node strips types.

**S270's cost of a package was overstated.** It counted another index to
keep, but the modules that would form it are exported by name from
interface's index today: a package moves those export lines rather than
adding them. What it adds is a manifest, a lockfile importer written by
hand, and a pin in `workspace.test.ts`.

**Measured** 2026-10-19 with TypeScript 7.0.2, the workspace's, after
accepted work's merge of that day.
