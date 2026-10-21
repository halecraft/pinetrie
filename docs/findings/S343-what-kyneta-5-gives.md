# S343 — what Kyneta 5.0.0 gives ADR-0202: policy changes reach connected peers, and intents get an unrecorded log

Numbered S307 until 2026-10-25, when two files held that number.

- **Status:** Answered
- **Led to:** ADR-0202

Asked by Duane, after Kyneta 5.0.0 was released, for ADR-0202's open
needs. Its spikes found, against 4.0.0: a reader added while connected is
not sent the document, and one removed is told nothing (S292); an
intent log must be append-only and survive a merge (S291); the author of
an intent can be read only through `unwrap` (S296); a peer's principal is
stated, not proven (S299).

**Question.**

1. What changed between 4.0.0 and 5.0.0 in `@kyneta/exchange`,
   `@kyneta/schema`, `@kyneta/yjs-schema`, `@kyneta/transport` and
   `@kyneta/websocket-transport`, for those needs?
2. Does a membership change now reach peers already connected, both
   ways?
3. Is S292's trap, the same policy object registered again by name, still
   there?
4. Does an intent appended in a gesture survive that gesture's undo?
5. What would pine·trie's upgrade touch?

**Kill criterion.** None: the answer is what 5.0.0 does, read from its
source and measured.

**Throw away.** `probe.ts` in this spike's folder: a hub and three
members as `Exchange`s over WebSocket in one Node process, with 5.0.0
installed outside the repo.

**Answers.**

1. **Read from the source** (the published packages' `src`, compared
   file by file with 4.0.0):
   - **A policy can report its own changes.** `Policy.subscribe(onChange)`
     is new. A registration, a disposal, or a reported change makes the
     exchange re-derive the verdicts of the gates that policy defines,
     and of no others (`gatesOf`, `scopeOf`, `reconcilePolicy` in
     `sync-program.ts`). The README's new "When a policy changes":
     `canShare` granted sends the documents a peer may now see; revoked
     sends `dismiss` and nothing more, and the peer keeps what it has;
     `canAccept` or `canWrite` loosened tells a refused writer it may write
     again (a new `admit` message), its lock lifts and its refused writes
     arrive; `canConnect` revoked disconnects the peer; a `resolve` change
     classifies deferred documents again.
   - **Unrecorded logs** in `@kyneta/schema`:
     `Schema.list.unrecorded(item)` and `Schema.record.unrecorded(value)`,
     root fields that undo never records. The README names an intent log
     as their use: written anywhere, in a gesture too, they are never
     reverted and never end or split an undo step. An undo stack's new
     `annotate` hook writes into them with each revert, through
     `draftOps(doc, fn, { only: "unrecorded" })`, which records the ops a
     mutation would write and refuses a write elsewhere.
   - **`holdChangesets(refs, fn)`** delivers several documents' changes
     after `fn` returns, so a subscriber never runs between two of its
     writes.
   - **Transports**: an `establishTimeout` (10 s by default) drops a
     channel whose handshake does not finish, a flush timeout bounds a
     drain, and the clients' reconnect is one shared lifecycle
     (`client-lifecycle.ts`). `handleConnection` may now return nothing,
     so its result is `?.start()`.
   - **Unchanged**: a principal is still "not verified"
     (`transport/src/types.ts`); there is still no API for who wrote an
     operation; `canWrite` still judges an offer's sender; `Line`
     documents to a seat that never returns still stay stored ("Nothing
     removes them yet").
2. **Yes, both ways, for a policy that subscribes.** The hub's
   `canShare` read a membership set and reported changes through
   `subscribe`. Bea, connected and not a member, was not sent the canvas.
   Added, she was sent it with no reconnect and no request, in one change
   that made 11 `canShare` calls. Removed, she was sent nothing more:
   her copy kept "Plan" while Ada's moved to "Plan v2", and her peer
   states for the document emptied, which is the host leaving it. She
   still held her copy. A member's page has to interpret what it is sent
   (a `resolve` that interprets the document, as `connectSession` gives
   for the kinds it knows); with Kyneta's default, an unknown document is
   deferred and the page holds nothing.
3. **Yes, still there.** The same membership object registered a second
   time by name, and Cal, no member, was sent the canvas: the gate fell
   open. `Governance.register` still removes the entry it has just made
   when the object is its own replacement.
4. **Yes.** In one gesture Ada appended `edit` to an unrecorded log and
   edited the title. Undo put the title back; the log held `edit`, and the
   `undo` the stack's `annotate` wrote with the revert.
5. **The upgrade touches little, read from pine·trie's source.** The
   host's `handleConnection` result is destructured
   (`apps/pinetrie/host/http.ts`), and must become `?.start()`.
   `CommitOptions`, which the session's undo type uses, is still
   exported. `@kyneta/react` is at 5.0.0 too. The webrtc transport is
   still 4.0.0.

The output is in `output.txt`.

**Consequences.**

- S292's first finding is fixed upstream, for a policy that reports its
  changes. pine·trie's audience policy subscribes to the membership
  records, and the page no longer has to ask again for each document it
  may now read.
- A removal now sends `dismiss`. pine·trie's client reads the host
  leaving a card's text while connected as the card being spent
  (`hostLetGo`, `packages/session/card-copies.ts`), and destroys its copy
  once the record is gone too. For a removed member that may be what is
  wanted, but it is a rule to state, not a side effect to inherit.
- An intent log is a `Schema.list.unrecorded`: undo of a gesture never
  takes an intent back, and an undo can record itself as an intent
  (`annotate`). That is what S291's rule ("never delete or edit intent
  records in place") needs when a gesture writes state and intent
  together.
- The policy is still registered once. Registering the same object again
  opens the gate.
- Still not in Kyneta: a proven principal (S299's binding of a mesh
  identity is by hand), an API for an operation's author (S296), and a
  sweep of `Line`s to seats gone for good (S297).
- Not measured: `holdChangesets`, the `admit` path for a refused writer,
  `canConnect` revoked, a store, and pine·trie on 5.0.0.

**Method.** Kyneta 5.0.0 and 4.0.0 were fetched with `npm pack` and their
`src` folders compared. The probe ran in Node 24 in a Linux lane, with
`@kyneta/exchange`, `@kyneta/schema`, `@kyneta/yjs-schema` and
`@kyneta/websocket-transport` 5.0.0, `yjs` 13.6.33 and `ws` installed
outside the repo: a hub with a `membership` policy (`canShare` over a set,
and `subscribe`), Ada and Bea, then Cal after the policy was registered a
second time, and Ada's undo stack with an `annotate` hook.
