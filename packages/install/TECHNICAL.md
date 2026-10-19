# `@pinetrie/install`: technical notes

pine·trie's own install, as the code that runs from it needs to know it
(ADR-0189): where its root is, which form its files are in, where lanes
mount it, and the scripts pine·trie runs in other processes. It declares
nothing; only `lanes`, `docker` and the app declare it
(`workspace.test.ts`).

## The two forms

- **`source`** is the repo: `.ts` files Node strips as it loads them.
  **`built`** is the npm package (`scripts/package.ts`): the repo's layout,
  each file stripped to `.js`. `thisInstall` reads its form from its own
  file's extension, and its root two directories above itself, which the
  package build keeps.
- **An install is a value the host passes on** (`startHost`'s `install`),
  not a constant its parts read: the mounts, lanehost and the observer
  take it from the host. A suite runs the repo's host over an installed
  package's files that way (`apps/pinetrie/e2e/lanes/package.scenario.ts`).
- **Every container mounts an install at `PINETRIE_MOUNT`.** `inMount` is
  that install as a container sees it: the mount's root, the same form.

## The scripts run by path

- **The registry is the one place a script's path is written.** Each is
  named (`ScriptName`), its path from the root without an extension.
  `scriptCommand` returns its whole command: how Node starts there (the
  lane runtime's, `RUNTIME_NODE`, or the host's own `process.execPath`),
  then the script in the install's form. No path leaves the module, so
  none can be misspelt or built by hand elsewhere.
- **The package build starts from the registry** (`SCRIPT_ENTRIES`), so a
  registered script is always in the package.
- **What the registry cannot close:** a `.ts` path written in a string
  outside it. `scripts/shipped.test.ts` fails on one in any file the
  package ships.
- **The lane helper is built as one file in the built form** (ADR-0190),
  over its stripped file's path, so its entry needs no case of its own.

## The page

`pageDir` is the page's package, from the install's root: a host serves
its `dist/`. The package holds the page built, and never builds it.
