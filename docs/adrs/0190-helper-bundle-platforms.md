# ADR-0190 — The lane helper ships as one self-contained file; a host serves the folder it starts in; pine·trie runs on Apple silicon Macs and on Linux on arm64 and x86_64; it is MIT-licensed

Numbered ADR-0187 until 2026-10-19, when two files held ADR-0186.

- **Status:** Accepted (Duane, 2026-10-19)
- **Area:** `docs/05-stack.md`
- **Evidence:** S259
- **Amends:**
  - ADR-0189: the lane helper is the one script built as a bundle, its
    third-party packages inside it; the package is MIT, for macOS and Linux,
    on arm64 and x86_64.

**Context.**

- **A lane runs the helper from the mount alone** (S259). Of the eight
  scripts pine·trie runs by path, only the helper reaches third-party
  packages (pi's `pi-agent-core`, `ignore`, the markdown parser,
  `typebox`). npm puts them inside the package for a global install, and
  beside it for a local one or `npx`, where `/pinetrie` does not reach;
  runc refuses a second mount inside the read-only `/pinetrie`.
- **ADR-0189 rejected bundles** for what they break: reads beside a
  module's own file, files run by a path in a string, and
  `import.meta.filename === process.argv[1]`. The helper's 138 files hold
  none of them (S259).
- **With no folder named, a host serves pine·trie's own repo**
  (`apps/pinetrie/host/invocation.ts`, `apps/pinetrie/scripts/tidy.ts`).
  An installed `pinetrie` has no repo.
- **Lanes assume arm64** (S259): the lane runtime's loader, the default
  image's downloads of jj, rg, fd, sd, Docker and buildx. The observer's
  open flags are the same on x86_64, its build maps the architecture, and
  both seccomp profiles cover amd64. The lane VM needs Apple silicon.
- **The repo has no licence.** pi and Kyneta are MIT.

**Decision.**

- **The helper is built as one file** with its third-party packages
  inside it, beside its stripped sources in the package, and the
  registry's helper entry names it in the built form. Every other script
  stays stripped in place. A check fails when a file the helper imports
  reads beside itself or asks whether it is the program
  (`import.meta.dirname`, `import.meta.filename`, `import.meta.url`,
  `process.argv[1]`).
- **With no folder named, a host serves the folder it was started in**
  (pnpm's `INIT_CWD` under `pnpm dev`), and `tidy` tidies it: from the
  repo's root that is the repo, as now.
- **pine·trie runs on macOS on Apple silicon, and on Linux on arm64 and
  x86_64.** The package says `"os": ["darwin", "linux"]` and
  `"cpu": ["arm64", "x64"]`. The lane runtime's loader and the default
  image's downloads follow the machine's architecture; the lanes suite
  runs on an x86_64 Linux machine as well as on arm64 before a release.
- **pine·trie is MIT-licensed**: a `LICENSE` at the root, and
  `"license": "MIT"` in the package.

**Consequences.**

- Every install layout runs lanes from `/pinetrie` alone, at the cost of
  a 623 KB file; a lane's helper loads in 23 ms rather than 173 ms (S259).
- The build has two steps for scripts, a strip and the helper's bundle,
  and the bundle needs a bundler declared as a dev dependency (esbuild,
  in the install today only through pi's `chord`, and as Vite's optional
  peer).
- `pnpm dev` started from a subfolder serves that subfolder, where it
  served the repo.
- x86_64 needs a machine of its own to test on: an arm64 lane cannot run
  amd64 containers.
- An Intel Mac cannot run lanes: the lane VM needs Apple silicon.

**Alternatives rejected.**

- **npm's `bundleDependencies`** for the helper's packages (S259): it
  works, but the tarball grows from 1.6 MB to 19.3 MB and an install from
  16 s to 36 s, since pi's agent core brings pi-ai and its providers'
  SDKs.
- **Supporting global installs only**: `npx pinetrie` and a project's own
  install would fail at the first lane.
- **The repo as the default folder for a repo checkout, and the current
  folder for an install**: two rules where one gives the same result from
  the repo's root.
- **arm64 only**: most Linux servers are x86_64.
