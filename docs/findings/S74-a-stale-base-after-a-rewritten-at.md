# S74 — a stale base after your `@-` was rewritten

- **Status:** Answered
- **Led to:** ADR-0060, ADR-0104

After your `@-` was rewritten in place (a `jj squash` into it, and a
`jj edit` of its parent), every lane failed to start, with:

```
lane: jj new 31fa0c41… failed (exit 1): Error: The working copy is stale (not updated since operation b52476c07161).
```

That step is the base snapshot's refresh (`planBaseRefresh`,
`packages/lanes/plan.ts`). Every lane of its own waits for the base, so each
lane's start, turn and queued card failed with the same line.

Reproduced with jj 0.44.0 and git, in throwaway repos (now a test in
`packages/lanes/lanes.test.ts`):

1. A base made as `planBaseRefresh` makes one: `git init`, `jj git init
   --colocate`, `git fetch <yours> +B:refs/heads/pinetrie/fetched/0`,
   `jj --ignore-working-copy git import`, `jj new B`.
2. Your `@-` rewritten: commit C, which does not descend from B. The same
   fetch moves the ref from B to C, sideways.
3. `jj --ignore-working-copy git import` abandons B, which no ref names now,
   and rebases the base's working-copy commit, B's empty child, onto B's
   parent. With `--ignore-working-copy` the working copy is not updated, so
   it is stale: `jj new C` refuses.
4. `jj workspace update-stale` then recovers it, and `jj new C` succeeds. On
   a working copy that is not stale it prints "Attempted recovery, but the
   working copy is not stale." and exits 0.

After a forward move (C to D, a child of C), the old commit is an ancestor
of the new ref: nothing is abandoned, and nothing goes stale. That is why
the base refreshed until history was rewritten.

Not measured: a lane's own repo after the same sideways fetch. A lane's
bookmark names the commit it forked from, so the import should not abandon
it, but no probe has shown it.

**The rule.** `planBaseRefresh` runs `jj workspace update-stale` between the
fetch and `jj new`.
