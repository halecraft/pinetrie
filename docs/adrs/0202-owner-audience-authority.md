# ADR-0202 — Each document has an owner, an audience, and one authority only where a rule must hold; a page keeps a store and needs no host to write; an agent is tethered to one machine, which alone writes its record

Numbered 0196 until 2026-10-20, when two files held that number.

- **Status:** Proposed
- **Area:** `docs/01-architecture.md`, `packages/protocol/TECHNICAL.md`,
  `packages/schema/TECHNICAL.md`, `packages/session/TECHNICAL.md`
- **Evidence:** S3, S19, S21, S28, S75, S264, S289, S290, S291
- **Amends:**
  - ADR-0037: a page keeps a Kyneta store in the browser and reconnects; a
    tab's seat lasts across reloads; a client's work and requests outlast the
    host's absence.
  - ADR-0048: a card's text is shared with its canvas's members only, not with
    every client.
  - ADR-0059: a canvas's places are its members' to write, each card's place
    one value under its own key; your drafts are yours; the host owns no
    place.
  - ADR-0066: a move is undone by the tab's own undo stack, as text is.
  - ADR-0119: a lane's record names the machine it is tethered to, by
    principal; that machine alone writes the agent's record.

**Context.**

pine·trie's rules for its documents were made one case at a time. The
places are the host's (ADR-0059). Your inventory, attention and open
canvases are yours (ADR-0059, ADR-0077, ADR-0122). Every other document,
card texts and roots among them, goes to whoever asks, which is Kyneta's
default (`apps/pinetrie/host/policy.ts`): S264 measured every client
receiving every card's text unasked. A client keeps no store and never
reconnects (ADR-0037), a rule written as a fact rather than argued.

That last rule decides what happens when the host is away. Your
composer makes its card at the first keystroke, and the card's place is
the host's to write, so with the host gone the request fails, the card
is dropped, and the box empties itself on every keystroke. A reload
loses whatever was typed.

What Kyneta 4.0 offers, read from its source and measured:

- **Policies are pure functions of a document's id and a peer's
  principal**, registered alike on every peer. `canWrite` is judged
  against your own writes (they throw) and against every offer's sender,
  so no peer, relay or host passes on a write the rule refuses.
  `canShare` gates every way a document reaches a peer, a request by id
  included, and a refusal answers `vacant`, as for an id that does not
  exist.
- **A browser store** (`@kyneta/indexeddb-store`, 4.8 kB minified). A
  reload keeps its seat; a second tab gets its own. With the host down,
  writes to your own documents and to a card's text stand, survive a
  reload, and reach the host when it returns; a `Line` message sent while
  it was down, even across a reload, is answered exactly once, in order
  (S290). A Yjs document loads its stored history before claiming its
  seat's `clientID`, which removes S28's corruption on a reconnect, and
  a reconnect under the same seat lost nothing (S289).
- **Placement without a server, in Yjs.** A card's place as one value
  under its own key, written by any member, converged in every race,
  connected and partitioned, and was never torn. The loser of a race can
  see it lost. Kyneta's undo of your own move puts the card back, or
  leaves it where someone has since moved it. A move costs 12 bytes
  (S289). S75's objections to a place in a CRDT were a place stored as
  separate fields (it came apart), an arbitrary winner, a loser not told,
  and undo by fields; only the arbitrary winner remains, and for placing
  things in a shared space that is acceptable.
- **A pi lane reads only its own record.** It plans from its session's
  memory: an entry another peer writes is stored but is not in its next
  turn (S19), and pi cannot navigate to it (S3). People's messages reach
  a lane by being written through its session (S21).

Loro has a tree and a movable list with move semantics, but costs ten
times Yjs's size, is wasm, and its authors advise keeping a document
under 10 MB. pine·trie's places are shallow (canvas, column, card), so
the tree's guarantee against cycles is not needed (S289).

**Decision.**

*Every document answers three questions*, and its id, or one record its
policy reads, answers them, so every peer decides alike:

1. **Who owns it, and so may write it**: a person (any of their tabs and
   devices), a group (a canvas's members), or one authority (the peer
   that acts for it).
2. **Who may read it**: its owner only, a canvas's members, or the
   authority only.
3. **Does it merge**: if every concurrent change can be kept, it is a
   CRDT that its writers all write. If a rule must hold across concurrent
   changes, it has one authority, and only that authority writes it.

| | its writers merge | one authority writes |
|---|---|---|
| **only you** | drafts, inventory slots, attention, open canvases, your requests | none |
| **a canvas's members** | the canvas: its notes, images, its own pinned cards, which threads it shows, and every card's place among them; card texts; the board | none |
| **a thread's members** | the thread's intent log: its messages, edits and jobs; its queue and pinned cards | the agent's record and runs |
| **only the authority** | none | the agent's scratch, its lane, your repo's state |

*One policy* decides every document's owner and audience from its id
and the membership records, registered on the host and on every client.

*A canvas belongs to its members.* Each card's place is one value under
its own key in the canvas's document, and a field that changes on its
own (a command, a text version) has its own key, so a concurrent change
of one does not undo the other (S289). Placement is state, not intents:
the latest place is all anyone needs. A move between documents (into
your inventory, to another canvas) is a copy and a delete; two at once
leave two cards, both visible. Adding a member merges; removing one is
written only by a member allowed to manage membership.

*A thread's own data lives in the thread's documents*: its messages,
queue and pinned cards, never the canvas's. A canvas holds only which
threads it shows and where. So a thread column shown on two canvases for
a moment, while a move between them lands, is one thread in two places:
both send its jobs to the same tether. Which canvas a thread is on, and
so who may read it, is one value in the thread's own record, so a move
of a thread is one write and never leaves it readable by a canvas it has
left. A move needs the right to write both canvases. The page finds a
canvas's threads by the threads that name it, among those it may read.

*What is yours starts with you.* A draft, a canvas not yet shared, a
thread no one has sent in, and an image you pasted are yours, in your
own documents and your browser's store. Sharing adds readers. A pasted
image is kept by its hash in the browser's store until it is uploaded;
an upload is idempotent.

*A page keeps a store and reconnects.* It writes whatever it may with no
one connected, and its writes reach the others when it is.

*What an authority acts on is an intent log.* A merge after a partition
reaches a subscriber as its net change: a write added and removed, or
overwritten, while partitioned is gone from it (S291). A list that is
only ever appended to loses nothing, so whatever an authority must act on
is a record appended to a log, never edited or deleted in place, in one
batch with the state it changes. Each record describes itself: its kind,
its author, a per-author sequence number, its parent (what the writer
had seen), and any value it replaces. An edit or a retraction is a new
record naming the one it changes. The changefeed is a trigger, and the
log is the source of truth: an authority keeps the ids of the intents it
has taken, reads the whole log on a restart or a load from its store, and
skips its own appends (`replay: false`). List order converges but is not
causal, so an authority orders by the records' own fields. A log is a
thread's history and is kept.

*An agent is tethered to one machine.* The machine holding a lane's
disk, harness and runs is its tether, named by principal in the lane's
record. The tether alone writes the agent's record: `canWrite` names it,
so every peer refuses anyone else's change, and the record is
append-only by construction. The agent reads only its record (S3, S19).
A thread's members write the thread's log: any of them can write any
record of it, the agent's words included. The tether judges each intent
it has not taken against its record, one at a time, and turns the valid
ones into entries. An edit made to a message after the tether took it
changes only the log, and the page says it was edited after the agent
read it. Moving a tether to another machine is a handover of its own,
still to be decided (ADR-0119).

*An intent's author is the peer that wrote it*, not the field that names
one: the tether checks the field against the writer of the record, a Yjs
item's `clientID` mapped to its seat and person, as the host does for a
card's text now (ADR-0037). Until intents are signed, which is later
work, this holds for honest peers only.

*A message written against an older tip is taken, framed by what its
writer had seen.* It is never a branch: a branch is an act of its own.
The tether compares the message's parent with its record:

- the parent is the tip: a message, as written;
- the parent is a message the tether has taken and not yet answered: it
  joins that turn, as written at the same time;
- an agent reply came after the parent: it is taken after the tip,
  framed as written before the writer saw that reply;
- the agent is replying: it waits as a queued card does now, and is
  framed as the last case when taken.

The record keeps the words as written and the case as a value, and one
function words the framing, for the model and for the page alike; the
writer's own view says the agent had replied before reading it. A fixed
line of the agent's rules says such a message may be out of date: the
agent says where it conflicts with what has happened since, or asks,
rather than follow it or set it aside. A late message can hold the most
important instruction, so it is not ranked lower.

*A request is an intent in the log of what it is about.* A `Line` is
addressed to one peer's seat (`line:<topic>:<from>→<to>`), so a tab must
know it while that peer is away (S290). What merges is written directly
and needs no one. What the tether must do is an intent in its thread's
log: a message at the tip is the job for the agent. What your repo must
do is an intent in the project's log. The authority the thing's record
names takes it, judges it against what holds when it is taken, and
answers in its own record.

**Consequences.**

- Typing, placing and starting things need no host. Only what the agent
  or your repo does waits for it.
- The host's special cases for its absence go: `HostLine.close`
  answering `failed` at once, `host-left` dropping pending moves, the
  host's `departureTimeout: 0`, and its deletion of every stored `Line`
  at start. So do its stacks of people's moves (ADR-0066).
- Card texts and roots stop going to every client.
- A seat lasts, so who wrote what is the same between visits, and seat
  records stop growing with each.
- The same policies hold on a relay, on a peer reached directly (WebRTC),
  and on another person's host, so federation needs no new rules for
  documents. It does need a principal that is proven, not just stated:
  until then, every rule here holds for honest peers only, as now.
- The winner of a concurrent move is whichever seat's `clientID` orders
  last: arbitrary, consistent, and the same between visits once seats
  last.
- ADR-0168 proposes shelving a lane's record naming its host. This
  decision needs that record, as the tether.
- Every message is stored twice: as written in the thread's log, and as
  the agent took it in its record. The page draws what the agent said
  from its record, so a forged edit of the agent's words shows as an
  edit, never as what it said.
- Before a plan, each of these is a spike: whether Kyneta announces a
  document to a peer added to its audience after it connected, and stops
  pushing to one removed; two peers syncing with no host; which intents
  must not be carried out late; the tether taking from a thread's log,
  and the page drawing the log and the record as one thread; finding the
  writer of a log's record by its `clientID` through Kyneta; and the
  store's growth once seats last.

**Alternatives rejected.**

- **Loro for placement.** Its tree and movable list keep a node in one
  place by construction, but cost ten times Yjs's size, wasm, and a
  10 MB ceiling, for a guarantee against cycles that shallow places do
  not need.
- **The host keeps every place, with drafts made local only while it is
  away.** It stops the empty box, but a draft stays in one tab, a reload
  loses it, and every other placement still waits for the host.
- **A `Line` as the durable outbox.** It works (S290), but a tab must
  know the host's seat while the host is away, and a host that came back
  with a new seat would leave every request unanswered.
- **The thread's messages in one shared CRDT that the agent reads as
  its context.** pi reads only what its own session wrote (S3, S19), and
  members could change what the agent said. The agent's record stays its
  tether's, and the log is what it judges.
- **Acting on the operations a merge delivers, alone.** A merge after a
  partition delivers its net change, and what was written and undone
  while partitioned is not in it (S291).
- **Comparing the shared state with the record.** It loses the same
  writes, and finds what changed only by scanning.
- **A message written against an older tip as a branch.** A branch is
  an act a person chooses. Refusing the message loses it.
- **A late message ranked below the others.** It can hold the
  instruction that matters most.
- **A thread's place as a reference in each canvas.** A move would be a
  copy and a delete, and a stale copy would keep the thread readable by
  a canvas it has left.
