# S257 — Which build of pine·trie's TypeScript does Node 24 run from an installed package?

- **Status:** Open

Published to npm, pine·trie's code sits under a `node_modules`, and Node
refuses to strip types there. Measured on Node 24.22.0 in a lane: a `.ts`
module under `node_modules/x/`, imported by name, fails with
`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` before it runs. So every
`.ts` the host runs (`apps/pinetrie/host/serve.ts` and what it loads,
`apps/pinetrie/scripts/`) and every `.ts` a lane runs from the mount
(`packages/pi/lane-helper.ts` and its `@pinetrie/channel`,
`@pinetrie/rules`) needs JS beside or instead of it. The repo has no build
for its TypeScript (`docs/05-stack.md`); the page's Vite build
(`packages/web/vite.config.ts`) is the only one.

The npm scope `@pinetrie` belongs to someone else (it publishes
`@pinetrie/ngx-batch-requests` and two more); the unscoped name `pinetrie`
is free (registry, 2026-10-19). So what ships is one package, `pinetrie`,
with the workspace packages inside it, not twenty.

## Brief

**Size:** M · **Depends on:** nothing

**Question.** Which build gives a `pinetrie` tarball that, installed with
`npm install` into a clean directory, starts `serve` on a folder, with
pi and Kyneta as its dependencies, not inside it?

- **(a) A bundle per entry**, with Vite's bundler or esbuild: the host's
  `serve`, each command (`sign-in`, `sign-out`, `tidy`, `session`), the
  lane helper, and the observer's server and connection
  (`packages/lanehost/observer-server.ts`, `observer-connect.ts`).
- **(b) A JS file per TypeScript file**, keeping the layout:
  `tsc` with `rewriteRelativeImportExtensions`, and each workspace
  package's `exports` pointing at `.js`.

For each, measure:

1. Does `serve` start and draw the page from the installed tarball?
2. Which reads of the code's own files break: each `import.meta.dirname`
   and `import.meta.url` outside tests (Containerfiles, `packages/pi/skills`,
   `packages/vm`'s Swift sources and `gvproxy.json`, the seccomp files,
   `packages/lanehost`'s observer sources, `packages/pi/lane*.md`)? A
   bundle moves the module that reads; a per-file build does not.
3. Does `packages/pi/deep.ts` still load pi's deep modules? It imports
   from `./node_modules/@earendil-works/…` beside its own file, which is
   pnpm's layout; npm hoists pi to the install's top `node_modules`.
4. The observer's machine image copies the TypeScript of `core`,
   `channel` and `lanehost` (`observerSources`) and runs
   `observer-server.ts` in it: does that still work, or does it need the
   build's output instead?
5. The tarball's size, and what `files` must list.

**Kill criterion.** If neither build runs `serve` from the installed
tarball without changing how the code finds its own files, the package
needs one place that resolves pine·trie's own files from its install
root first, and that is a task of its own in the plan.

**Throw away.** The build configs, the tarballs and the install
directories. Keep in a folder beside this file only the config the plan
builds on.
