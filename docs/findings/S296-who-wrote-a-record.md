# S296 — can a peer find who wrote a record of a log from the record's Yjs `clientID`, through Kyneta?

- **Status:** Open

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
