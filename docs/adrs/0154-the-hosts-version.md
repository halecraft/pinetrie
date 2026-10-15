# ADR-0154 — The host keeps its version of each offer as a remote bookmark, `pinetrie-offer/<name>@pinetrie-host`

Numbered ADR-0152 until 2026-10-15, when two files held that number.

- **Status:** Accepted (Duane, 2026-10-15)
- **Area:** `docs/the-jujutsu-repo.md`, `packages/jj/TECHNICAL.md`
- **Evidence:** S215, S73, S48
- **Amends:**
  - ADR-0105: whether you edited an offer is read from the host's remote
    bookmark, not from the evolog. An archived lane's tip is parked under a
    ref of the host's, not deleted.
  - ADR-0104: authorship of an offer comes from the host's remote bookmark.
    The op log no longer holds anything the host must read back.

**Context.** Duane's repo grew to 1.9 GB of jj metadata in 26 days:
62,964 operations, 92% of them the host's, and 59,834 `refs/jj/keep`
(S215 items 3 and 5). jj prunes none of it on its own. `jj util gc` collects
only what `jj op abandon` has already cut loose, and never the index (item
4). Refreshes ran for seconds. Most jj commands cost the same whatever the
size of the history, but the evolog does not (items 1 and 2). The host
reads each offer's whole evolog on every refresh, to tell whether you
edited it (ADR-0105, S73). jj keeps the evolog in the op log, so a full
read walks operations back to where the change began: about 30,000 files
opened, 0.3-0.5 s, for one offer on Linux, and 4.6 s for one on Duane's
Mac (item 9). The same read ties the op log to
the host's correctness. Cut the log past an offer's newest host version
and the offer reads as yours, and the host never touches it again (item
6). So the log could not be pruned without care, and the read that needed
it was the slow one.

jj already has a way to say "this is someone else's version of my
bookmark, and mine has moved past it": a tracked remote bookmark. It
shows the difference itself (`pinetrie-offer/x*`, "ahead by 1, behind by 1"), it
moves with an import, and a ref keeps its commit alive through any gc
(item 10).

**Decision.**

- **The host's version of an offer is a remote bookmark,
  `pinetrie-offer/<name>@pinetrie-host`,** the git ref
  `refs/remotes/pinetrie-host/pinetrie-offer/<name>`, which the offer's
  bookmark tracks. `pinetrie-host` is not a git remote of yours, and
  nothing pushes to it or fetches from it.
  - **The host's steps on an offer end with a mark:** the ref set from the
    offer's own bookmark (`git update-ref <ref>
    refs/heads/pinetrie-offer/<name>`), `jj git import`, then `jj bookmark
    track pinetrie-offer/<name> --remote=pinetrie-host`, all as the host.
    The import moves a tracked bookmark with its remote, as after a fetch.
    The track makes the tracking the first time, and writes nothing after
    (S215 item 18). It also repairs a jj command of yours that imported
    the ref first, untracked. A new offer's bookmark is made by `jj
    bookmark set`, as now.
  - **A host rewrite moves the ref in the same step.** jj moves a bookmark
    with the commit it rewrites, so the mark after it copies the ref from
    the bookmark.
  - **The ref is removed only with `jj bookmark forget --include-remotes`,**
    never by deleting it in git. A git delete and an import abandoned
    commits nothing else held, a commit of yours among them, and rebased
    yours onto the root (S215 item 18). An acceptance forgets the offer's
    bookmark and its ref in one operation, once the destination holds
    the offer.
- **Whether you edited an offer is the two bookmarks compared.** The
  lane's one `jj log` prints both commits.
  - **The same commit:** the offer is the host's, the whole stack with it,
    since a commit id hashes everything below. Nothing more is read.
  - **Different commits:** the evolog, as before ADR-0154, walked back to
    a version an operation of the host's made, with each version of yours
    on the way compared by description and `jj interdiff`. A rebase jj made
    because you reworded a commit below changes neither, and is no edit
    (item 10, as S48 item 7). A version that changes either is your edit,
    and the host leaves the offer, as now. A host step that stopped before
    its mark is found here as the host's: every step on the way is the
    host's (item 11). When the op log no longer holds those operations (a
    tidy cut them, ADR-0155), each revision is compared instead with the
    commit of its change in the host's version. This read happens only on a
    mismatch, which in steady state is never.
  - **A divergent change's host commit** is the one in the host's version,
    when that names exactly one; else, as before, the one whose newest
    evolog entry is the host's. A race can leave the version behind both,
    since jj exports no conflicted bookmark for a mark to copy.
  - **A deleted offer bookmark** (you abandoned the offer) leaves the ref,
    which jj shows as `(deleted)`. A rebuild sets the bookmark first and
    marks after, which joins the two again; moving the ref alone would
    leave your bookmark conflicted (S215 item 18). With nothing to build,
    the host forgets the ref.
- **An offer whose ref lags is marked by its next refresh:** an offer
  built before this, or one a host step left before its mark. When the
  evolog check that decides it today says it is the host's, its ref is set
  to the bookmark's commit by a mark (item 11). An offer that check reads as yours gets no ref, and stays yours.
- **Archiving parks a lane's tip** under `refs/pinetrie/archived/<lane>`,
  a ref jj does not import and git keeps, instead of deleting it.
  Restoring moves it back (S215, "Other things the host reads by id").
- **The op log is then free to be cut.** Nothing the host reads depends
  on it, so a cut at any point leaves every offer reading as it did. How
  your op log is kept small is ADR-0155's.

**Consequences.**

- An unchanged offer's refresh drops from 3 jj processes to 2, and none of
  them walks the op log.
- Offers no longer depend on the op log. Nothing the host reads is lost to
  a prune, so a tidy (ADR-0155) is a plain window.
- In jj and jjui, an offer you changed shows as `pinetrie-offer/<name>*`,
  and `jj bookmark list --all-remotes` shows how far it is from the host's.
  In sync, nothing extra shows.
- An offer's bookmark is still made with `jj bookmark set`. With
  `remotes.origin.auto-track-created-bookmarks` set (jj's default tracks
  nothing), it tracks `origin` too, and `jj git push --tracked` would push
  it, as today (item 11).
- Each offer step costs one import operation more, and a new offer one
  more for its track. The host already imports
  after every bundle, so a lane's turn costs about as many operations as
  now.

**Alternatives rejected.**

- **Reading the evolog with `-n 1` first,** and in full only when the
  newest entry is not the host's (S215 item 2): it makes the read about
  ten times cheaper. But the host still depends on the op log, and any
  cut of it must still stop at every open offer's newest host version.
- **Remembering the host's commit in a record:** a record can be lost
  after its jj steps landed (S73). The ref is written in the same
  operation that moves the offer.
- **Making a new offer's bookmark by the import** (the ref written first,
  imported with `remotes.pinetrie-host.auto-track-bookmarks`): it would
  close the origin leak above for those who opted into it. But the ref
  needs the new commit's id, which a step planned before the commit exists
  cannot name. That needs a read in the middle of the build.
- **An untracked remote bookmark:** jj counts it among
  `builtin_immutable_heads()`, so the WIP below an offer would become
  immutable (item 10).
