# S100 — Can one parameterized read give every offer its facts, a lane on a WIP's included?

**Status:** Open. Opened from `PLAN-2026-10-04-offers-one-home`, which
puts every offer read behind one entry point in `@pineta/repo`, and
leaves what is read unchanged. Serves the plan that would replace the
separate reads.

**Question.** `gatherLane` (`packages/repo/lane-read.ts`, ADR-0065, S89)
reads a lane on the line in one `jj log`, about 3 jj processes per
unchanged refresh. Everything else still uses the separate reads
(`laneTipIn`, `laneBase`, `wipFacts`, `startOfOffer`, `readOffer`,
`workChanges`, `readCatchUp`, in `packages/repo/offer.ts`): S89 measured
18 jj processes for a refresh on them. They cover:

- a lane on a WIP;
- an archived thread's offer;
- the re-read after a step;
- every take, squash, describe and split;
- the pinned reads.

`repo.test.ts` keeps the two paths equal.

Can one read, parameterized by the lane's base, give all of those the facts
the separate reads give? Its shape would be:

- a first read, as today;
- for a lane on a WIP, a second read from the same template, aimed at the
  WIP's commit and source.

For that read to replace the separate ones, it has to cover:

1. **The target.** On a WIP, the offer sits on the WIP's commit, not the
   line. The region (`::<bookmark> ~ ::<onto>`), `placed` and `onTarget`
   must be measured against it. Measured against the line, the WIP's own
   commits lie between the line and the offer, and the offer reads as
   edited (`offerEdited`).
2. **The takes.** `takenRevset` reads takes in `::(<onto> | <wip>)`. The
   shared facts (`packages/repo/shared.ts`) collect only those in
   `::<onto>`. A take onto the WIP would be missed, and the start would be
   wrong (S81).
3. **"Under the base".** On the line, the commit carrying `Pineta-Base`
   descends from the base's source, so the read's `::<based>` flag stands
   for `takenRevset`'s `~ ::present(<source>)`. On a WIP, that commit is the
   WIP's copy, which does not descend from the source (the WIP's commit),
   and the source is known only after the `Pineta-Base` row is parsed.
4. **The WIP's state** (`wipState`: ok, landed or gone). This needs the
   bookmark's commit and whether it is on the line. For a gone WIP, it
   needs whether its source, or the source's change, is on the line
   (`wipFacts`, `packages/repo/line.ts`). The shared facts' `line.wips`
   lists only WIP bookmarks above the line.
5. **A thread with no lane tip.** An archived thread's offer is read
   against the line, its lane's history gone from your repo.
6. **Pinned reads.** They have no `shared()`. `readShared` already runs
   pinned to an operation, so the open question is whether a pinned read
   can use the owner's kept set at its own operation, or read one.

Each of these needs a measurement on real histories:

- every history `repo.test.ts` builds for a lane on the line, rebuilt with
  the lane on a WIP;
- a WIP that landed, and one that is gone;
- a take onto the WIP, then a second offer;
- S81's start after a catch-up, on a WIP;
- S97's untraced take, and a catch-up whose range has gaps, on a WIP;
- an archived thread with an open offer, and one with an offer you edited.

For each, compare the parameterized read's facts with the separate reads',
and count the jj processes.

**Kill criterion.** The one read is only worth having if it is both correct
and cheaper. Either failure keeps a second path for lanes on a WIP:

- if any history above gives different facts, and no read fixed in advance
  can express them without a per-lane read that grows with the history;
- or if an unchanged WIP lane's refresh needs more than 6 jj processes.

In that case, the one read stays for lanes on the line, as today.

**Throw away.** The throwaway repos and the probe script, outside the
workspace. A parameterized `laneRead` that passes is kept: it is the
change.
