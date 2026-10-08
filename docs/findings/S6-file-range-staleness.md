# S6 — Do `file-range` references survive a jj change?

- **Status:** Open

Lowest priority: v1 has no Worktree branches.

## Brief

**Size:** S · **Depends on:** nothing

**Question.** Is content addressing (blob hash / jj change ID) sufficient to
keep file references valid — or at least *knowably stale* — across edits?

**Kill criterion.** If references cannot reliably detect staleness, file
references must be advisory-only in the UI.
