# S31 — a new command kind, and a store holding the old Lines

**Answers.**
1. **A store written before a kind is added opens, and serves, after it**
   (measured). The host stores each client's command Line (ADR-0023), and
   `line.ts` spreads `COMMAND_KINDS` and `OUTCOME_KINDS` into constrained
   literals, so adding a kind changes the Line's schema. With `"archive"` and
   `"archived"` added, a host started on the old store read the old session
   (one root) and accepted a new command from the same peer, whose Line was
   already stored (two roots). Nothing was logged as an error or refusal.
2. **So adding a command or outcome kind needs no migration and no new
   store.** A new Reply *field* was not tested: `noteId` was added that way
   before, without a check.

## Why it was asked

ADR-0029 adds an `archive` command and two outcomes. `packages/schema/TECHNICAL.md`
says a root schema change cannot open an existing store, and the Line is a
stored document too. Earlier plans stated "check an old store opens" without
anyone measuring it.

## Result

| phase | Line kinds | result |
|---|---|---|
| write | current | `appended`; one root |
| read, same store, same peer | plus `archive`, `archived` | old root read; new chat `appended`; two roots |

## Not tested

- A new field on `Command` or `Reply`.
- A browser client whose Line was stored by an older bundle. The probe's
  client ran the new code in both phases.

## Method

`sandbox/s31-line-kinds/run.sh`, from the repo root: it copies
`probe.ts` into `apps/pinetrie/e2e/` (the workspace resolves `@pinetrie/*` only
from a package that declares them), runs it against a fresh sqlite store with
the current kinds, adds `"archive"` to `COMMAND_KINDS` and `"archived"` to
`OUTCOME_KINDS` in `packages/protocol/messages.ts`, runs it again on the same
store, and restores both files.
