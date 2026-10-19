# S259 — A lane runs from an installed pine·trie in every layout once its helper is one self-contained file; the other scripts need nothing beyond the package

- **Status:** Answered
- **Led to:** ADR-0190

A lane mounts pine·trie's install read-only at `/pinetrie`
(`PINETRIE_INSTALL`, `packages/lanes/lane.ts`), and today that install is
the repo: the lane runs `/pinetrie/packages/pi/lane-helper.ts` on the
runtime's Node, its imports resolve through the repo's pnpm
`node_modules`, and the agent reads `/pinetrie/packages/pi/lane*.md`.
Installed from npm, the install is a package directory whose
dependencies can sit somewhere else: in its own `node_modules` for a
global install, in the project's top `node_modules` for a local one, in
npm's cache for `npx`.

The repo is assumed in other places too:

- with no folder named, the host serves pine·trie's own repo
  (`apps/pinetrie/host/invocation.ts`), where an installed command would
  serve the working directory;
- the default image's browser follows the app's `@playwright/test`
  (`playwrightVersion`, `apps/pinetrie/host/work/setup.ts`), a dev
  dependency, absent from an install;
- `serve` builds the page into `packages/web/dist` when its inputs changed
  (`ensurePage`, `apps/pinetrie/host/page.ts`), which a global install may
  not let it write.

## Brief

**Size:** M · **Depends on:** S257 (the build the tarball holds)

**Question.** From S257's tarball, installed globally, locally, and run
by `npx`: does a lane start, open its channel, and run one command and
one model turn on the scripted model; and what must the mount hold for
it?

1. Does the helper resolve its imports from the mounted package alone in
   each layout? If not, does a self-contained helper bundle (pi's
   `pi-agent-core` inside it) need nothing beyond itself and the notes?
2. Which of the lane notes and the image's files (`packages/lanes/image/`)
   does a lane read from the mount, and do they need `.ts` sources at all?
3. Can the default image's Playwright version be a value in the package
   (a pinned constant, or a dependency), with the image built the same?
4. Does `serve` start with a prebuilt `packages/web/dist` it cannot write,
   and never call Vite?

**Kill criterion.** If a lane needs the dependencies of the package and
one install layout does not put them under the mount, the published
package supports only the layouts that do, or ships a self-contained
helper; the answer says which.

**Throw away.** The installs, the lanes and their repos.

## Answers

Run 2026-10-19 in a lane (Linux arm64, Node 24.22.0, npm 11.19.1), on
the latest accepted work with Kyneta at `4.0.0`, built by S257's
`build.mjs` (1.6 MB, 887 files), and installed three ways: `npm install
-g --prefix`, `npm install` into an empty project, and `npx
--package=<tarball>`. The lanes were the suite's own (`pnpm run
e2e:lanes`, one scenario at a time), run from a copy of the repo whose
`PINETRIE_INSTALL` named the local install, with the eight paths run by
name set to `.js` and `observerSources` reading the install.

1. **Which script needs what.** Following each script's imports: the
   lane helper reaches pi's `pi-agent-core`, `ignore`, the markdown
   parser (`mdast-util-from-markdown`, `mdast-util-gfm`,
   `micromark-extension-gfm`) and `typebox`. The other seven (the ssh hop,
   lanehost's server, one-shot, tar and file readers, the observer's
   server and connection) reach no third-party package.
2. **Where npm puts them.** Global: inside the package
   (`lib/node_modules/pinetrie/node_modules/`). Local and `npx`: beside
   it, in the top `node_modules`. Run from a container with the package
   alone at `/pinetrie`, the helper started and said it was ready from the
   global install, and failed from the other two: `Cannot find package
   '@earendil-works/pi-agent-core'`. The seven others started from all
   three. A second mount of the top `node_modules` at
   `/pinetrie/node_modules` is refused by runc: the mount point would be
   made inside the read-only `/pinetrie`.
3. **Two ways to make the helper self-contained**, both measured:
   - **npm's `bundleDependencies`** for the helper's six packages: it ran
     from the local install. The tarball grows to 19.3 MB (92.9 MB
     unpacked, 146 packages, since `pi-agent-core` brings `pi-ai` and its
     providers' SDKs), the install from 16 s to 36 s; the disk used is
     about the same (183 MB), the packages moving inside rather than
     beside.
   - **A bundle of the helper alone**, its third-party packages inlined
     (esbuild, with a `require` for the CommonJS among them): 623 KB,
     built in 0.07 s. It loads in 23 ms against 173 ms for the stripped
     files. Its 138 files hold none of what makes a bundle wrong (S257): no
     `import.meta.dirname`, `import.meta.filename`, `import.meta.url` or
     `process.argv[1]`. With it as the helper, from the local install:
     `commands` 5/5, `contract` 8/8 (lanehost's scripts), `ssh` 7/7 (the
     hop), `images` 7/8 (the observer built from the install's files and
     attributed runs).
4. **What a lane reads from the mount:** the helper, the hop,
   `packages/pi/lane.md`, `lane-folder.md` and `lane-docker.md`, and
   lanehost's scripts; the observer's image copies the files of four
   folders, which works with `.js` as with `.ts`. Nothing needs a `.ts`
   file. The one failure, "on the default image, pinetrie's Playwright
   launches Chromium" (`apps/pinetrie/e2e/lanes/images.scenario.ts`),
   imports the repo's own `@playwright/test` through the mount, a dev
   dependency no install has; no lane note points an agent there.
5. **The Playwright version** is only a string: the image's
   `PLAYWRIGHT_VERSION` build argument, from which the Containerfile runs
   `npx playwright@<version> install`. A version in code, held by a test
   to the app's `@playwright/test`, is enough.
6. **The install stays as shipped.** `serve` from the local install,
   with S257's page fixes, served the page and wrote no file inside the
   package.
7. **Found on the way: lanes assume arm64.** The lane runtime's loader is
   `ld-linux-aarch64.so.1` (`packages/lanes/runtime.ts`), the default
   image downloads aarch64 builds of jj, rg, fd, sd, Docker and buildx
   (`packages/lanes/image/Containerfile`), the observer's open flags are
   aarch64's (`packages/core/runs.ts`), and the lane VM needs Apple
   silicon. No living doc says so.

**The kill criterion holds, and the answer is a self-contained helper**,
which every layout runs. The bundle of the helper alone is smaller,
faster to install and to start than `bundleDependencies`, and its imports
hold none of the patterns that made S257's bundle of `serve` fail. Which
folder `serve` opens when none is named stays a decision, not a
measurement.

