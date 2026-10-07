# S121 — renaming `pinetrie-onto` is one jj operation and one config file write, and the name also reaches the agent's words

**Status:** Answered. Serves `PLAN-2026-10-07-accepted-work`. Evidence for
ADR-0100.

Run in a lane (Linux, jj 0.45.1) on a disposable colocated repo; the code
read at this revision. The probe was not committed.

## Brief

**Question.** What does renaming the line's bookmark in your repo take:
does `jj bookmark rename` carry the git ref and record an operation; where
is setup's `immutable_heads()` written, and is that write an operation;
what happens between the two writes; and where else does `pinetrie-onto`
reach, besides your repo?

**Kill criterion.** A rename that jj cannot do in one command, or a config
the host cannot rewrite as it wrote it, would mean asking the person to
run setup again instead of a migration.

**Throw away.** The probe repo.

## Answers

1. **`jj bookmark rename pinetrie-onto pinetrie-accepted` is one
   operation** ("rename bookmark pinetrie-onto to pinetrie-accepted"), and
   the colocated git branch is renamed with it. `jj op revert` of it brings
   `pinetrie-onto` back.
2. **It refuses rather than overwrites.** With `pinetrie-accepted` already
   present: "Bookmark already exists", exit 1. With no `pinetrie-onto`: "No
   such bookmark", exit 1. The migration must plan from both facts, not
   rely on the refusal.
3. **`jj config set --repo` writes a file outside the repo and records no
   operation.** In jj 0.45 the repo's config is
   `~/.config/jj/repos/<id>/config.toml` (`jj config path --repo`), not
   `.jj/repo/config.toml`, and the op log is unchanged by it. `jj op revert`
   cannot undo it. `jj config get` takes no `--repo` here: it reads the
   resolved value, as `lineFacts` (`packages/repo/line.ts`) already does.
4. **Between the two writes nothing fails.** Setup's text wraps the name in
   `present()`, so with the bookmark renamed and the config not yet,
   `immutable_heads()` resolves to the builtin heads alone: accepted work
   and the offers on it are briefly mutable, and no command errors. The
   same holds in the other order. Each write planned from what the repo
   holds finishes on the next start.
5. **`revsets.log` does not name the bookmark** (`logRevset`,
   `packages/repo/plan.ts`): only `immutable_heads()` needs rewriting.
6. **Where else the name reaches** (read from source):
   - **The agent's orientation:** `packages/pi/lane.md` names
     `pinetrie-onto` and "integration line" (lines 66–67, 132).
   - **The catch-up's message to the model** says "`<bookmark>` was merged
     into this thread's own copy" (`encodeUpdate`, `packages/rules/update.ts`,
     from `details.bookmark`), and a conflict's "theirs" is the bookmark
     (`apps/pinetrie/host/work/update.ts`). Both should say *accepted work*
     (`catchUpName`). A resolution's prompt says "The project's work"
     (`incomingOf`, same file), a retired word.
   - **Lane commit titles:** `base: <onto>` and `update: <onto>`
     (`baseMessage`, `packages/lanes/plan.ts`), shown in jj.
   - **A lane's disk:** its jj config's `immutable_heads()` lists commits,
     not the bookmark (`packages/lanes/plan.ts`), and a lane's repo has no
     line bookmark (`laneBase`'s comment, `packages/lanes/base.ts`). Nothing
     on a lane's disk needs renaming.
   - **The base snapshot** is read on the host at `present(<onto>)`
     (`refreshBaseNow`, `apps/pinetrie/host/work/setup.ts`), from the config.
   - **jjui:** its own revset, if any, is the person's file; the startup
     line names it.

## Decision

A migration, not a second setup: rename the bookmark when `pinetrie-onto`
is present and `pinetrie-accepted` is not; rewrite `immutable_heads()` when
it ends with setup's text for `pinetrie-onto`; each from its own fact, so a
start that stopped between them finishes. No host suite scenario: jj's
behaviour here is two commands whose outcomes this spike recorded, and the
plan's cases are pure. The catch-up's words and `lane.md` join the rename.
