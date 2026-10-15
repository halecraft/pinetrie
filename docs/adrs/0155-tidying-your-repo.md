# ADR-0155 — `pnpm tidy` cuts your repo's op log to a window, when you run it and no host serves the repo; a starting host says when one is due

Numbered ADR-0153 until 2026-10-15, when two files held that number.

- **Status:** Accepted (Duane, 2026-10-15)
- **Area:** `docs/the-jujutsu-repo.md`, `apps/pinetrie/host/TECHNICAL.md`
- **Evidence:** S215

**Context.** jj never prunes the op log on its own (S215 item 4), and the
host makes most of it: 57,926 of 62,964 operations in Duane's repo over 26
days, 1.9 GB of jj metadata (items 3 and 5). Once offers no longer depend
on the op log (ADR-0154), any cut of it is safe for the host.

A cut is slow, and is wasted by a write that races it. On Duane's Mac,
keeping seven days took 135 s for `jj op abandon`, 54 s for `jj util gc
--expire=now` and 31 s for `jj debug reindex` (item 12). The abandon costs
about 6 ms for each operation it keeps, whatever it cuts, so cutting more
often does not make it shorter (item 13). A write during the abandon is
kept, but it brings the old chain back, so the log holds the window twice
(item 14).

So a cut inside a running host either holds every repo command for
minutes, or is wasted by the host's own writes. A countdown at a quiet
time could avoid both, but takes a dialog, an intent, a record and idle
detection. A cut at every start delays the start by minutes, once a week.
A cut that you run while no host serves the repo races nothing of
pine·trie's, needs no interface, and runs when you choose.

**Decision.**

- **`pnpm tidy [folder] [--days N] [--dry-run]`** tidies the jj repo at
  `folder`, pine·trie's own repo when none is named, as `pnpm dev` and
  `pnpm serve` choose it. `--days` is the window, 7 by default.
- **It refuses** when:
  - a host serves the folder: its session's store is locked;
  - the repo has more than one workspace, since the cut would leave the
    others stale (item 7);
  - the folder is no jj repo;
  - no operation is older than the window. That is not an error: it says
    so, and does nothing.

  It finds the folder's session in the registry, read and never written,
  and takes the session store's own lock for its whole run, as a host
  does (`openDatabase`, exclusive locking mode). A host serving the folder
  makes that lock fail. A host starting during the tidy is refused by the
  check that refuses a second host, and its words name `pnpm tidy` as one
  holder it may be. A folder no host has served has no store, and the
  tidy makes none.
- **It says what it will do before it does it:** how many operations it
  keeps and cuts, the time it should take (the operations kept times 6 ms,
  item 13), and that `jj undo` will then reach back N days. It asks you not
  to run jj until it is done. `--dry-run` stops there.
- **Then four steps,** each timed and printed:
  1. `jj util snapshot` as you, so your working copy's operation is the
     head;
  2. `jj op abandon ..<the newest operation older than the window>`, without
     `--ignore-working-copy`, so jj re-points your working copy (item 7);
  3. `jj debug reindex`, since gc never clears the index (item 4);
  4. `jj util gc`, with jj's default expiry and never `--expire=now`. It
     keeps every object newer than two weeks, so a command of yours
     writing beside it loses nothing (item 15). What the abandon cut
     leaves the disk at the first tidy two weeks later.
- **It reports** sizes and counts before and after, and whether a jj
  command ran during it: more operations after than it kept, plus those
  made during the tidy, is the doubled window of item 14. Nothing is lost
  then, and it says the next tidy finishes the cut.
- **A starting host says when a tidy is due.** It reads your op log once,
  in a pinned read that the start does not wait for. When the oldest operation is more than twice seven days
  old, it logs one line: "your repo's op log goes back 26 days (63,162
  operations); `pnpm tidy` would keep the last 7". It writes nothing in
  your repo, and the page shows nothing.
- **The word** is "tidy" (`docs/glossary.md`).

**Consequences.**

- Your op log is cut only when someone runs `pnpm tidy`. Until then it
  grows as it does now, and each start's line says how far.
- A tidy runs while the host is stopped, so no acceptance or run waits for
  it. With the host stopped, a cron or launchd entry may run it. While the
  host runs, the entry is refused.
- After a tidy, `jj undo` and `jj op restore` reach back N days.
- A jj command of yours during a tidy loses nothing, and the tidy says it
  was wasted.
- A tidy stopped part way is safe. An abandon cut short has not moved the
  op heads, and its operations are garbage for a later gc. A reindex cut
  short leaves the index for jj to rebuild, once, at its next command.
- The host's start costs one read of the op log, after the page is up:
  about a second for 63,000 operations on Linux.
- `jj debug reindex` is a debug command, and may change between jj
  releases.

**Alternatives rejected.**

- **Trimming as upkeep on the owner, whenever no command waits:** a person
  acting during it waits minutes, with no warning.
- **A countdown at a quiet time, on the owner's pages:** a dialog, an
  intent, a record and idle detection for something you can run in one
  command.
- **Tidying at every host start when due:** that start is minutes slower,
  and every run it resumes waits for it.
- **Running beside a live host:** the host's writes during the abandon
  double the window, and the tidy is wasted.
- **`jj util gc --expire=now`:** 54 s more, and it could delete an object
  a jj command of yours had written but not yet linked.
- **Making fewer operations** (an offer rebuilt once per run): about a
  third of the operations, at the cost of a live offer during runs (items
  16 and 17). Not decided, and not needed while a tidy can be run.
