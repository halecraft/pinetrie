# S111 — Two bookmarks move in one operation, and `jj op revert` undoes a catch-up without losing an edit; `jj op restore` loses it

**Status:** Answered. Led to ADR-0090. Served `PLAN-2026-10-05-publish-button`.

**Question.** A publish on the host's own machine runs up to two jj
operations: your work rebased onto the line (`rebase -b @ -d <onto>`, as
you), then the line and the publish bookmark moved forward. For publish to
leave nothing half done:

1. Can the line and `main` move in one operation, so that a refusal of
   either leaves both where they were?
2. When the move fails after the rebase, what puts your files, your
   commits and the bookmarks back, including when you edited a file in
   between?

**Kill criterion.** If neither `op revert` nor `op restore` puts `@` back
without losing a file edited after the rebase, publish cannot undo, and
must refuse everything it cannot check before its first step.

**Throw away.** Scratch repos in `/tmp`, made with `jj git init --colocate`,
jj 0.45.1.

**Answers.**

1. **`jj bookmark move A B --to X` is one operation, all or nothing.** With
   `onto` already at `X` and `main` behind it, `jj bookmark move onto main
   --to onto` printed `Moved 1 bookmarks to … main* onto`: a bookmark
   already at the target is left as it is, without an error. With `main`
   moved so that `X` was behind it, `jj bookmark move onto main --to
   'root()+'` printed `Error: Refusing to move bookmark backwards or
   sideways: main`, and neither bookmark moved.
2. **`jj op revert <the rebase's operation>`, run straight after, puts it
   all back.** After `jj rebase -b @ -d onto` (`Rebased 2 commits`), `jj
   op revert <its id>` left `@` on `mine` on `base`, with the files of
   before (`a c e`), and no divergent change.
3. **An edit between the rebase and the revert survives `op revert`, but
   leaves `@` divergent.** With a file `l` written after the rebase, the
   revert snapshotted it first, then rebased `@`'s snapshot back: `l` and
   `e` stayed on disk and in `jj diff`, and `@`'s change id was
   divergent (two commits, `stklzrwm/0` and `/1`).
4. **`jj op restore <the operation before the rebase>` deletes that edit
   from disk.** With `l` written after the rebase, `jj op restore` printed
   `removed 2 files`, and `l` was gone from the working copy (only the
   operation log still holds it).

**Decision.** Publish moves the line and the publish bookmark in one `jj
bookmark move` (`planPublishMove`). It undoes a catch-up with `jj op revert`
of the catch-up's own operation, as you, straight after the failure
(`planCatchUpUndo`), and never with `op restore`. The window for an edit in
between is one jj process.
