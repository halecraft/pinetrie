# S292 — does Kyneta share a document with a peer added to its audience after it connected, and stop when one is removed?

- **Status:** Answered

For ADR-0202, which makes a document's audience one policy, read from its
id and the membership records, alike on every peer. A canvas gains and
loses members while they are connected, so the policy's answer for a
connected peer changes.

**Question.**

1. A peer is connected, and `canShare` refuses it a document. The
   membership record changes so `canShare` allows it. Is the document
   announced to it (`present`) without a reconnect? If not, what makes it
   so: a policy registered again by name, a call Kyneta offers, or the
   peer asking for it by id?
2. A peer is allowed and holds the document, then is removed. Does the
   host stop pushing it changes at once? Does the peer keep its copy, and
   does anything tell it?
3. A request by id from a refused peer: is the answer `vacant`, and is it
   the same as for an id that does not exist?
4. What `canShare` costs: the number of calls, and the time, with 1,000
   documents and 50 peers, when one membership record changes.

**Kill criterion.** One policy cannot be pine·trie's audience if a peer
added to a canvas cannot receive its documents without reconnecting, or
a removed one keeps receiving changes.

**Throw away.** The probe: a hub and peers as Kyneta `Exchange`s over
WebSocket in one Node process, no pine·trie code, as S289's probe was
(`docs/findings/S289-places-written-by-members/probe.ts`). Read
`@kyneta/exchange`'s `governance.ts` and `synchronizer.ts` for when
`canShare` is evaluated.

**Answers.**

1. **A peer added to the audience while it is connected is not told.**
   Kyneta evaluates `canShare` only when it sends something: a `present`
   when a peer connects (`handlePeerAvailable`) or a document is created
   (`handleDocEnsure`), a push to peers already synced on the document
   (`buildPush`), and the answer to a request (`sync-program.ts`). A
   policy change notifies only a document's network terms (its authority,
   its write refusal, `exchange.ts`), never the synchronizer, and no
   message re-evaluates sharing. Measured: Bea, refused, connected, was not
   announced the canvas. Added to its members, she was still not
   announced it, nor sent a hub write made after, nor anything when the
   policy was registered again by name. What did make her hold it:
   - **The hub suspending and resuming the document**: `resume` announces
     it again, filtered by `canShare` as it holds now, and Bea read it.
     Every other peer of the document is sent a `dismiss`, then `present`
     and `interest` again, and stays synced.
   - **The peer asking again**: Dan asked while refused and got `vacant`,
     with an empty copy. Added, a hub write still did not reach him. When
     he suspended and resumed his own copy, he asked again and read it.
   - **A reconnect the hub has seen**: Eve, added, reconnected after the
     hub had heard her channel close (`peer-disconnected`), was announced
     the canvas and read it. When her new channel arrived before the hub
     heard the old one close, the hub saw one peer with two channels: no
     `peer-reconnected`, no `present`, and she was not announced it.
2. **A removed peer stops getting changes at once, keeps its copy, and is
   told nothing.** Ada, a member and synced, was removed. A hub write after
   did not reach her, and she received no message at all: no `dismiss`,
   no `vacant`. Her copy kept everything she had, and her sync state still
   read `synced`. A write she made after was not taken by the hub (the
   policy's `canWrite`, judged against the offer's sender), and no
   `refuse` came back: `refuseReply` sends one only to a peer `canShare`
   allows, so as not to say the document exists. So she can go on writing
   into a copy that no one takes, and nothing on her side shows it.
3. **A refused request answers `vacant`, the same as for an id that does
   not exist.** Cy, refused, asked for the canvas and for `canvas:none`,
   which the hub does not hold: each got one `vacant`, and each copy's
   state read `vacant`. Nothing told the two apart.
4. **`canShare` is cheap, and a membership change costs nothing until
   something is sent.** With 1,000 documents and 50 peers, each a member
   of half of them: the 50 connecting made 221,317 calls (about 4,400 a
   peer: each `present` filters every document, and each document a peer
   then asks for is judged again on each message), and spent 57 ms inside
   the policy in all. A membership change made no calls. One hub write
   made 50, one per peer the document's sync state holds. A suspend and
   resume of one document made 270. The policy alone, a lookup in a set,
   took about 0.1 to 0.3 µs a call.
5. **Not asked, found: registering the same policy object again by name
   removes it.** `Governance.register` replaces a named policy in place,
   then runs the old one's removal; when the old one is the same object,
   that removal takes it out of the list, and with no policy left to
   refuse, `canShare` falls open (`reregister.ts`: `false`, then `true`).
   A new object of the same name stays in force. The first run of
   `probe.ts` hit this: after its second `register`, refused peers were
   sent everything.

**Consequences.**

- **The kill criterion is met as asked, and the fix is small.** One
  policy can still be the audience, but Kyneta does not act on a change
  of its answer: the code that changes membership must also make Kyneta
  send what the new answer allows. For an addition, the hub resumes the
  document after suspending it, or the added peer asks again. For a
  removal, sending stops by itself, but the removed peer must be told,
  because Kyneta says nothing.
- **A suspend and resume on the host reads as a spend in pine·trie's
  client today.** The `dismiss` it sends deletes the host's sync state for
  the document (`handleDismiss`), and `hostLetGo`
  (`packages/session/card-copies.ts`) takes the host leaving a document
  while connected as the card spent, and destroys the copy once its
  record is gone. A design that re-announces by suspend and resume needs
  another sign of a spend, such as the record's own, before it is used on
  card texts.
- **The added peer asking again is the cleaner path.** The membership
  record is itself a document the peer reads. A peer that sees itself
  added asks for the canvas's documents again (suspend and resume of its
  copy, or a fresh `get` of one it never asked for), and no other peer is
  disturbed.
- **A removed peer needs pine·trie to tell it.** It reads the membership
  record too, or the host writes it a notice; its page then stops
  offering writes there, and says why. Its copy stays on its device:
  removal stops what it gets from now on, not what it has.
- **Membership must never be re-registered as the same policy object.**
  The audience policy reads the membership records each time it is asked,
  so it never needs registering again.
- **A reconnect re-announces only when the host has seen the peer leave.**
  A page relying on its reconnect to learn of a new audience can miss it.
- Not measured: a peer added through a relay, and a store on the hub.

**Method.** `probe.ts` in this spike's folder, run as
`apps/pinetrie/e2e/s292-probe.ts` with `node` in a Linux lane (Node 24,
Kyneta 4.0.0). It used no pine·trie code. A hub `Exchange` with an
in-memory store and `authority: "self"`, behind a `ws` server, registered
one policy whose `canShare` and `canWrite` read a map of document to
members by principal, and counted and timed its own `canShare` calls.
Peers were `Exchange`s with `WebsocketClientTransport`. What each peer
received was read from `exchange.observe` (layer `protocol`, messages
in), and what the hub sent from its own. A reconnect was a client's
transport removed and a new one added. `reregister.ts` drives Kyneta's
`Governance` directly. `output.txt` and `reregister-output.txt` hold the
output.
