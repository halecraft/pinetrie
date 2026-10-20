# Releasing pine·trie to npm

pine·trie is published to npm as one package, `pinetrie` (ADR-0189). A
release is made by hand, from the Mac: the repo's remote is neither GitHub
nor GitLab, so npm's trusted publishing and provenance are not available.
"Publish" here is npm's word; pine·trie's own `publish` moves `main`
(`docs/glossary.md`).

## What the build makes

`pnpm run package` writes `dist/pinetrie/` and packs it into
`dist/pinetrie-<version>.tgz` (`scripts/package.ts`):

- the repo's layout, each `.ts` file the command or a script run by path
  reaches stripped of its types by Node's own stripper, and its imports
  rewritten to `.js`;
- the lane helper as one file, its packages inside it (ADR-0190);
- the other files of each shipped package (Containerfiles, the lane notes,
  skills, the VM's sources), and the page's build without its stamp;
- a `package.json` whose dependencies are what the shipped files import,
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

1. Bump `version` in the root `package.json`.
2. `pnpm run verify` on the Mac. Its `e2e:lanes` holds the `package`
   scenario: the tarball installed by npm into an empty project, its own
   `pinetrie serve`, and a lane run from its files.
3. `pnpm run e2e:lanes` on an x86_64 Linux machine with Docker and a
   btrfs lanes directory.
4. `pnpm run package`.
5. On a fresh macOS account, with Node 24 and nothing else of pine·trie's:
   `npm install -g dist/pinetrie-<version>.tgz`, `pinetrie serve` on a jj
   repo, and start a lane.
6. `pnpm run publish:npm`, which builds the package again and publishes
   its tarball; npm asks for the 2FA code.
