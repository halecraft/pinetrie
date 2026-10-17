# S100 — Can one parameterized read give every lane's proposed changes their facts, a lane on a WIP's included?

- **Status:** Open

Restated on 2026-10-17 in the glossary's words, against `packages/jj`. The
question is unchanged. It was opened when every read of proposed changes
went behind one entry point, and what is read stayed the same.

**Question.** `gatherLane` (`packages/jj/lane-read.ts`, ADR-0065, S89)
reads a lane on accepted work in one `jj log`. An unchanged refresh runs at
most 2 jj processes (`repo.test.ts`). Every other gather still uses the
separate reads, through `placeOf` in `packages/jj/proposed-gather.ts`:

- `laneTipIn`, `startOfProposed`, `readProposedChanges` and `filesTouched`
  (`packages/jj/proposed.ts`);
- `laneBase` (`packages/jj/lane/base.ts`);
- `readWipState` (`packages/jj/accepted.ts`);
- `readCatchUp` (`packages/jj/catch-up.ts`).

S89 measured 18 jj processes for a refresh on them. They serve:

- a refresh of a lane on a WIP (`gatherRefresh`, when `gatherLane` answers
  `wip`);
- an archived thread's proposed changes, read against accepted work;
- `gatherProposedChanges`, which every acceptance, squash, description and
  split plans from, and `gatherPlace`, a split's span;
- reads through the owner's `read`, pinned to the last observed operation.

`repo.test.ts` keeps the two paths equal.

Can one read, parameterized by the lane's base, give all of those the facts
the separate reads give? Its shape would be:

- a first read, as `gatherLane` does now;
- for a lane on a WIP, a second read from the same template, aimed at the
  WIP's commit and its source.

For that read to replace the separate ones, it has to cover:

1. **The target.** On a WIP, the proposed changes sit on the WIP's commit,
   not on accepted work. The region (`::<bookmark> ~ ::<accepted>`),
   `placed` and `onTarget` must be measured against it. Measured against
   accepted work, the WIP's own commits lie between accepted work and the
   proposed changes, and the proposed changes read as edited.
2. **The accepted thread commits.** `acceptedThreadCommitsRevset`
   (`packages/jj/plan.ts`) reads them in `::(<accepted> | <wip>)`. The
   shared facts (`readShared`, `packages/jj/shared.ts`) collect only those
   in `::<accepted>`. An acceptance into the WIP would be missed, and the
   start would be wrong (S81).
3. **"Under the base".** On accepted work, the commit carrying
   `Pinetrie-Base` descends from the base's source, so the read's
   `underBase` flag stands for the revset's `~ ::present(<source>)`. On a
   WIP, that commit is the WIP's copy, which does not descend from the
   source (the WIP's commit). The source is known only after the
   `Pinetrie-Base` row is parsed.
4. **The WIP's state** (`wipState`: ok, landed or gone). This needs the
   bookmark's commit and whether it is on accepted work. For a gone WIP,
   it also needs whether the WIP's source, or the source's change, is on
   accepted work (`wipFacts`). The shared facts' WIPs (`acceptedFacts`)
   list only WIP bookmarks above accepted work.
5. **A thread with no lane tip.** An archived thread's proposed changes are
   read against accepted work: its lane's history has left your repo.
6. **Pinned reads.** A read through the owner's `read` gets `jj` and `git`
   (`RepoReads`), with no `shared()`. The open question is whether such a
   read can use the owner's shared facts at its own operation, or must read
   them itself.

Each of these needs a measurement on real histories:

- every history `repo.test.ts` builds for a lane on accepted work, rebuilt
  with the lane on a WIP;
- a WIP that landed, and one that is gone;
- proposed changes accepted into the WIP, then a second set of proposed
  changes;
- S81's start after a catch-up, on a WIP;
- S97's untraced acceptance, and a catch-up whose range has gaps, on a WIP;
- an archived thread with open proposed changes, and one whose proposed
  changes you edited.

For each, compare the parameterized read's facts with the separate reads',
and count the jj processes.

**Kill criterion.** The one read is only worth having if it is both correct
and cheaper. Either failure keeps a second path for lanes on a WIP:

- if any history above gives different facts, and no read fixed in advance
  can express them without a per-lane read that grows with the history;
- or if an unchanged WIP lane's refresh needs more than 6 jj processes.

In that case, the one read stays for lanes on accepted work, as today.

**Throw away.** The throwaway repos and the probe script, outside the
workspace. A parameterized `gatherLane` that passes is kept: it is the
change.
