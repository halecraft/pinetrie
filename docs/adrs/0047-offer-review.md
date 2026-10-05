# ADR-0047 — A column widens to review its offer: every file's diff in one scroll, named by commit

**Status:** Accepted. Evidence: S57. Implementation:
`PLAN-2026-09-29-offer-review`. Amends ADR-0038 (the offer as a preview) and
ADR-0040 (the work strip's line and bookmark).
Amended by ADR-0078: the review is one of the column's pane's subjects,
which owns its width, head, Escape and focus, and covers a narrow screen.

**Context.** The work strip counts an offer's files ("2 files ready",
"conflicts with your edits in 1 file"), and its line could not be opened.
The host already records every path, conflict and file you are editing, and
the page only counted them. Nothing in pine·trie showed the offer's commit
message, which an agent writes (ADR-0038), or its diffs: ADR-0038's preview
was `jj log` and jjui. A collaborator on an invite link has neither, and can
press **take**. "touches files you're editing" does not say which, and that
is what you need to choose between **resolve** and **take anyway**.

A diff needs width. A column is 28rem, about 60 monospace characters, and a
reviewer reads a change in order across its files, beside the thread that
explains it and the composer that answers it.

The offer's record is rewritten, with a new `at`, on every trigger: each of
your jj commands included. A review keyed on it would read everything again
after each.

**Decision.**
- **The offer's line opens a review, and the column widens to hold it.** The
  thread stays at its left at 28rem; the review is on its right, in the
  column's colour. It is the column's: it keeps the column's key and drag
  handle, moves with it, and closes with it. Whether it is open is your
  choice, kept while the column is mounted and never stored. It closes when
  the offer is taken or withdrawn, and the next offer does not reopen it.
- **The review is a file list beside one scroll of every file's diff.** Each
  revision is headed by its description, the host's trailers removed. Each
  file's head (its status, path, line counts, and flags: **conflicts**,
  **you're editing**) stays pinned while its diff is in view. Diffs are
  unified, and load as their files come near the view, one file per
  request. A file changing more than 400 lines waits to be opened; a diff
  past 1 MiB is refused, and says to look in jj.
- **Reviews and diffs are named by commit.** `/offer/<v>/review/<commit>` is
  a revision's description and per-file stats, and
  `/offer/<v>/diff/<commit>?path=…` one file's diff. A commit id names its
  content and `<v>` (`OFFER_WIRE`) the answer's shape, so an answer never
  changes and is served immutable, as a blob is (ADR-0042). The one thing
  that changes, which commits the offer is now, is the record's `commits`,
  read on every trigger. So an unchanged offer costs no request, a changed
  one has new URLs, and nothing keys on `at`.
- **The host serves only a commit an open offer holds now,** behind the
  invite key. Refusals are never stored. Reads run on the host's queue for
  your repo: a jj read of a repo with divergent operation heads reconciles
  them, which writes (S57).
- **The bookmark copies on a press.** Over plain http, which has no
  clipboard, it selects its text.

**Consequences.**
- A person without jj can read what a take brings. jj and jjui stay the
  other place to look.
- `OfferRecord.commits` is required. An offer stored before it does not
  decode: the host builds a new one beside it, which you abandon.
- A change to the review's template, schema or diff flags bumps
  `OFFER_WIRE`, or pages keep a year-old answer of the old shape.
- A refresh that only rebases the offer changes its commits, so an open
  review reads that revision again: a new parent can change its diff.
- A revision divergent when the host last read the offer is left out of
  `commits` until the repair, so a review can briefly show fewer revisions
  than the offer has.
- A column reviewing its offer is wider, and can push the columns right of
  it past the strip's edge, as a new column does.

**Alternatives rejected.**
- A panel inside the work strip: 28rem wide, a scroll inside a scroll, and
  a second place to review.
- A popover: it closes on any scroll outside it, and has no room for diffs.
- An overlay: it hides the thread and the composer.
- A tab, as Archive is: it leaves the thread behind. Triage across threads
  may want one later.
- A pane of its own in the strip: dragging, alignment, closing and moving by
  key would all have to keep it beside its column.
- Side-by-side diffs: at most 64rem, about 70 characters a side. Deferred.
- A whole revision's diff in one request, or several files split from one:
  a revision can pass 1 MiB and hold the queue, and jj does not quote paths
  in `diff --git` headers, so a split can be wrong.
- Refetching on `at`, or on a fingerprint of the record: `at` changes on
  every trigger, and a fingerprint misses your later edits of an offer you
  already edited.
- Naming revisions by position or change id: a position can name another
  revision after a split, and a change id can be divergent. `host.wrote` is
  the host's own last write, the baseline for spotting your edits, and goes
  stale when jj rebases the offer.
- Stats and descriptions in the record, or diffs in the document: rewritten
  on every trigger and replicated to every peer, for what only a reviewer
  reads.
- Parsing `jj diff --stat` or git's numstat: lanes decides from templates
  and exit status, and your repo need not be colocated.
