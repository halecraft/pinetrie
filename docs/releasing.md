# Releasing pine·trie to npm

pine·trie is published to npm as one package, `pinetrie` (ADR-0189), by
`@halecraft/release` (`release.config.ts`). A release is made by hand,
from the Mac: npm's trusted publishing and provenance need a CI run, and
there is none. "Publish" here is npm's word; pine·trie's own `publish`
moves `main` (`docs/glossary.md`).

The root is the one package `release` publishes: every workspace package
is private (`workspace.test.ts`), and the root's `publishConfig.directory`
names `dist/pinetrie/`, so `pnpm publish` there sends the build, under its
own `package.json`.

## What the build makes

`pnpm run package` writes `dist/pinetrie/` (`scripts/package.ts`):

- the repo's layout, each `.ts` file the command or a script run by path
  reaches stripped of its types by Node's own stripper, and its imports
  rewritten to `.js`;
- the lane helper as one file, its packages inside it (ADR-0190);
- the other files of each shipped package (Containerfiles, the lane notes,
  skills, the VM's sources), and the page's build without its stamp;
- a `package.json` whose name, `bin`, `engines`, `os` and `cpu` are the
  build's, whose version, description, license, repository, homepage,
  bugs and keywords are the root manifest's, and whose dependencies are
  what the shipped files import,
  and what no import names (`UNIMPORTED_PACKAGES`,
  `packages/pi/unimported-packages.ts`: pi's packages `deep.ts` loads by
  file, and the shipped `pi-anthropic-auth`), at the versions the
  workspace declares.

A release that bumps pi checks `@gotgenes/pi-anthropic-auth`'s peer range
against it, and runs S275's probe
(`docs/findings/S275-subscription-accepted/probe.mjs`) with a subscription
signed in: a subscription works only while Anthropic accepts the request
the pinned pair shapes.

It runs on Node 24 only, the major whose stripper was measured, and
refuses a shipped file that imports a computed name or a package nothing
declares.

## The checklist

1. `pnpm exec release bump <version>`, which writes the root's `version`;
   describe the change, so git's `HEAD` (jj's `@-`, colocated) is the
   release: `release` tags it.
2. `pnpm run e2e:lanes` on an x86_64 Linux machine with Docker and a
   btrfs lanes directory.
3. On a fresh macOS account, with Node 24 and nothing else of pine·trie's:
   `pnpm run package`, `npm pack ./dist/pinetrie` into a folder outside
   it, `npm install -g` the tarball, `pinetrie serve` on a jj repo, and
   start a lane.
4. `pnpm login` once (`release` checks with `pnpm whoami`).
5. `pnpm exec release publish --dry-run`, then `pnpm exec release
   publish`: it builds (`pnpm run package`), runs `pnpm run verify`, whose
   `e2e:lanes` holds the `package` scenario (the tarball installed by npm
   into an empty project, its own `pinetrie serve`, and a lane run from
   its files), publishes, and tags `v<version>` to `origin`. A version
   already on npm is skipped, so running it again is safe. npm asks for
   the 2FA code.
6. `npm install -g pinetrie` from the registry: `pinetrie --version` says
   the version, and `pinetrie serve` on a folder reaches `listening`.

Never pack into `dist/pinetrie/`: a pack takes every file there, a
tarball left inside among them.
