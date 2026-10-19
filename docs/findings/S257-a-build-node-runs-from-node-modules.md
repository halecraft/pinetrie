# S257 — pine·trie, its types stripped in place, runs from an npm install once three lookups stop assuming the repo; a bundle saves at most 100 ms and breaks more

- **Status:** Answered
- **Led to:** ADR-0189

Published to npm, pine·trie's code sits under a `node_modules`, and Node
refuses to strip types there. Measured on Node 24.22.0 in a lane: a `.ts`
module under `node_modules/x/`, imported by name, fails with
`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` before it runs. So every
`.ts` the host runs (`apps/pinetrie/host/serve.ts` and what it loads,
`apps/pinetrie/scripts/`) and every `.ts` a lane runs from the mount
(`packages/pi/lane-helper.ts` and its `@pinetrie/channel`,
`@pinetrie/rules`) needs JS instead. The repo has no build for its
TypeScript (`docs/05-stack.md`); the page's Vite build
(`packages/web/vite.config.ts`) is the only one.

The npm scope `@pinetrie` belongs to someone else (it publishes
`@pinetrie/ngx-batch-requests` and two more); the unscoped name `pinetrie`
is free (registry, 2026-10-19). So what ships is one package, `pinetrie`,
with the workspace packages inside it, not twenty.

The build this spike tries is the smallest one that matches how the code
runs now: each `.ts` file stripped of its types by Node's own
`stripTypeScriptTypes` (`node:module`), which blanks them with whitespace,
so lines and columns stay as in the source; and each import of a `.ts`
file, relative or `@pinetrie/*`, rewritten to its `.js`. The files keep
the repo's layout, so a read of the code's own files
(`import.meta.dirname`) finds what it found in the repo. A bundle is the
alternative: it would move each module that reads its own files, and
miss each file the code runs by a path in a string (the lane helper,
the observer's server and connection).

## Brief

**Size:** M · **Depends on:** nothing

**Question.** Does a `pinetrie` tarball built that way, installed with
`npm install` into a clean directory, start `serve` on a folder and draw
the page, with pi and Kyneta `4.0.0` (S258) as its dependencies?

1. What breaks, file by file, and why: each read of the code's own files,
   each path the code runs by name (`HELPER`, `OBSERVER_SERVER`,
   `OBSERVER_CONNECT`), each resolution of a workspace package by name
   (`pageDir`), `packages/pi/deep.ts` (it imports pi's deep modules from
   `./node_modules/` beside its own file, pnpm's layout), and the page
   build's freshness check (`ensurePage`).
2. Does `stripTypeScriptTypes` take every file the host runs? It is
   experimental in Node 24, and `tsconfig.json` does not set
   `erasableSyntaxOnly`.
3. How long the build takes, the tarball's size, and what `files` must
   list.
4. How long `serve` takes to listen, from the install, against the same
   from the repo, and against a bundle of `serve.ts`, to say whether a
   bundle is worth its cost.

**Kill criterion.** If the stripped layout cannot run `serve` without a
change to how the code finds its own files, the plan's first task is the
one module that resolves pine·trie's own files from its install root.
If it cannot run at all, the package is a bundle, and its entries and
assets are listed once, by hand, with a check that each path the code
runs is among them.

**Throw away.** The tarballs and the install directories. Keep the build
script beside this file if the plan builds on it.

## Answers

Run 2026-10-19 in a lane (Linux arm64, Node 24.22.0, npm 11.19.1), on a
copy of the repo with Kyneta at `4.0.0` (S258). The build is
`build.mjs` beside this file: from the entries it follows every import
(oxc-parser), strips each file with `stripTypeScriptTypes` in `strip`
mode, rewrites each import of a `.ts` file to its `.js` by a relative
path (an `@pinetrie/*` import through its package's `exports`), copies
the other files of each package it built, and writes a `package.json`
whose `dependencies` are the third-party packages imported, at the
version the workspace declares. Packed with `npm pack`, installed with
`npm install <tarball>` into an empty directory, run as
`node node_modules/pinetrie/apps/pinetrie/host/serve.js <folder>`.
`time-listen.mjs` times a host from spawn to its `listening` line.

1. **It runs.** After the four fixes below, applied by hand in the
   install, `serve` started on a plain folder, served the page, and in
   Chromium a person joined and the page drew the sidebar and the board,
   with no page error or console error. What broke, in the order it
   stopped the host:
   - **`packages/pi/deep.ts`** imports pi's deep modules from
     `./node_modules/` beside itself, pnpm's layout; npm puts pi at the
     install's top. It ran with the directory found by
     `import.meta.resolve("@earendil-works/pi-agent-core")`.
   - **A missing dependency:** `@earendil-works/pi-coding-agent` is
     loaded only through `deep.ts`'s computed `import()`, which no import
     graph sees, so the build must name it.
   - **`pageDir`** (`apps/pinetrie/host/page.ts`) resolves
     `@pinetrie/web/package.json` by name, on purpose: the app declares
     the page's package, and pnpm links it. The build broke it, not the
     code. The build rewrites each `@pinetrie/*` import to a relative
     path and installs nothing under those names, and this lookup is a
     string handed to `require.resolve`, not an import, so the build
     never saw it. It ran with a path from its own directory, which only
     shows that nothing else stood in the way.
   - **`ensurePage`**: the page's `dist/inputs.json` holds the absolute
     paths of the machine that built it, so on any other machine the page
     reads as stale and `serve` would run Vite with no sources. It ran
     with the check skipped. The shipped `inputs.json` also publishes
     the builder's paths.
   - **`playwrightVersion`** (`apps/pinetrie/host/work/setup.ts`):
     `@playwright/test` is not installed, so the host started but said
     "lanes of their own cannot start", and two jobs that use the lanes'
     setup failed. S259's.

   Read from source, not run (S259 runs lanes): the paths the code runs
   by a string name `.ts` files, and break: `HELPER`, `HOP_IN_LANE`,
   `SERVER`, `ONCE`, `TAR_OUT`, `FILE_OUT`, `OBSERVER_SERVER`,
   `OBSERVER_CONNECT`; and `observerSources` copies the `.ts` files of
   `core`, `channel` and `lanehost` into the machine role's image to run
   `observer-server.ts` there. No read of the code's own files by
   `import.meta.dirname` broke on the way to the page, since the layout
   is the repo's. `vite` is a runtime dependency only because
   `page.ts` and `http.ts` import it at the top; `serve` never builds.
2. **`stripTypeScriptTypes` took every file**: 580 at the start, 589
   after the latest accepted work came in, none refused. It prints
   Node's experimental warning once. With `erasableSyntaxOnly` added to
   `tsconfig.json`, `pnpm run typecheck` fails on one file only,
   `packages/channel/wire.test.ts`, for two parameter properties.
3. **Cost and contents.** The build takes 0.40 to 0.44 s; the page's
   Vite build about 1 s. 580 built files and 292 others, of which 256 are
   `packages/web/public/noun-icons`, which `dist/` already holds. With
   `public/` left out: 877 files, 1.7 MB packed, 6.0 MB unpacked. The
   install took 16 s and 181 MB of `node_modules`. `files` must hold
   the built `.js`; `packages/lanes/image/`, the two seccomp files,
   `packages/lanehost/observer/` and its Containerfiles,
   `packages/vm/{image,builder,launcher}/`, `packages/pi/skills/` and
   `packages/pi/lane*.md`; and `packages/web/dist/` without
   `inputs.json`. The dependencies the graph found: pi's `pi-agent-core`
   and `pi-ai`, five `@kyneta/*`, `@parcel/watcher`, `ignore`,
   `mdast-util-from-markdown`, `mdast-util-gfm`,
   `micromark-extension-gfm`, `typebox`, `unbash`, `vite`, `ws`; with
   `pi-coding-agent` and `@kyneta/sql-store-core` (a peer the app meets)
   named by hand.

   npm 11 held back the install scripts of `@parcel/watcher`
   (`node-gyp rebuild`), `esbuild`, `protobufjs` and `@google/genai`,
   and asked for their approval. `@parcel/watcher` loaded anyway, from
   its prebuilt `@parcel/watcher-linux-arm64-glibc`. The Mac's is
   S260's.
4. **Startup.** From spawn to listening, 7 runs each, an empty
   session: the install's JS 834 to 869 ms; the repo's `.ts` 968 to
   1013 ms. Loading the host's modules (`host/index` and `host/server`)
   takes about 665 ms as JS and 728 ms as `.ts`, and the third-party
   packages alone take 564 ms (`pi-coding-agent`'s entry 366 ms of it).
   So pine·trie's own 580 files cost about 100 ms, which is the most a
   bundle could save. An esbuild bundle of `serve.ts` with the
   third-party packages external (1.27 MB) does not run: two modules
   decide whether they are the program by `import.meta.filename ===
   process.argv[1]` (`packages/ssh/hop.ts`,
   `packages/docker/seccomp-nested.ts`), which is true for every module
   inside a bundle, so it ran `hop.ts`'s command line and exited. It
   also cannot sit in the repo's `apps/pinetrie/host`, where pnpm's
   strict tree has no pi.

**The kill criterion holds in its first half.** The stripped layout runs
`serve` only after the code stops finding its own files and pi's as the
repo lays them out: `deep.ts` by pnpm's folders, `pageDir` by a package
name the build does not install, and the page's freshness by the
builder's paths. So the
plan's first task is one module that resolves pine·trie's own files from
its install root, with the paths run by name and the observer's sources
through it. A bundle is not worth it.
