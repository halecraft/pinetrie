# ADR-0065 — One owner for your repo

**Status:** Accepted. Evidence: S87, S89. Implementation:
`PLAN-2026-10-03-repo-owner`. Amends ADR-0038 (an offer is refreshed on an
observed move, not a poll), ADR-0060 (a take names the offer it was shown)
and ADR-0034 (a lane's fetch is imported by the owner).
**Amended by ADR-0067:** whether a lane's work changes any file is `none`,
`some` or `unknown`, and an untraced start or an unknown answer builds no
offer, so refreshing every named lane on a full observation wakes none from
before `Pineta-Source`; a lane whose base moved runs two more jj processes,
once per move.
Amended by ADR-0083: a take is an *offer integration*; it names what it
was shown.
Amended by `PLAN-2026-10-05-quiet-startup`: a full observation refreshes
every named lane whose root is not archived, and every open record. An
archived lane has no base to follow, and its ref, its offer bookmark or an
open record still marks it.

**Context.** A take ("add to the project") sometimes took 30–60 s, and the
page showed nothing meanwhile. S89 measured it on a clone of Pineta's repo:
a take waited 13–18 s behind 52–59 refreshes on the offers' one queue, and
another person's chat waited as long, since the take held the host's one
queue too. Every trigger queued a whole refresh; nothing merged duplicates
(about half were); the 2 s poll overlapped itself (about half its ticks);
the host's own writes and the fetch's imports fed it with no one at the
keyboard; and a refresh that wrote nothing ran 18 jj processes. "One queue
for your repo" was a convention, which the fetch's import and lane work's
reads did not keep, so the host itself made divergent heads (S87 item 7).
And a take took whatever the offer was by then, not the one the person had
reviewed.

S87 established what makes a principled answer possible: a jj read pinned
with `--at-op` writes nothing whatever runs beside it; `jj op log -n 1`
merges divergent heads and names the result; the heads are file names that
`readdir` lists; and `fs.watch` on that directory fires on every jj write
and not on a read.

**Decision.**
- **One owner writes your repo** (`@pineta/repo`'s `startRepoOwner`). It
  is the only thing that knows the head: writes run on it, everything else
  reads at the head it last saw. The package exports no runner on your repo;
  a step gets `RepoOps`, a read `RepoReads`. `lanes` keeps what a lane also
  runs; startup's reads (`prepareHost`, `prepareShared`) are the one
  documented exception.
- **Commands first, upkeep keyed** (`@pineta/keeper`). A take, a `line`
  command, a split's span and end, an archive's ref moves and a fetch's
  import are commands; a lane's refresh, the line's record, an observation
  and the shared rewrite are upkeep, at most one queued per key, started
  only when no command waits. A command waits for at most the step running.
- **Pinned reads.** A page's review, a description's gather and lane work's
  reads of your repo run with `--at-op` at the last observed head, never
  queued; a write observes at once, inside its step, so what it wrote is
  readable by the next read.
- **The watched heads, not a poll.** The owner watches `op_heads/heads`,
  with a `readdir` backstop; a new head queues an observation, which reads
  one fingerprint (the line, the WIPs, the offers, the lanes' refs, `@`) and
  says what moved (`planObserve`). A bookmark of yours that no offer depends
  on moves nothing; `@` alone rewrites `yourEdits` and the line's record
  from one shared read, and refreshes no lane.
- **Shared facts per operation, one read per lane.** What every lane reads
  at one operation (the line, the taken sources, `@`'s files) is read once;
  a lane on the line is read in one `jj log`. An unchanged offer's refresh
  runs at most 3 jj processes.
- **A take names the offer it was shown** (`OfferSeen`): its ledger and
  whether it conflicted. It is refused `offer_changed` when the offer now
  brings other work or newly conflicts; a rebase onto a moved target and
  your own edit are still the offer you saw.
- **Per-seat order, by a chain.** One person's commands run in the order
  sent, each handed over once the one before has replied; different
  people's do not wait on each other, and an offer command holds no other
  command. An archive holds the documents' keeper only for its record and
  its unload; its teardown runs off it.
- **The page shows an offer command's life:** in flight, then refused or
  failed, with why.

**Consequences.** On the same scenario as before (S89, § After), a take
answered in 0.44 s and the other person's chat in 0.01 s; a refresh that
wrote nothing runs 3 jj processes, against 18; the host's own jj
processes fell from about 8,400 to 3,200 over the run. The host makes no
divergent heads, and every operation it makes is `pineta-host`'s. A page
whose record lags the repo gets `offer_changed` rather than taking work
nobody reviewed. A lane on a WIP still reads its base the separate way.
