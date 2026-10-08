# ADR-0077 — A thread's followers are told how its runs end and what it has ready; what you have dealt with is yours on every device

- **Status:** Accepted (Duane, 2026-10-05)
- **Area:** `docs/06-interface.md`, `packages/interface/TECHNICAL.md`
- **Evidence:** S32, S101
- **Amends:**
  - ADR-0024: presence's verb is *reading*; a person follows a thread they
    have written on, and a column follows its end.
  - ADR-0030: which mentions you have seen is kept per person, in your
    attention document, not per device.
  - ADR-0056: "since you were here" reads your attention document, so it is
    the same on every device of yours, and a run's end asks for a verdict even
    with digests off.
  - ADR-0059: the inventory is one of a person's documents (`personDocId`),
    which share one policy.
  - ADR-0063: a root's directory record holds who has written on each of its
    threads (`threads`), and the directory refreshes a root's record as the
    host opens it.
  - ADR-0069: the badge counts verdicts that need you, offers of threads you
    follow and unseen mentions; the menu gains "Needs you" and "Worth a read".
  - ADR-0071: a short ask's end costs a request again, for its verdict alone.
  - ADR-0075: the final request also asks for the run's verdict, first, and
    its reply is read by `endReplyOf`.
- **Amended by:**
  - ADR-0085: your open roots are a third person document (`open:`), and ▦
    carries the mark the Archive tab did.
  - ADR-0091: an open offer is marked on the board for everyone, and listed
    and counted in your inbox for its followers.

Builds on ADR-0076.

**Context.** With several agents at work, Duane could not tell which tab
needed him:

- **The tab's mark said the wrong thing at the wrong time.** A tab pulsed
  while its agent ran (`.tab.running`, `scale(1.8)` every second), so the
  state that needs nothing from you was the one that moved. When the run
  ended the dot went out, so the moment the ball came back to you was the
  moment the tab went quiet.
- **Nothing distinguishes how a run ended.** A question, an error, a finding
  worth reading and a plain "done" all look the same. Which one it is
  depends on the run, so no rule over the entries can tell; a model can.
- **ADR-0069 foresaw this:** more kinds in the badge "would need a
  per-device seen state for runs". Per device is the wrong scope. You read a
  thread on the laptop, and the desktop should not still ask you to.
- **What you have dealt with is kept per device today:** the inbox's seen
  mentions (`use-inbox.ts`) and where you left each thread (`left.ts`), both
  in `localStorage`. The inventory's arrangement is already per person:
  a Yjs document only your tabs write (ADR-0059).
- **Runs belong to people.** Someone else's intermediate state and what
  they are learning are theirs. You care about the state of what you share,
  and about anything addressed to you.
- **An offer is a judgement call.** Anyone in a session can take any
  thread's offer, since the repo is the session's (ADR-0038, ADR-0065), but
  whether the work is ready is for the people who were in the
  conversation. Today the badge counts every open offer for everyone.

**Decision.**

- **A run's end gets a verdict**, one of:
  - **needs you**: a question, an error, a decision or a next step only a
    person can take;
  - **worth a read**: something learned or explained, to come back to;
  - **done**: nothing to decide or learn.
  Each has a one-line **reason**, shown on hover and in the header's row.
- **Facts decide before a model does.** A failed run needs you, with its
  error as the reason. A run stopped by someone is done for them, and worth
  a read for the thread's other followers ("Bea stopped it"). Otherwise
  the model decides.
- **One request at a run's end** returns the verdict, and the digest when
  the ask is long (ADR-0075). It is asked for every run, whether digests
  are on or off. Until the reply comes, the verdict is **pending** and the
  tab keeps its working ring: the agent's side is not finished. A request
  that fails, or a pending verdict a starting host finds, becomes **needs
  you**, "the run ended; pine·trie could not tell what it needs". A missed
  question stalls work silently; a false alarm costs a click.
- **A thread has followers: everyone who has written a message on its
  path.** You follow a thread by writing in it. A run's prompt is a message
  on the path, so whoever asked follows it. The host keeps the fact, who
  has written on each of a root's threads, in that root's directory record
  (`RootRecord.threads`, beside `writers`), since a client holds only its
  tabs' root documents (ADR-0063). The directory already rewrites the
  record whenever the root's document changes, so the fact needs no write
  of its own. Following is derived from it, so that unfollowing can later
  be added as a person's own choice (below).
- **What a thread has for its followers:** how its last run ended (its
  verdict), and its open offer. Both are about the thread's work, and both
  go to the people who can judge it. They clear differently: a verdict is
  an event, cleared by reading past it; an offer is a standing state,
  cleared by taking or withdrawing it. Either clears with "not needed": a
  verdict until the next run's end, an offer until it changes.
- **Listed for everyone, counted for followers.** A thread's open offer is
  listed under "Ready to add" for everyone, since it concerns the shared
  project and anyone may take it; it raises a tab and counts in the badge
  only for the thread's followers. A verdict is shown only to the thread's
  followers.
- **One verdict per lane**, a session record (`pinetrie.verdict`, keyed by
  lane): the run's prompt, its last entry, and **what happened**, never a
  level: pending, what the model said (with its reason), failed (with the
  error), stopped (by whom), or unclassified. Who it asks something of,
  and how urgently, is decided on each client for its person: a stop is
  done for whoever stopped it and worth a read for the rest. The run's
  last entry comes from the run, never from the lane's tip, which a card
  taken at the run's end may already have moved. The next run's end
  replaces the record. The header and the Archive tab read it across
  roots.
- **What you have dealt with is per person**, in `attention:<writer>`: a
  Yjs document only your tabs write, which the host stores and shares only
  with you, as it does your inventory. It holds:
  - `read`: per lane, the furthest entry you have read. It replaces `left`,
    so "since you were here" is the same on every device of yours. A tab
    only moves it forward, writes it while a column follows its end in a
    page you can see (a run you watch end raises nothing), and at most once
    every few seconds per lane: each write stays in the document's history
    (S101).
  - `dismissed`: per lane, the ask whose verdict you marked "not needed";
    `dismissedOffers`, the lane tip its offer held (`ledger.source`).
  - `since`: where you started, set by the document's first write and never
    moved. A verdict that ended, or a mention written, at or before it is
    not new to you, so a first visit raises nothing from before it. Until
    it is set, nothing is raised.
  - the inbox's `mentionsSince` and `seen`, moved from the device. The
    inbox's watermark moves as mentions are seen, so it is a field of its
    own: shared with verdicts, seeing a later mention would mark an older
    unread verdict read.
- **A person's documents are a family.** `inventory:` and `attention:` are
  two kinds with one rule: only that person's tabs write them, and the host
  stores them and shares them only with that person. They stay separate
  documents because they are written at different rates, and so keep
  different histories with different needs for compaction. Undo spans
  documents, so separate documents cost it nothing. One client shell holds
  any of them: it reads the document, and writes nothing until the host's
  copy has arrived, so a write never overwrites what your other devices
  wrote.
- **Attention is decided on the client, purely.** A lane needs your
  attention when you follow it, its lane is not busy, its root is not
  archived, and either:
  - its verdict is needs you or worth a read, ended after your read mark
    (or `since`), and was not dismissed; or
  - it has an open offer you have not dismissed: needs you.
  A root's level is the highest of its lanes', and a busy lane shows
  working.
- **On the tab:**
  - working: a hollow blue ring, still;
  - needs you: a filled amber dot, which pulses two or three times as it
    arrives and then stays still;
  - worth a read: a dim amber dot, never animated;
  - done: the ring goes, and a ✓ fades over a few seconds;
  - your unsent card: your colour's pip after the label, as before.
  Status goes before the label and your card after it, since they answer
  different questions. Amber matches the "since you were here" line the tab
  opens onto.
- **Motion marks a change seen live, never a state.** A page that loads, or
  a tab shown again, draws every mark still.
- **The header** lists each verdict once and each offer once. "Needs you"
  lists verdicts; "Ready to add" lists every open offer and marks those of
  threads you follow; "Worth a read" is listed, not counted. The badge
  counts verdicts that need you, offers of threads you follow and unseen
  mentions. The page's title carries the badge's count, so a browser tab in
  the background shows it.
- **Threads you do not follow** raise nothing for you. Their working rings
  show on your open tabs, still, as state. Their offers are listed, not
  counted. Their finished work reaches you as the project moving
  (ADR-0076). A mention reaches you in any thread, for that message; a
  reply makes you a follower.
- **Unfollowing comes later**, as a person's own choice in
  `attention:<writer>`: per lane, the entry at which you unfollowed, so
  that writing after it follows again. The host's fact does not change, and
  only your own tabs need your choice. Following without writing would be
  the same choice the other way. Neither is built now.
- **Three verbs, one meaning each.** A person *follows* a thread: they are
  among its followers. A person *is reading* a thread: presence, now
  (ADR-0024, whose code already says `reading`). A column *follows its
  end*: the scroll (S32), a column's verb and never a person's. Where
  presence's docs and comments say a person follows a thread, they say
  reading instead. No string a person sees used "follow" for presence.

**Consequences.**

- Every run costs one model request at its end, even with digests off. For
  a short ask, which ADR-0075 made free, it is the verdict alone: the ask
  and the last message.
- Reading a thread does not clear its offer; adding the work does.
- A thread whose followers have all gone leaves its offer listed and
  counted by no one.
- `pinetrie-left:<session>` and `pinetrie-inbox:<session>` go, with their
  codecs. Nothing stored on a device is carried over: `since` starts
  everyone with nothing unread.
- The "since you were here" line now moves when you read on another device.
- A model can be wrong. The reason makes a wrong verdict quick to judge, and
  "not needed" clears it.
- `attention:<writer>` grows with every read mark it overwrites. Writes are
  throttled per lane; its compaction is a separate question, which keeping
  it apart from the inventory leaves open.
- The tab's pulse while the agent works goes. The column's mark and the
  rail keep theirs (ADR-0054), since you are looking at them.

**Alternatives rejected.**

- **The agent declares its own status** in a last tool call. It costs
  tokens in every run's context, and an agent is a poor judge of its own
  work.
- **A rule over the reply** (a trailing "?", an error string). Fragile, and
  blind to findings worth reading.
- **A separate verdict request.** Two requests at every run's end, and a
  second skill to keep in step with the digest's.
- **Per-device seen state**, as ADR-0069 suggested. Clearing a thread on one
  device would leave it raised on the others.
- **One watermark for verdicts and mentions.** The inbox moves its own as
  mentions are seen; shared, it would mark verdicts read that no one read.
- **One `person:<writer>` document** holding the inventory too. One policy
  rule and one sync wait, but it couples two write rates and two histories;
  the family gives the one rule without it.
- **Every run's end pulses until seen.** A row of pulsing tabs reads as an
  alarm, and several runs often end within minutes. A brief pulse then a
  steady dot reads as a list.
- **Others' runs raise "worth a read" for everyone.** Their learning is
  theirs; it would make the badge noise again.
- **Addressees stored on each verdict.** A fact about the thread copied
  into each event; an offer would need its own copy, or borrow the latest
  verdict's, with a fallback when there is none.
- **A record of its own for who wrote on a thread** (`pinetrie.writers`,
  keyed by lane). It would need writing wherever a person's message lands,
  wherever a lane is made, and at startup; the directory already does all
  three for the root's record.
- **A verdict that stores a level** (needs you, worth a read) with who
  stopped it beside. The level of a stop depends on who reads it, and the
  record allows combinations that mean nothing.
- **Every open offer counted for everyone**, as ADR-0069 had it. With
  several people, the badge counts work that is not yours to judge.
- **Following kept on the host**, written by a command. Only your own tabs
  need to know whether you follow, so your own document holds the choice
  and no command is needed.
