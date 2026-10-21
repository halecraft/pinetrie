# S292 — does Kyneta share a document with a peer added to its audience after it connected, and stop when one is removed?

- **Status:** Open

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
