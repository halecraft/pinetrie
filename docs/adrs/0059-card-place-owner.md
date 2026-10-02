# ADR-0059 — A card's place has one owner at a time, and moves between owners are handoffs

**Status:** Accepted (Duane, 2026-10-02). Evidence: S75, S76. Amends ADR-0048 (storage: places
are no longer written by clients into a CRDT, and the inventory is a
document of its own, of slots), ADR-0052 (how a move is undone), ADR-0023
(the host writes places again) and ADR-0055 (where a card's command
lives). For ADR-0048's step 4, and it changes how step 3's queue and
unqueue are written. Amended in place (2026-10-02, with Duane): a tab
knows its copy holds its move by a revision watermark, not by the reply
alone (*A move is drawn at once*); a card's command is in the host's place
record, set by a request, not in the card's own document. Implemented by
`PLAN-2026-10-02-card-places`, for the places there are now (drafting,
queued, fresh); the inventory is step 4's.

**Context.**

ADR-0048 has clients write cards directly: each card's record, place
included, in one Yjs document per session (`CardsDoc`,
`packages/schema/card.ts`), and its text in a Yjs document of its own. The
reason was undo: Kyneta's undo covers only a client's own writes (S58), and
the host's writes would have been out of its reach.

A card is in exactly one place. Two people moving one card at once is a
conflict that no merge resolves: one of them has to win. S75 measured what
the CRDT does with that:
- **The place came apart.** A record's fields are merged one by one, so a
  take and a queue at once left an inventory card carrying the queue's
  `order` and `by`, in 99 of 100 races.
- **The winner was arbitrary.** Writing every field kept a place whole, but
  the winner was whichever client's `clientID` orders last: Ada beat Bea
  100 times of 100, and always would.
- **The loser was not told.** Their move just disappeared, so each client
  has to infer that it lost: "already sent" from the host letting go of a
  document (S69), and the same again for a lost take.
- **Undo restored fields one by one**, leaving another place's field on a
  card, and reported `true` while changing nothing.

Every client already talks only to the host, so every move passes through
one point, in an order. The CRDT pays for a merge and then throws that
order away.

Two things do merge, and should stay CRDTs: a card's text, which people type
in together, and your inventory's layout, which only your own devices
arrange and which should work offline. Later Pineta may want offline moves,
peers talking directly, and several hosts (one per project). Whatever is
chosen now should not have to be undone for those.

**Decision.**

*Two kinds of data.* Whether a rule survives any merge of concurrent
changes decides how its data is kept:

| data | merges? | kept as |
|---|---|---|
| a card's text | yes: everyone's typing kept | its own Yjs document, `card:<id>`, as now |
| your inventory's layout | yes, but two of your tabs can fill one slot | a Yjs document of yours, plus the repair rule (below) |
| a card's place | no: a card is in one place | an owner who decides |

*One owner at a time.* Each card's place has one owner: a session's host, or
a person's inventory.
- **The host owns every place in its session**: a thread's end (drafting),
  the queue (with its order and who queued), a fresh column, later pinned
  cards and a board, and *whose inventory* a card is in. It writes them in
  a `places` document (`json`) that only it writes. Each record also holds
  the card's owner and why the host could not send it (`unsent`).
- **Your inventory owns which slot holds which of your cards.** It does not
  decide whether a card is yours: the host's "in A's inventory" does.
- **A client never writes `places`.** The host refuses such a write, but
  the writer keeps its own value for good (S28, S76), and two tabs then undo
  each other's repairs forever. The client's code holds no writable
  reference to it.

*Handoffs.* A move from one place to another, within the host's places or
between the host and an inventory, is a request to the host naming the
card, the place the sender saw it in, and the place it should go.
- **The host compares and sets in one synchronous step**, in the order
  requests arrive (S76: the first sent won, whoever sent it). It refuses
  when the card is no longer where the sender saw it, when the inventory
  named is not the sender's, or when that inventory is full: it counts your
  cards, and refuses the nineteenth, without knowing your slots.
- **Every refusal is a reply, and says where the card is now.** The loser
  is told at once: "Bea took this", "already sent", "inventory full". No
  client infers it.
- **Queue and unqueue are handoffs.** The host's take of the top queued
  card and an unqueue are put in order by the host's own queue: once the
  take is written it wins, and a later unqueue is refused with "already
  sent". An unqueue the host saw first is respected (S69's rule, now
  decided where it happens).
- **A queue names the text it queues.** The request, like the text, can
  reach the host first, since Kyneta keeps no order between a Line and a
  document (S72). A queued key carries the text's version as its queuer had
  it (`seen`), and so does a chat whose busy lane queues its card; the
  host takes the card only once its copy of the text holds that much.
- **A move is drawn at once.** The tab draws its waiting handoffs over the
  host's places until its own copy of them holds the move. A refused one
  is dropped at the reply, and the card is drawn where the host says it
  is, with the reason. A round trip took about 3 ms on localhost (S76).
- **A revision watermark says when the copy holds the move.** The places
  document carries `rev`, a counter the host increments in the same write
  as every change to a place. Every reply to a handoff carries the `rev`
  after its write. The tab keeps drawing an accepted move until its copy's
  `rev` reaches that number, then drops it. It is the "read your writes"
  token a database gives its clients.
  - **Not at the reply.** The reply travels on the Line, and the places
    document's change travels apart from it: either can reach the tab
    first. Dropped at the reply, the card would jump back for a moment,
    and a card just created would vanish from under its editor.
  - **Not when the card looks moved.** Another move can overtake an
    accepted one before the copy catches up: the host takes the queued
    card, or someone moves it back. The copy then never shows the move,
    and a tab waiting to see it would wait forever.
  - **A copy at that `rev` holds the move and everything the host did
    before it**, whatever happened to the card since. So the order of
    arrival stops mattering, and no case is special: one comparison.
  - **Only one piece of the host writes places**, and it increments `rev`
    with each write. A write that skipped it would leave a tab drawing a
    move over a record that has already changed.

*Your inventory.* `inventory:<person>`, one per person in each session (the
page ADR-0048 gives each session), is a Yjs document of slot to card id.
- **Only that person's tabs hold and write it.** The host stores it, shares
  it only with peers whose principal is that person, and accepts writes
  only from them. That keeps it from honest clients only: a principal is
  what a peer says it is (ADR-0037), and ADR-0048 already says the
  inventory is no security claim.
- **Moves inside it are your tabs' writes**: a swap, filling a slot. They
  need no host and work offline.
- **The repair rule.** Membership is the host's, arrangement is yours. Each
  tab derives its view, and writes only what differs:
  - a card the host says is yours, which no slot holds, goes in the first
    empty slot, cards in id order;
  - a slot naming a card that is not yours is cleared;
  - a card in two slots keeps the lower one.

  So a crash between the host's acceptance and the slot's write loses
  nothing, and two tabs filling one slot both end up shown. It converged in
  at most three writes in every case S76 tried.

*A card's own document* holds its text. Its command (ADR-0055) is in the
host's place record, set by a request: the take reads a card's command in
the step that reads its place, and a command written into the card's
document would travel apart from a queue request on the Line, so the card
could be taken before it arrived and sent as a plain message. Requests on
one Line keep their order, so "set the command, then queue" holds. A tab
opens only the cards it shows: its columns' cards and your inventory. A
card's document costs about 17 KB in an Exchange, so a session's every
card is too many to hold (S76).

*Creating a card* is a handoff from nowhere: the client makes the card's
document, and asks the host to place it. The host records the sender as its
owner. Undoing a creation empties the text: an empty card is neither shown
nor marked, and the host sweeps it.

*Undo* (amends ADR-0052).
- **Text: unchanged.** Each card's box undoes its own text's steps, through
  the tab's Kyneta stack.
- **Your inventory's own moves**: Kyneta's undo on your inventory document.
- **A handoff is undone by the reverse handoff**, which the host refuses if
  the card has moved since. A take or a put also undoes its inventory half.
  Your undo leaves someone else's later move alone, as ADR-0048 asks, and a
  refusal says why ("Bea has queued it since") instead of doing nothing.
- **The tab keeps its handoffs in a list in memory**, as its Kyneta stack
  is. Each names its card and both places, which is what "undoing a move
  first shows where it acts" (ADR-0052) needs.

*Later, and not in this decision's scope.* The shape leaves room for:
- **Offline handoffs**: a request waits until the host is back, drawn as
  waiting; a refusal puts the card back. A browser has no store yet
  (ADR-0037), so a waiting request does not outlast a reload until it does.
- **Peers talking directly**: the CRDTs (texts, inventories) can sync peer
  to peer. Places are still written only by their host.
- **Several hosts**: a card crosses sessions through your inventory. The
  first host hands its place to your inventory, which hands it to the
  second. The text is a CRDT, so it can live on both. Two of your devices,
  both offline, handing one card to two hosts is the one case no owner can
  refuse; the later placement would become a copy, as taking from the past
  copies.

**Consequences.**
- The cards document goes. A card's record (place, owner, placer, command,
  `unsent`) is in the host's `places`; its text stays in its own document.
- The host gains commands for cards: handoffs, creation. ADR-0048's "the
  host acts only at the boundary with pi" and its smaller host no longer
  hold. In return, the policy's invariants become the host's own checks.
- Step 3's queue and unqueue are rewritten as handoffs. The client's "already
  sent" inference (`alreadySent`, `unqueued`) goes, since the refusal says
  so. A spent card's document is still destroyed by each client when the
  host lets go of it (S64).
- Each move waits for a round trip to be final, though it is drawn at once.
- The places document carries one more number, `rev`, written with every
  change. Should Kyneta expose the version of a document one peer writes,
  or hold a Line message back until the documents it depends on catch up,
  `rev` can give way to it.
- A conflict is settled by arrival, not by `clientID`, and its loser is told.
- Kyneta's undo covers texts and inventories. A handoff's undo is Pineta's
  own, which is sound because a place is one value and the reverse is
  refused when that value changed.
- Kyneta's `destroy` keeps every destroyed document in memory, and nothing
  unloads a document while keeping it stored (S76). Both are asked of
  Kyneta; until then a tab's and the host's memory grow with the cards they
  have opened.
- Stored cards are not carried over: no code reads the old cards document,
  and the startup sweep removes the texts no record names. The only stored
  session held two drafts, kept by hand.

**Alternatives rejected.**
- **Places in the cards document, written by clients** (ADR-0048, S75). A
  place does not merge: its fields came apart, the winner was fixed by
  `clientID`, and the loser was not told.
- **One value per card for its place, still in a CRDT.** It keeps a place
  whole, but the winner is still whoever's `clientID` orders last, the
  loser still learns nothing, and a move of a shared card made offline
  cannot be sensibly merged anyway.
- **A document per person holding the card records**, moved out of the
  shared document on a take (S75). Two people taking one card at once put
  it in both inventories, 40 of 40.
- **An inventory written by the host on your requests.** One writer, but
  rearranging your own slots would need the host, and nothing would work
  offline. Your layout is contested only by your own tabs, which the
  repair rule settles.
- **The host recording slots too.** Every rearrangement a round trip, and
  the layout sent to the host for no decision it makes.
- **Dropping a waiting move at the reply, or when the records show it.**
  The first flickers and can take a new card from its editor, since the
  reply can arrive before the change. The second compares values, so a
  move overtaken before the copy catches up is never seen, and waits
  forever. The watermark asks the question that matters: has the copy
  reached the host as it stood just after the move.
- **A transaction across owners.** Only a card's current owner can hand it
  on, so one owner's write at a time is enough; no commit spanning two
  parties is needed.
- **A movable tree (Loro).** It merges moves too, so it settles a card's
  place by the same arbitrary rule.
