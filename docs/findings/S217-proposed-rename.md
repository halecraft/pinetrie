# S217 — renaming every `pinetrie-offer/*` is one `jj bookmark rename` each, plus one import for the host's remote bookmarks; a single import of moved git refs loses a conflicted bookmark

- **Status:** Answered
- **Led to:** ADR-0156

Run in a lane (Linux, jj 0.45.1) on a disposable colocated repo, every jj
command as the host runs them (`--ignore-working-copy`,
`operation.username=pinetrie-host`); the code read at this revision. The
probe was not committed.

## Brief

**Question.** ADR-0156 renames each `pinetrie-offer/<name>` in your repo
to `pinetrie-proposed/<name>` at a host's start, and the glob in your
`immutable_heads()` and `revsets.log`. S121 measured one bookmark. With
many: how many operations, does a bookmark that is immutable, conflicted
(the race ADR-0105 repairs), or tracking a remote rename whole, and what of
the host's own remote bookmark the hosts-version plan adds
(`pinetrie-offer/<name>@pinetrie-host`, a git ref under
`refs/remotes/pinetrie-host/` imported with auto-track)? Is there a cheaper
way than one rename each? What holds between the renames and the config
write?

**Kill criterion.** A rename that loses a conflicted bookmark's sides, an
offer the host would read as yours afterwards, or a host remote bookmark
left untracked or apart from its local one, would mean the rename cannot
be a start-time migration, and offers would be rebuilt under the new name
instead.

**Throw away.** The probe repo.

## Answers

The repo held accepted work and six offers on it: four plain, one a stack
of two, one conflicted by two racing `bookmark set`s, one tracking
`@pinetrie-host` as the plan builds it, one pushed and tracking `@origin`.

1. **`jj bookmark rename` is one operation per bookmark,** six for six.
   It needs no `--ignore-immutable` for an immutable offer: it moves no
   commit. The colocated git branch moves with it.
2. **A conflicted bookmark renames whole:** all its sides move to the new
   name, still conflicted. jj exports no git ref for a conflicted bookmark,
   before or after.
3. **A renamed bookmark's evolog is unchanged** (one entry, its creation):
   no version is added, so `sinceHost`'s walk, and the plan's check that
   the local and host bookmarks are the same commit, still read the offer
   as the host's.
4. **A tracked remote bookmark is not renamed.** jj warns "Tracked remote
   bookmarks for bookmark … were not renamed". The old name stays as
   `(deleted)` with its remote bookmark, and the new name tracks that
   remote, "not created yet".
   - **For `@pinetrie-host` the host finishes it with ADR-0154's own
     steps** (item 8): the mark (`markSteps`: `git update-ref` from the new
     name's `refs/heads/` ref, `jj git import`, `jj bookmark track`) under
     each new name, then `jj bookmark forget --include-remotes` of each old
     name. Afterwards the new remote bookmark is tracked and names the same
     commit as the local one, and the old name, its remote bookmark and its
     git ref are gone. A first probe deleted the old ref in git instead
     (`git update-ref -d`, then import), which also worked here, but
     `packages/jj/TECHNICAL.md` forbids it: an import after a deleted
     remote ref abandons every commit only that ref held (S215 item 18).
   - **For any other remote (`@origin`) the host does nothing:** the
     person pushed it. `pinetrie-offer/<name>@origin` stays, a remote
     bookmark, which `builtin_immutable_heads()` keeps immutable. The
     startup line can name it, as the person's to delete
     (`jj git push --deleted`, or `jj bookmark forget`).
5. **One import for everything loses a conflicted bookmark.** Moving every
   git ref under `refs/heads/` and `refs/remotes/pinetrie-host/` and
   importing once is one operation, and right for the plain offers and
   the host's remote. But the git ref holds one side of a conflicted
   bookmark: the new name got that side alone, unconflicted, and the old
   name kept the rest. The repair that keeps your version would no longer
   see the race. Rejected.
6. **Between the renames and the config write nothing fails.** With the
   old glob in `immutable_heads()` and the bookmarks renamed, the glob
   matches nothing: the offers are briefly mutable, and still in the log
   (`builtin_log()` shows mutable heads). After `jj config set --repo` of
   both values with the glob replaced, they are immutable again, and the
   log shows them. The config write records no operation (S121). Either
   order works, and each step is planned from what the repo holds, so a
   start that stopped part way finishes on the next.
8. **The mark and the forget batch** (a second probe, after ADR-0154
   landed; a commit of yours on top of an offer): with three offers
   tracking `@pinetrie-host`, three renames, three `git update-ref`s, one
   `jj git import`, one `jj bookmark track` naming all three (no
   operation: each new name already tracked the remote, as item 4 says)
   and one `jj bookmark forget --include-remotes` naming all three old
   names: 5 operations for 3 offers, N + 2 in all. Each new name ends
   tracked, its remote at the bookmark's commit (`hostOfferRevset` reads it
   as marked), the old names and their refs gone. Your commit on top kept
   its parent, and nothing was abandoned. A later `jj git import` of yours
   changes nothing.
9. **Where else the prefix reaches** (read from source): `OFFER_PREFIX`
   and `OFFER_BOOKMARKS` (`packages/jj/lane/names.ts`), which setup's
   `immutableHeads` and `logRevset` (`packages/jj/plan.ts`) and the
   owner's fingerprint (`packages/jj/observe.ts`) build on; the
   publish notes' jjui line (`packages/interface/publish-view.ts`); the
   agent's `packages/pi/lane.md`. The build nonce (`pinetrie-offer-<uuid>`)
   names commits by description for one build, and nothing keeps it
   between starts. Nothing on a lane's disk names the prefix.

## Decision

The start-time rename of ADR-0156 is: one `jj bookmark rename` per
`pinetrie-offer/<name>` whose new name is absent; then, for those the host
had marked, ADR-0154's mark under the new names (one import for all) and
one `jj bookmark forget --include-remotes` of the old names, never a ref
deleted in git; then both config values with the glob replaced. Each from
its own fact. It runs before the owner's first observation, so its
operations mark no refresh. Remote bookmarks on any other remote are left,
and named.
