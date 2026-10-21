# ADR-0202 — Each document has an owner, an audience, and one authority only where a rule must hold; a page keeps a store and needs no host to write; an agent is tethered to one machine, which alone writes its record

Numbered 0196 until 2026-10-20, when two files held that number.

- **Status:** Proposed
- **Area:** `docs/01-architecture.md`, `packages/protocol/TECHNICAL.md`,
  `packages/schema/TECHNICAL.md`, `packages/session/TECHNICAL.md`
- **Evidence:** S3, S19, S21, S28, S75, S264, S289, S290, S291, S292, S293,
  S294, S295, S296, S297, S299
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
    principal; that machine alone writes the agent's record. The session's
    records no longer keep one writer: the board and the places are their
    members', and the question it deferred, who writes them once hosts are
    many, is this ADR's table.

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
  so a write the rule refuses is taken in by no peer, relay or host,
  and goes no further than its writer.
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
It reads the membership records on every call and is registered once:
registering the same policy object again by name removes it, and the
gate falls open (S292). Its cost does not matter: 1,000 documents and 50
peers made 221,317 calls on connecting, 57 ms in all, and a write 50
(S292).

*A change of membership is told by pine·trie, not by Kyneta.* Kyneta
evaluates `canShare` only when it sends something, so a peer added to a
document's audience while connected is not sent it, and one removed stops
receiving changes but keeps its copy and is told nothing (S292; the first
is reported to Kyneta's authors as a bug). So:

- **An added member asks again.** Its page, reading the membership
  record, suspends and resumes its copy of each document it may now
  read, which asks the host for it. The host does not suspend and resume
  a document to re-announce it: every other peer would get a `dismiss`,
  which pine·trie's client reads as a spent card (`hostLetGo`).
- **A removed member is told by pine·trie**, and its page stops offering
  writes there: Kyneta drops its later writes without a `refuse`, so as
  not to reveal that the document exists. Removal stops what a member
  gets from then on, not what it already holds.
- **A refused request reveals nothing**: it is answered `vacant`, as for
  an id that does not exist (S292).

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
one connected, and its writes reach the others when it is. *A seat lasts
on a secure origin, and is new on each load elsewhere.* The store holds
a seat with Web Locks, which only a secure context has. On `localhost` a
device's seats stay at the most tabs it had open at once, and a crashed
tab gives its seat back; on a plain `http://` LAN address every page
load is a new seat (S297). pine·trie's invite links are such addresses
today (`planInvites`, `apps/pinetrie/host/admission.ts`). A page there
works as it does now, with less held between loads; nothing waits on
HTTPS. No mesh gives a browser with nothing installed HTTPS it trusts
(S299). A member who runs pine·trie on their own device gets lasting
seats without a certificate: their device forwards to the host over the
mesh, and the page at `localhost` is a secure context with Web Locks
(S299). Trusted HTTPS for a browser alone needs a domain of ours, or
Tailscale's own service.

*What an authority acts on is an intent log.* A merge after a partition
reaches a subscriber as its net change: a write added and removed, or
overwritten, while partitioned is gone from it (S291). A list that is
only ever appended to loses nothing, so whatever an authority must act on
is a record appended to a log, never edited or deleted in place, in one
batch with the state it changes. Each record describes itself: its kind,
its author, a per-author sequence number, its parent (what the writer
had seen). An edit or a retraction is a new record naming the one it
changes; it does not carry the text it replaces, which is already in the
log or in the agent's record. The changefeed is a trigger, and the
log is the source of truth: an authority keeps the ids of the intents it
has taken, reads the whole log on a restart or a load from its store, and
skips its own appends (`replay: false`). List order converges but is not
causal, so an authority orders by the records' own fields. A log is a
thread's history and is kept. It costs about 161 bytes an intent beyond
its text: 10,000 messages and 1,000 edits made 5.4 MB, which loaded in
about 110 ms in Node, beside 7.0 MB for the same messages in the agent's
record (S297). A log is kept whole. Trimming one, by starting a new log
from a snapshot of the old, is taken up only if logs come near ten times
that.

*An agent is tethered to one machine.* The machine holding a lane's
disk, harness and runs is its tether, named by principal in the lane's
record. The tether alone writes the agent's record: `canWrite` names it,
so every peer refuses anyone else's change, and the record is
append-only by construction. The agent reads only its record (S3, S19).
A thread's members write the thread's log: any of them can write any
record of it, the agent's words included. The tether judges each intent
it has not taken against its record, one at a time, and turns the valid
ones into entries, through `@pinetrie/pi` as it is (S295):

- **pi reads them as its context, in order.** Chats taken where there is
  no lane go in through the scribe's append to the tree; with a lane, a
  turn's messages but its last go in with an append, and the last with
  a run.
- **The record is the cursor.** An intent's id is its message's send id
  in pi's tree, so the tree is both the agent's record and the list of
  what was taken: a tether stopped and started again from its store took
  each intent exactly once, and an edit never.
- **Takes are ordered by the intents' ids**, minted by the page as
  uuidv7, never by the log's order: Yjs gave back two messages written at
  once with the later first (S295).
- **The framing is what the model reads, not the words kept.** It goes in
  the message's content, and its details keep the words as written.

An edit made to a message after the tether took it changes only the log.
The page draws the thread as one pure projection of the record and the
log (S295): the record's path as a column draws it now, each message's
latest text from the log, marked edited after the agent read it, its
framing worked out again from the record's order, so the case needs no
storing, and every message not yet taken as pending, as a queued card
shows now. What the agent said comes from its record only: a forged edit
of a reply changed nothing drawn. A turn takes what is ready when it
starts and waits for nothing: messages written at once are framed as
such, and whoever wants several taken together holds the queue.

*An intent's author is the peer that wrote it*, not the field that names
one: the tether checks the field against the writer of the record, a Yjs
item's `clientID` mapped to its seat and person, as the host does for a
card's text now (ADR-0037). What that takes, and where it holds (S296):

- **The writer is read through `unwrap`**: a Yjs item's `id.client` is
  the `clientID` that inserted it. Kyneta has no API for who wrote what.
- **A `clientID` leads back to a person only through a table of seats.**
  `yjsClientId` hashes a seat's id one way, so the reader needs the
  seats it has seen connect, kept after they leave, as the host's seat
  records are. With seats that last (S290), the mapping is the same
  between visits.
- **So the check holds only where the reader saw the writer connect.** A
  write made while partitioned is named, since a writer's records travel
  over its own connection. A write relayed by another peer is named only
  by that peer, and is only as trustworthy as it is. Today every writer
  connects to the host, so every write is named.
- **It guards against bugs, not adversaries.** Any peer can write under
  another seat's `clientID` through the native document. Its record is
  then credited to that seat, and two records written at once under one
  `clientID` leave the copies diverged for good.

So intents are signed before peers relay one another's writes. Signing
removes the table of seats and makes a forged `clientID` harmless. It is
later work, and until then this holds for honest peers only. A mesh
proves who is at the other end of a link (S299), but not who wrote each
operation sent over it, so it does not replace signing.

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

*An intent names what it saw of its target, and its authority refuses
it when that has changed*, naming who changed it: a version, a value or
an id. One rule for every kind, so an intent taken late does what was
meant or is refused with words, and none needs its authority connected
(S294). Most commands carry it already (a move's `from`, a send's
`seen`, an accept's). Those that do not yet: a stop and a carry-on (the
run or ask the sender saw), a queue's hold and unqueue-all (the hold
and the cards seen), the proposed actions other than accept, setup,
publish and resolve (the state of your repo seen), a lane's ssh access
(the owner's answer seen: an allow made before a deny elsewhere must not
grant it again), and a command set on a card.

- **A late send is carried out with words**, the only kind that is: the
  framing of a message written against an older tip.
- **A time is used to order, never to judge.** A version the host stamps
  at the take would make a late one the newest over versions made after
  it, so a version carries when it was made.
- **An intent that uses a blob waits for it**, as a send waits for its
  card's text (S96).
- **An intent the authority mints an id for is taken once by the
  intent's own id.**
- **What merges is no longer a request**: moves, reorders, a card's
  width and tick, and likely titles and the workflow's names, where
  lateness is a merge (S289). What stays one is the agent's runs (send,
  stop, carry-on, queueing and its hold, a card's command), a lane's
  access, and your repo (proposed changes, setup, publish, restore,
  resolve).

**Consequences.**

- Typing, placing and starting things need no host. Only what the agent
  or your repo does waits for it.
- The host's special cases for its absence go: `HostLine.close`
  answering `failed` at once, `host-left` dropping pending moves, the
  host's `departureTimeout: 0`, and its deletion of every stored `Line`
  at start. So do its stacks of people's moves (ADR-0066).
- Card texts and roots stop going to every client.
- A seat lasts, so who wrote what is the same between visits, and seat
  records stop growing with each. A seat record is about 114 bytes.
- **Nothing tells the host that a seat will not return** (S297): Kyneta's
  departure is not "gone for good", and what ends a seat (site data
  cleared, a profile deleted) never reaches the host. So anything kept
  per seat is swept by the time since it was last seen, and a sweep is
  safe for a seat that comes back.
- **Requests as intents remove the per-seat growth of `Line`s.** A seat
  that opens a `Line` and leaves keeps two documents, about 2.4 kB with
  one request and 1.3 kB more for each, until a compaction brings them to
  about 390 bytes (S297). Any `Line` that stays is compacted and swept.
- **A document that merges holds the same policies on every link**: a
  relay, a peer reached directly, another person's host. Two of your
  devices sync your own documents with no host, both ways, across
  restarts, and refuse what the host refuses; Bea is never sent them;
  over WebRTC as over WebSocket (S293).
- **A document with one writer travels only on links to its writer**, or
  to a peer the policy names as one of its writers. Kyneta judges an
  offer by the peer that sent it, not by who wrote its operations, so a
  peer that is not a writer refuses another's relay of it (S293). That
  covers the places today and the agent's record. So every reader of an
  agent's record links to its tether, or to the host that holds the
  record, which the policy names a writer of it. While the tether is the
  host, as now, this changes nothing.
- **Carrying the agent's record across members' peers needs signed
  operations**, judged by their author rather than their sender. Kyneta's
  `canWrite` sees only the sender. Signing intents and records is later
  work; until then the record goes only where its writer is linked.
- Federation needs a principal that is proven, not just stated: until
  then, every rule here holds for honest peers only, as now.
- WebRTC needs a signalling path for every pairing, a reload's included:
  the data channel does not survive one (S293).
- The winner of a concurrent move is whichever seat's `clientID` orders
  last: arbitrary, consistent, and the same between visits once seats
  last.
- ADR-0168 shelves relocation but for a lane's record naming its host,
  which this decision takes up as the tether.
- Every message is stored twice: as written in the thread's log, and as
  the agent took it in its record. The page draws what the agent said
  from its record, so a forged edit of the agent's words shows as an
  edit, never as what it said.
- **The shared directories** (`.plans`, `sandbox`, `media`) stay one
  machine's mounts (ADR-0035): the tether's machine's. Files do not
  become CRDTs.
- **The budget of asks between agents** (ADR-0128) is the asked thread's
  tether's: it takes an ask as an intent in its log, and the budget is
  its own state.
- **Whose ssh a lane may use** (ADR-0140) follows its tether's owner.
- **How a tether moves**, built when relocation is: the lane's record
  holds the tether and an epoch; a move is an intent in the thread's log,
  taken by the old tether only between runs; it writes its last record,
  then the next epoch and the new tether. A tether gone for good is taken
  over by a member with the right, as a branch: whatever the old tether
  never synced is not taken.

**Directions, not decided here.**

- **A mesh between the peers that run pine·trie** (hosts, tethers, a
  person's devices), with Kyneta's WebSocket transport over it. Measured
  with Headscale and Tailscale clients, and checked against Nebula
  (S299):
  - Kyneta syncs over it as over loopback, and every member dials the
    tether directly, which lifts S293's limit on documents with one
    writer for members on the mesh.
  - The receiving end learns who connected (`tailscale whois` on the
    source address, or Nebula's certificate), and with an email as a
    Headscale user that is a pine·trie principal as it is. A spoofed
    source address is dropped. But Kyneta's `canConnect` sees only the
    stated principal: refusing a peer that claims another's needs the
    connection's mesh identity bound to its stated principal, which the
    probe did by hand. Kyneta's authors are to be asked to pass a
    transport's verified identity to `canConnect`.
  - The identity is a device's, shared by every tab and process on it.
  - Joining asks more than an invite link: an admin's key, or an admin's
    approval. So browser-only collaborators keep the invite link, and the
    mesh is for peers that run pine·trie. Whoever runs the coordination
    server can register a node as any user.
  - With the coordination server down, running links keep working; a new
    node cannot join until it is back. It runs over HTTPS.
- **Three ways things travel**: what is addressed by its content (blobs,
  git objects, derived outputs) from any holder, checked by its hash;
  what merges, over any link; what has one writer, on links to it. Only
  names and pointers need an authority.
- **A cache of derived outputs** keyed by ADR-0135's recipe key with the
  image and CPU type, so a forked or moved lane fetches what a peer
  already made, or makes it again. Local files never travel.
- **Capacity as each machine's own record** (CPU type and OS, GPU,
  models, the states it holds, free lane slots), where a tether goes as a
  pure plan over those records, chosen by one authority.
- **The model call apart from the tether**: the tether stays with the
  disk, and the call can go to a peer offering a model.
- **A lane's surfaces** (http, tty, display, artifacts) in its tether's
  record, granted to members.
- **A hub is a member that never sleeps**: it stores and relays what
  merges for members who are away.

**Alternatives rejected.**

- **Loro for placement.** Its tree and movable list keep a node in one
  place by construction, but cost ten times Yjs's size, wasm, and a
  10 MB ceiling, for a guarantee against cycles that shallow places do
  not need.
- **Naming every relay a writer of a document with one writer**, so it
  crosses members' peers. A relay could then forge the agent's record,
  and every peer would take the forgery.
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
