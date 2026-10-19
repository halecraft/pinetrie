# ADR-0189 — pine·trie is published as one npm package, `pinetrie`: the repo's layout with types stripped in place, and its own files and scripts found through one registry

Numbered ADR-0186 until 2026-10-19, when two files held ADR-0186.

- **Status:** Accepted (Duane, 2026-10-19)
- **Area:** `docs/05-stack.md`
- **Evidence:** S257, S258
- **Revised:**
  - 2026-10-19: the registry hands out whole commands, so no path leaves it,
    rather than a branded `ScriptPath` held by checks; the build reads the
    packages `deep.ts` reaches from its own list, refuses an `import()` of a
    computed name and a lane helper that reads beside itself; Kyneta's
    peer-only declarations are gone.
- **Amended by:**
  - ADR-0190: the lane helper is the one script built as a bundle, its
    third-party packages inside it; the package is MIT, for macOS and Linux,
    on arm64 and x86_64.

**Context.**

- **Node will not strip types under `node_modules`.** An installed
  package's `.ts` fails with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`
  before it runs (S257), so publishing needs a build. pine·trie has none
  for its TypeScript: Node 24 runs the repo's `.ts` as written
  (`docs/05-stack.md`).
- **The workspace's packages are not a public API.** They exist so pnpm's
  strict `node_modules` enforces each one's boundary by resolution
  (`docs/01-architecture.md`). The npm scope `@pinetrie` belongs to someone
  else; the name `pinetrie` is free (S257).
- **The code finds things two ways.** By package name: every
  `@pinetrie/*` import, and `pageDir`'s `require.resolve` of
  `@pinetrie/web`. By position: a path from its own file or from the
  install's root, for the lane image, the skills, the VM's sources and
  the seccomp files, and for eight scripts the host runs in another
  process by naming their `.ts` files (the lane helper, the ssh hop,
  lanehost's server, its one-shot, its tar and file readers, the
  observer's server and its connection). Lanes mount the install at
  `/pinetrie` and run those files there.
- **S257 measured both builds.** Stripping each file in place, keeping the
  layout, ran `serve` from an npm install and drew the page once three
  lookups stopped assuming the repo. A bundle of `serve` did not run, and
  could save at most the 100 ms pine·trie's own modules take to load, of
  860 ms to listen.

**Decision.**

- **One package, `pinetrie`.** The workspace packages stay private and
  ship inside it; their manifests, pnpm and the boundaries enforced by
  resolution are unchanged. Its dependencies are registry versions only:
  Kyneta's `link:` moves to `4.0.0` (S258).
- **The build strips types in place and keeps the layout.** From its
  entries it follows every import and, for each `.ts` file, blanks the
  types with Node's own `stripTypeScriptTypes`, so lines and columns stay
  the source's; rewrites each `./x.ts` to `./x.js`, and each
  `@pinetrie/<package>[/<sub>]` to the relative `.js` path its package's
  `exports` names. Every other file of a built package is copied as it
  is, and the page is Vite's build, shipped without its `inputs.json`. The
  build writes the package to `dist/pinetrie/`, with a `package.json`
  whose `dependencies` are the third-party packages the import graph
  reaches, at the versions the workspace declares, and the pi packages
  `packages/pi/deep.ts` loads by file, which it declares in a list the
  build reads; an `import()` of a computed name anywhere else refuses the
  build. Kyneta's peers are met by the package manager, so no manifest
  declares a package it never imports. `npm pack` makes the tarball that is tested
  and published. Development runs `.ts` from the repo as now: nothing in
  the daily loop builds.
- **pine·trie's own files are found through one package**, which knows
  the install's root from its own position, the mount (`/pinetrie`), and
  which form is running, `.ts` or `.js`, from its own file's extension:
  - **The scripts the host runs by path are a registry**: each by name,
    its path from the root without an extension. It hands out only a
    script's whole command (`scriptCommand`: how Node starts there, then
    the script in the install's form), so no script path exists outside
    it to misspell or forge. A script is added by one line; the build
    takes the registry as its entries, so a registered script cannot be
    left out of the package.
  - The page's folder, which `pageDir` resolves by name today, is a path
    from the root.
  - pi's deep modules are found by resolving each pi package, not by
    `./node_modules/` beside `packages/pi/deep.ts`.
- **The built form serves the page it ships, and never builds it.** Vite
  is loaded only to build the page or for `pnpm dev`, so it is not a
  dependency of the package.
- **One command**, `pinetrie`, with `serve`, `sign-in`, `sign-out`, `tidy`
  and `session`; Node 24 or later (`engines`).
- **`tsconfig.json` sets `erasableSyntaxOnly`**, so `tsc` refuses what
  stripping cannot take.
- **Checks, each with a mutation that proves it can fail:** the tarball
  built, installed by npm into an empty project, serves its page, gets its
  lanes ready, and a lane runs from its files; the build's plan, unit-tested
  (its rewrites, its dependencies, the files it copies and leaves out, its
  refusals); the registry's paths are files; no shipped file names a `.ts`
  path in a string outside `@pinetrie/install`; and the observer image's
  folders hold every module its server loads.

**Consequences.**

- The repo's layout is the published layout, so a read beside its own
  file (the lane image, the skills, the VM's sources) works installed as
  in the repo, and stack traces name the source's lines.
- `stripTypeScriptTypes` is experimental in Node 24. The build pins it by
  pinning Node's major version in `engines` and CI, and the tarball's
  test catches a change in what it emits.
- Eight constants, `PINETRIE_INSTALL`, `PINETRIE_MOUNT` and `pageDir`'s
  lookup move into the new package; `observerSources` copies files of the
  running form.
- The build costs about 0.4 s, the page's about 1 s; the tarball is about
  1.7 MB and 880 files (S257).
- Still open, for S259: what a lane needs from each install layout
  (global, local, `npx`), the folder `serve` opens when none is named
  (pine·trie's own repo today), and the lane image's Playwright version,
  read today from a dev dependency an install lacks.

**Alternatives rejected.**

- **A bundle per entry** (esbuild, Vite): at most 100 ms saved (S257). It
  moves each module that reads beside itself, misses each file run by a
  path in a string, and makes every `import.meta.filename ===
  process.argv[1]` true, so the bundle of `serve` ran the ssh hop's
  command line and exited.
- **`tsc` emitting JavaScript** with `rewriteRelativeImportExtensions`: a
  second compiler between the source and what runs, where development
  runs Node's own stripper; it still leaves the `@pinetrie/*` imports to
  rewrite.
- **The workspace packages installed under their own names inside the
  package** (`bundleDependencies`): lookups by name would hold, but the
  files would leave the repo's layout, and every lookup by position
  breaks, the scripts a lane runs from the mount among them.
- **One package with `#` imports** (`package.json` `imports`): it works
  from the repo and installed, but a `#` name resolves only through the
  nearest `package.json`, which cannot point outside its folder (Node
  refuses `../`), so the per-package manifests would go, and with them
  the boundaries enforced by resolution, back to a check of syntax.
- **Publishing the workspace packages** to npm: they are not an API, and
  the scope is taken.
