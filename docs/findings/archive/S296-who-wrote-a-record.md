# S296 — can a peer find who wrote a record of a log from the record's Yjs `clientID`, through Kyneta?

- **Status:** Answered

For ADR-0202, under which an intent's author is the peer that wrote it,
not the field that names one, until intents are signed. Today the host
maps the `clientID`s that an edit moved to the seats connected when it
arrives (ADR-0037), and a card's writers are read by unwrapping Yjs
(`CardPort.writers`, `apps/pinetrie/host/cards.ts`).

**Question.**

1. For a record appended to a Yjs list or set under a key of a record,
   through Kyneta: can the receiving peer read the `clientID` of the
   item that holds it, from `unwrap`, or from anything Kyneta exposes?
2. Kyneta derives a seat's `clientID` with `yjsClientId(peerId)`. Can a
   peer map a `clientID` back to a seat and its principal for a writer
   that is not connected now: one that wrote while partitioned, or whose
   write arrived through a relay or another peer? What record would it
   need (today's `pinetrie.seat` records, ADR-0048)?
3. A peer writes a record whose `author` field names someone else: is
   the mismatch found, every time?
4. With seats that last (S290), is the mapping stable between visits?

**Kill criterion.** An intent's author cannot be the peer that wrote it
if a receiving peer cannot find the writer's seat for a record that
arrived while the writer was not connected to it.

**Throw away.** The probe, in Node, through Kyneta `Exchange`s over
WebSocket, as S289's was.

**Answers.**

1. **Yes, from `unwrap`; Kyneta exposes nothing else.** Unwrapping a
   `Schema.list` gives its `Y.Array`. Walking its items gives each
   record's item, and `item.id.client` is the `clientID` that inserted
   it. Yjs keeps a run of one client's inserts as one item, so every
   value in an item's content takes that item's `clientID`. For a record
   Ada appended while connected, the hub read `yjsClientId(Ada's seat)`
   (case 1). Kyneta's source has no read of who wrote an operation.
   Its `canWrite` judges the peer that *sent* an offer, not the one who
   authored it, so a relayed record is judged as the relaying peer's.
2. **Only for a writer whose seat the reader saw connect, or that
   someone it trusts recorded.** `yjsClientId` is the low 53 bits of a
   hash of the seat's id (`peerNumber` in `@kyneta/schema`'s `hash.ts`).
   It can't be reversed, so a reader maps a `clientID` back to a seat only
   through a table of seats it knows: the host's `pinetrie.seat` records,
   kept after a seat leaves (`apps/pinetrie/host/seats.ts`). With such a
   table, kept in memory by the probe:
   - **Partitioned (case 2):** Bea's record reached the hub only when
     she rejoined. Her own write can only arrive by her own connection
     or through another peer. The hub had her seat from when she was
     connected, and named her after she had gone.
   - **Relayed (case 3):** Cal reached only Ada, and his record reached
     the hub through her. The hub had never seen his seat, so it read his
     `clientID` and could name **nobody**. Ada, who saw him connect, named
     him. **For this case the kill criterion is met:** a peer cannot find
     the writer of a record that reached it through another peer, unless
     that peer records the writer's seat for it. Such a record is the
     relaying peer's word about who connected to it.
3. **A forged author field is found every time the writer's seat is
   known** (case 4). Cal wrote a record naming Ada. Ada, who knew his
   seat, read Cal's `clientID` and a field saying `ada`: a mismatch. The
   hub read a `clientID` it could not name, so it couldn't say who wrote
   the record, only that it couldn't be checked. **A forged `clientID` is
   not found by anyone but its victim** (cases 5, 5b). Through the native
   document, a peer can write under another seat's `clientID`:
   - **Cal, while Ada also wrote (case 5):** two different records took
     one Yjs id, so each side kept its own. Cal's record never reached
     anyone, Ada's never reached Cal, and the copies stayed apart.
   - **Dan, with no write of Ada's at the same time (case 5b):** the hub
     named Ada as the writer of Dan's record, `matches: true`. Ada's own
     Yjs saw its `clientID` used by someone else and changed it to a
     random one. Her next record reached the hub under a `clientID` no
     seat has, so it was attributed to nobody.
4. **Stable between visits by construction, not when forged.** A seat's
   `clientID` is a function of its id alone, and S290 measured a seat
   lasting across reloads, so a writer's `clientID` is the same between
   visits. Yjs changes a document's `clientID` when it finds another peer
   using it (5b, and Kyneta's own note in `bind-yjs.ts`). After that, the
   writer's records map to no seat.

Two runs, alike but for the seats' ids (`output.txt`, `output-2.txt`).

**Consequences.**

- **An intent's author can be its writer only where the reader saw the
  writer connect.** In today's shape, where every writer connects to
  the host, the host can attribute every record by its seat records. Once
  writes are relayed (a peer to a peer, a host to another host), the
  receiver needs the relaying peer's record of who connected to it, and
  trusts that peer for it.
- **Checking against the `clientID` catches a wrong author field and
  nothing deliberate.** Anyone who can write the document can write under
  another seat's `clientID`. The only peer that notices is the one
  impersonated, and its later writes then go unattributed. So "until
  intents are signed, this holds for honest peers only" is exact, and the
  check guards against a bug, not an adversary.
- **Signed intents remove the seat table.** A signature names its author
  wherever the record travels, relayed or not. That is the later work
  ADR-0202 names, and it would also make a forged `clientID` harmless to
  attribution.
- **A reader never loses a writer for being partitioned.** A writer's own
  records reach a peer only through a connection, so the writer's seat
  is either connected then or was recorded by the peer that relayed it.
- Not measured: the host's own seat records across a restart (they are
  stored records in the session document today), Loro, and seats from a
  browser store.

**Method.** `probe.ts` in this spike's folder, run as
`apps/pinetrie/e2e/s296-probe.ts` with `node` in a Linux lane, Kyneta 4.0.0
and no pine·trie code. A hub `Exchange`, as the host, with an in-memory
store and a `WebsocketServerTransport`. Ada was connected to the hub and
served a WebSocket of her own, which Cal alone connected to. Bea and Dan
were connected to the hub. The log was a Yjs `Schema.list` of
`{ id, author, text }` records. Each of the hub and Ada kept a table of
every seat seen connected (`yjsClientId(peerId)` to its principal, kept
after the seat left), as `pinetrie.seat` records are. A partition was
Bea's transport removed and a new one added. A forged `clientID` was the
writer's `Y.Doc.clientID` set to `yjsClientId(Ada's seat)` for one write,
then put back. At Ada, her own `clientID` maps to "(self)", so case 5b's
`matches: false` there is that label, not a mismatch.
