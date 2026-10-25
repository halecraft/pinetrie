# S347 — jj's `parents()` revset lists a merge's parents in no promised order; the template's `parents` keeps the order they were given

- **Status:** Answered
- **Led to:** ADR-0080

**Question.** A conflicted merge left in a lane is resolved again from its
own commit: its first parent is the lane before the merge (`ours`), its last
the state merged (`from`), and a middle one the last join (`mergeBase`,
`packages/jj/lane/merge.ts`, builds them as `[ours, last, from]`). Does
reading the merge's parents with the revset `parents(<merge>)` give them in
that order, or must they be read with a template?

**Kill criterion.** If `parents(M)` lists a merge's parents in the order
`jj new` was given them, whatever the parents' own ages, the revset is
enough.

**Throw away.** A scratch repo in `/tmp`, made with `jj git init`.

**Answers.**

1. **The revset does not keep the parents' order.** In jj 0.45.1, with a
   base, then a commit `late` and after it a commit `early` on the base,
   `jj new <late> <early>` made a merge whose
   `jj log -r 'parents(<merge>)'` listed `early`, then `late`: newest
   first, as any revset's result is listed, not as the merge holds them.
   `jj new <early> <late>` listed them in the same order, so the revset
   cannot tell the two merges apart.
2. **The template keeps it.** `jj log -r <merge> -T 'parents.map(|c|
   c.commit_id())'` listed `late`, then `early` for the first merge, and
   `early`, then `late` for the second: the order `jj new` was given.

So a read that needs to know which parent is which reads them with the
template, as `packages/jj/proposed.ts`, `packages/jj/lane-read.ts` and
`packages/jj/lane/revisions.ts` already do. A revset of parents is only a
set.
