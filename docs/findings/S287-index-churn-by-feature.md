# S287 — Edits to the index files rarely race, and a race would race in a per-feature file too

- **Status:** Answered
- **Led to:** ADR-0201

**Question.** The index files of `@pinetrie/core`, `@pinetrie/rules` and
`@pinetrie/interface` are among the most-changed files. Would per-feature
sub-exports spread those edits, or do they just move them?

1. For each commit that edits one of the three, how many of the
   package's modules do its changed export lines name, and how many
   features (groups of modules) is that?
2. How many of those edits change lines another thread's commit landing
   near it also changed: lines within three of each other, in commits
   whose `Pinetrie-Base` or parent precedes the other's landing?
3. For core, whose index only re-exports with `export *` since
   `1953d4ab`, how often is it edited at all?

**Kill criterion.** If most index edits name modules of several features,
or if edits from parallel threads rarely land near each other, sub-exports
do not spread churn: keep one index per package.

**Throw away.** Nothing: the probe and its output stay beside this file, as what ran.

## Answers

1. **An edit names one module about as often as several.** Of rules'
   84 index edits, 32 name one module, 25 two or three, 27 four or more
   (one 26). Of interface's 74, 32 name one, 20 two or three, 22 four or
   more (one 60, a sweep). A per-feature file would take several of most
   edits, not one.
2. **Races are rare, and none would be avoided.** An edit races when its
   thread started before an earlier edit of the same file landed.
   - rules: 62 edits carry a start commit still in the repo; 11 started
     below their parent; 3 of those raced an earlier edit. One edited the
     same module's block as its rival, two edited blocks apart.
   - interface: 71 with a start, 12 below their parent, 4 raced, all
     apart.
   - No race edited the block beside its rival's. A sorted index, one
     block per module, merges edits to different blocks without a
     conflict. An edit to the same block conflicts wherever the block
     lives, so a per-feature file would not avoid the one race that
     touched the same block.
3. **Core's index has changed twice since `1953d4ab`**, which made it
   re-exports only (`export *`): when ADR-0180 moved record types out and
   when ADR-0185 changed messages. Over the same 48 commits, rules' and
   interface's indexes changed 12 times each. Core's earlier 152 edits
   were to a file that held its code, and are not comparable.

**The kill criterion holds:** keep one index per package. Their churn is an
edit per new name another package imports, not a source of conflicts.
Named exports in core would add edits at about rules' rate, which these
counts say do not race.

## How it was measured

`probe.ts` (in `docs/findings/S287-index-churn-by-feature/`), at
`ab304649cc02`, reads `git log` of each index file. For each commit it
maps the `git diff -U0` hunks to the module whose `from "./m.ts"` closes
the statement each changed line is in, before and after. A thread's
commit carries `Pinetrie-Start`, where its proposed changes started; the
commit raced every earlier edit of the file that is not an ancestor of
that start. Commits before the trailers existed, and starts no longer in
the repo, are left out. `output.txt` is its output.
