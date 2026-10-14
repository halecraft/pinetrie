# S196 — The host can serve Vite's build of the page instead of Vite, once React is deduplicated, and the build can list its own inputs for a staleness check

- **Status:** Answered
- **Led to:** ADR-0148

**Question.** The host serves the page through Vite's dev server in
middleware mode (`apps/pinetrie/host/http.ts`), even under `pnpm run
host`. Could `pnpm serve` serve `vite build`'s output instead?

1. Does `vite build` of `packages/web` succeed, and how long does it take?
2. Served as static files by the host, beside its websocket, blobs and
   offers, does the built page join and show the board as Vite's does?
3. Can the build record every file it read, so a later `serve` can tell
   that `dist/` is stale after a pull, including the linked Kyneta sources?

**Kill criterion.** The built page cannot reach the board without a change
to the page's code, as opposed to its build configuration.

**Throw away.** A temporary branch in `http.ts` that served `dist/` when
`PROBE_DIST` was set, a temporary plugin in `packages/web/vite.config.ts`,
a Playwright script, the stores under `/tmp/`, and `packages/web/dist/`.
All were reverted or deleted.

## Answers

1. **Yes, in 2.6 s** (1.8 s Vite's own): `dist/index.html` 106 kB and one
   1.37 MB script. Vite warns that `packages/rules/runs.ts`'s `node:path`
   is externalized for the browser; the page never reached it here.
2. **Not as is: the build bundles React twice.** The page rendered the
   join form, then failed on joining with `pageerror: Cannot read
   properties of null (reading 'useRef')`. The bundle held two
   `react.production.js`: pine·trie's `react@19.2.0` and `react@19.2.5`,
   which `@kyneta/react` resolves from the linked Kyneta checkout
   (`../kyneta/workspace/pineta/node_modules`). Vite's dev server
   hides this, since its dependency optimizer serves one React; the same
   steps against Vite joined and showed the board. **`resolve: { dedupe:
   ["react", "react-dom"] }`** in `packages/web/vite.config.ts` fixed
   it: the built page joined and showed the board with no error, as Vite's
   did. A configuration change, so not killed.
3. **Yes.** A plugin's `this.getWatchFiles()` in `generateBundle` listed
   1337 files: `index.html`, every pine·trie package the page imports (web
   98, interface 101, rules 74, core 24, session 21, schema 11, protocol 5,
   shell 5, reads 2), 64 Kyneta sources through the links, and 932 under
   `node_modules`. It does not list `public/` (copied as is) or
   `vite.config.ts`; a stamp adds both, and `NODE_ENV`. Reading and
   hashing (SHA-256) every listed file, 1341 in a second run, 6.3 MB,
   took 27 and 29 ms in two builds.

## Evidence

On the Mac, 2026-10-14. The host ran with `PINETRIE_TOOLS=0
NODE_ENV=production`, a store in `/tmp/`, on port 7399. In both modes a
Playwright page (Chromium headless) loaded `/`, filled the join form,
clicked join, and after 4 s read the body text and collected page errors
and console errors.
