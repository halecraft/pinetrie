# ADR-0039 — A thread has a name you can say, and its offer is a work in progress until its run ends

**Status:** Accepted. Evidence: S49. Implementation:
`PLAN-2026-09-29-thread-names`. Amends ADR-0038 (the offer's bookmark, its
placeholder line, and how it follows the lane and where it starts).
**Amended by ADR-0040:** the header shows the name alone, as who works in the
column; where the lane works moves to the work strip, as an effect.
**Amended by ADR-0057:** a thread is named when its column first
wants an agent, under a lane id the client makes, and its lane is created
under that id at the first send.

**Context.** A thread's lane is named by a UUID, `t-01a0ed41-5f73-…`
(ADR-0019). It names the offer's bookmark, so two threads made a minute
apart differ at the tenth character, and the column header shows nothing
stable at all: "own copy · f361020e" is the lane's newest commit, which
changes with every tool call. Nothing tells you which column an offer in
jjui belongs to.

An offer's placeholder line, until an agent describes it, is
`offer: <first line>` of the thread's path from its root. Every branch of a
root shares that line, so two threads' offers read alike, and it names
what the root asked, often a question. "offer" also says it is ready, while
the thread is still working.

While a thread works, its offer is rebuilt after every commit the lane
makes: six operations in your repo and a new change id each time (S49). jjui
shows a different commit every 20 to 30 seconds. And it is rebuilt only when
the lane moves: when you take a parent thread's offer, where a branch's offer
starts moves while its lane does not, so the branch's offer keeps work you
now have.

**Decision.**
- **Each thread's lane has a name of two words**, an adjective and a noun,
  lowercase, joined by a hyphen: `amber-fox`. The words come from two
  curated lists of 256 each: short, common, concrete, and neutral in any
  combination. So a name is easy to say, to type, and to tell apart.
  - **The host names every lane that has no name**, from a hash of the
    lane's id into the 65,536 pairs, taking the next free pair when that one
    is taken, in the order the lanes were created. So a name is unique among
    the document's lanes, archived ones included. One step does it, at the
    host's start and whenever it creates a lane, one at a time, before the
    lane's first run.
  - **The name is stored**, as a host-written `pinetrie.name` value keyed by
    the lane: the map from a name to its UUID, and never recomputed, so a
    change to the word lists renames nothing.
  - **It is fixed.** A rename would move a bookmark and leave older
    trailers naming the old name.
- **You see it everywhere you look for a thread.** The column header shows
  it before where the thread works: "amber-fox · own copy", or "amber-fox ·
  in <dir> · shared". The lane's newest commit is no longer shown there. The
  page header's offers menu and the host's log lines name threads by it.
- **Everything you type in jj uses it; the machinery keeps the UUID.** The
  offer's bookmark is `pinetrie-offer/<name>`. A lane's container, volume and
  remote (`pinetrie-<lane>`) keep the lane's id: you never type them.
- **An offer is a work in progress until its thread's run ends.** Until an
  agent describes it, its line is `WIP (<name>): <first line>`, where the
  first line is the thread's own first message: the first prompt its lane
  ran, not its root's. The agent's commit message replaces it when the run
  ends, as ADR-0038 decides, and carries the trailer `Pinetrie-Thread: <name>`
  beside `Pinetrie-Lane` and `Pinetrie-Entry`.
- **An offer follows its lane in place.** When the lane moves under an
  unedited single offer, the host rebases the offer back onto where it
  starts, restores the lane's new tip into it, and rebases it onto the
  target again: three operations, the same change id and bookmark, and the
  tree a fresh build would have (S49). An offer that carried an agent's
  message goes back to its WIP line, one more operation, since the message
  no longer describes it. A stack is unchanged: it is marked stale (ADR-0038).
- **An offer also follows where it starts.** Where an offer starts moves
  without the lane moving when you take work it holds some of: a parent
  thread's offer, which delivers the work a branch inherited. The offer
  records where it started, and follows a new start as it follows a new tip
  (S49 item 4), so it never offers work you already have. When nothing is
  left, the start being the lane's tip, the offer is withdrawn (a follow would
  leave it empty, S49 item 5): its commit abandoned, its record deleted, and
  the column shows nothing to take. That happens to a parent's offer when you
  take a branch's that holds all of it. An offer you edited is still left
  alone, and a stack is marked stale.
- **A have your repo does not hold yet is no start.** A copy of your `@` is
  made in a lane, and reaches your repo only with that lane's work; a lane
  that never changes a file never sends it. Where an offer starts names each
  have with `present()`, so such a copy is skipped rather than failing every
  lane's offer.

**Consequences.**
- In jjui and `jj log`, a working thread is one commit,
  `pinetrie-offer/amber-fox`, whose diff grows, with an evolog of its updates.
- Your op log gains three `pinetrie-host` operations per lane commit, not six.
- A taken commit names its thread twice: by name, for you, and by lane, for
  the machinery.
- Taking a parent thread's offer shrinks its branches' offers to their own
  work; taking a branch's withdraws its parent's, when it held all of it.
- An offer built before this keeps its `pinetrie-offer/<lane>` bookmark until
  it is taken or abandoned: nothing renames it.
- A new document table, `pinetrie.name`, written only by the host.

**Alternatives rejected.**
- The lane id's last characters (`a17a15f3`): stable and unique, but not
  something you can say or remember.
- A name the agent writes from the thread's first message: a model request
  per thread, names that collide or drift, and it repeats what the offer's
  description says.
- A name computed from the lane id at every read, never stored: a collision
  cannot be seen, and a changed word list renames every thread.
- Naming the lane's remote, container and volume by the name too: a rename
  of machinery you never type, for nothing you read.
- Renaming open offers' bookmarks to the new names: code for the few offers
  open when this lands, kept forever.
- Not updating the offer while its thread runs: hides the thread's progress
  in jj, which ADR-0038's column promises ("offer updates after each turn").
- Keeping `offer:` as the placeholder: it says the work is ready while the
  thread is still working.
