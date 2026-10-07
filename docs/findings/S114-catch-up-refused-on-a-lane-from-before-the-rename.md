# S114 — A catch-up on a lane made before the rename is refused as off its line: the lane's bookmark is still `pineta/<lane>`

**Status:** Answered. Fixed by "what the host named `pineta` before the
rename is moved to `pinetrie` once, and old trailers are still read": a
one-off migration, `scripts/migrate-pineta.ts`, and code tagged
`pre-rename:` (`rg 'pre-rename:'`), which goes in two parts:

- the `Pine(?:trie|ta)-` trailer pattern and `OLD_LINE_BASE`
  (`packages/core/trailers.ts`), once no lane from before the rename has
  work to offer;
- `planOldNamesOnDisk` and `OLD_LANE_CONFIG_DIR` (`packages/lanes/plan.ts`),
  with their calls in `startContainer` and `planForkSetup`, once
  `.pinetrie/snapshots/` holds no snapshot from before the rename.

**Question.** A catch-up card on kindly-wren (lane
`t-01a0f3f7-c07e-742d-9ba4-5706ac45065c`) came back "not sent: Not caught up:
your working copy is not on this thread's own line (a split's stack?)". Was
the copy left on a split's stack (`finishSplit` skipping `backToTip` after a
throw), did the agent move it with jj, or is it something else?

**Kill criterion.** If the lane's `@` has one parent, and that parent is the
commit `bookmarkOf` finds, the refusal is not about where the copy is, and
the split hypothesis is wrong.

**Throw away.** `.plans/s114-probe/probe.ts`, which pulls the lane repo's
`.jj` and `.git` out of a snapshot image with `debugfs rdump` and runs
the host's own `copyFacts` and `planCopyReady` on them. Also a copy of
`.pinetrie/pinetrie.db`, read with `node:sqlite`.

**Answers.**

1. **No split ever ran on the lane.** Its root
   (`r-01a0f3f5-9ee3-742d-9ba4-554cd34973ae`) has no stack prompt and no
   `offer-stack` skill text. Its last entry is from 2026-10-03T01:06Z. Its
   newest revision's snapshot is `01a0ff4b-b92c-7304-9004-486d81040cbd`, and
   the lane hasn't run since then.
2. **The copy is on its line.** In that snapshot, `@` is empty, with one
   parent, `8278e418` ("update: pineta-onto"). That commit is where the
   lane's bookmark points.
3. **The bookmark has the old name.** The lane repo's bookmarks are
   `pineta/t-01a0f3f7-…`, `pineta/t-01a0f3f5-…` and `pineta/fetched/{0,1}`.
   b05e2252 ("Pineta is renamed pine·trie", 2026-10-05T14:42Z) changed
   `bookmarkName` to `pinetrie/<lane>`, `stackBookmark` to match, and the
   lane remote to `pinetrie-<lane>`, but migrated nothing. So `bookmarkOf`
   returns null, and the probe prints:

   ```
   copyFacts: { parents: [ '8278e418…' ], bookmark: null, descends: false }
   planCopyReady: off-line
   on the line under the old name: true
   ```

   `planCopyReady` treats a missing bookmark as off the line, and
   `catchUpRefusal("off-line")` guesses at a split.
4. **Scope.** The session has 147 threads with lanes of their own. 128 of
   them were created before the rename. Your repo also still has its fetched
   tips under `refs/remotes/pineta-t-…/tip`, and none under the new prefix
   for those lanes.

So the cause is the rename, not a split or the agent. A separate fault is
still real: `finishSplit` skips `backToTip` when an earlier step throws.
That's a reading of the code, not something this probe saw.

**After.** The base trailers of a lane from before the rename name the line
as it was: kindly-wren's is `Pineta-Base: pineta-onto@822f92fc…`, and your
repo's `pinetrie-onto` was made at b05e2252. Read whole, every such lane
would read as on a WIP that no longer exists, so a `Pineta-Base` on
`pineta-onto` reads as no base, and the lane falls back to the newest line
commit in its history.

The script runs on the Mac, with the host stopped and before it first
starts on the fix: `node scripts/migrate-pineta.ts <project root>`.

It was deleted on 2026-10-07 without having run on pine·trie's own repo,
when ADR-0103's runtime port replaced the `container` calls it made. That
repo still holds 17 `refs/remotes/pineta-<lane>/tip` refs and one
`pineta-offer/*` bookmark, from lanes made between 29 September and 5
October. To bring those lanes back, restore the script from the revision
before its deletion and run it from a checkout of that revision.

