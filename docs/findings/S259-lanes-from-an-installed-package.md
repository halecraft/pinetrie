# S259 — What does a lane need from an installed pine·trie?

- **Status:** Open

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
