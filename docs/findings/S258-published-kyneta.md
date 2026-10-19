# S258 — Does pine·trie run on Kyneta 4.0.0 from npm?

- **Status:** Answered
- **Led to:** ADR-0189

Every `@kyneta/*` dependency is a `link:` to the local checkout at
`~/halecraft/kyneta/workspace/pineta` (`apps/pinetrie`, `packages/pi`,
`protocol`, `schema`, `session`, `web`), and a `link:` cannot be
published. pine·trie needs no Kyneta of its own: `4.0.0`, published
2026-10-04, is the release it runs on, and `docs/pinetrie.md` (Kyneta)
still describes the checkout.

Checked against the `4.0.0` tarballs' `dist/**/*.d.ts`: each name
pine·trie imports from `@kyneta/exchange`, `schema`, `yjs-schema`,
`react`, `sqlite-store` and `websocket-transport`'s `browser` and
`server` is there. That is a text search, not a typecheck, and it says
nothing of behaviour.

## Brief

**Size:** S · **Depends on:** nothing

**Question.** With every `link:` replaced by `4.0.0`, does
`pnpm run verify` pass?

1. In a lane: switch the six manifests to `4.0.0`, install, and run
   `pnpm run verify`. The lockfile pnpm writes in a lane holds only Linux
   packages (`AGENTS.md`), so it is not kept.
2. `@kyneta/sql-store-core` is a peer of `sqlite-store`, declared by the
   app only to meet it (`apps/pinetrie/package.json`): does npm's install
   meet it the same way?

**Kill criterion.** If a gate fails on `4.0.0`, publishing waits on a
Kyneta release, and the plan names what it must carry.

**Throw away.** The manifest edits and the lane's lockfile.

## Answers so far

Run 2026-10-19 in a lane (Linux, Node 24.22.0), the six manifests at
`4.0.0`, installed with `--no-frozen-lockfile`, then put back. This lane
has no Kyneta checkout, so no gate ran on the `link:` for comparison.

1. **On `4.0.0`:** lint, `typecheck`, `pnpm test` (446 files),
   `proofs:unit` and `conformance` (21/21) all pass. `proofs:unit` and the
   btrfs tests pass only from a copy on btrfs; from `/tmp` (overlayfs) they
   skip, and `proofs:unit` lists 11 gaps.
2. **`pnpm run e2e`:** 72 pass and 1 fails: "the nineteenth card is
   refused: the inventory is full" in
   `apps/pinetrie/e2e/host/cards.scenario.ts`. Kyneta plays no part in
   it. The scenario fills 18 slots, but `INVENTORY_SLOTS` has been 12
   since the inventory stopped resizing (`packages/core/grid.ts`), so 6 of
   its cards are refused `full` before the nineteenth. The scenario was
   stale on accepted work; it now fills `INVENTORY_SLOTS`, and the cards
   scenario passes on `4.0.0` (28/28).
3. **`pnpm run e2e:lanes`: not read.** Three runs gave three different
   sets of failures: 9, 20 and 18 checks, all in jj, the observer
   ("the machine's observer exited") and lane disks, not in sync or
   storage. They depend on where the repo sits: run from a copy in an
   ignored folder, the lane could not see `/pinetrie/packages/pi/lane.md`;
   run from `/tmp`, the `commands` scenario passed alone. Without the same
   suite run on the `link:` in the same place, no failure can be put on
   `4.0.0`. That baseline is the Mac's, or a lane that has the checkout.
4. **The peer** `@kyneta/sql-store-core` resolved for pnpm with the app's
   declaration; npm's install is S257's to check.

## Answered on the Mac

On 2026-10-19 the manifests moved to `4.0.0` with Kyneta's peer-only
declarations gone, the lockfile updated in a lane with `--lockfile-only`
(every macOS entry kept), and `pnpm install` then `pnpm run verify` on the
Mac passed every gate, `e2e:lanes` among them, but for 12 unit tests that
were not Kyneta's: `workspace.test.ts` read a leftover folder holding only
`node_modules`, and a file-writing test outlived the default timeout under
the full suite. pine·trie runs on Kyneta `4.0.0`; no Kyneta release is
waited on.

