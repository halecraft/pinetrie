# S58 — can clients write cards, and can the host spend them?

**Answers.**
1. **Yes: clients can write the cards document on Yjs.** Two clients creating
   cards at once under unique keys both keep theirs, on every replica
   (ADR-0016). A host deleting a card while a client writes one of its fields:
   **the delete wins everywhere**. A host deleting a card while a client sets
   the whole record again: **the set wins**, and the spent card comes back.
   So after a card is created, clients write its fields, never the whole
   record.
2. **The host must `resolve` documents that clients create.** With no
   `resolve` (or `schemas`) for `cards` and `card:`, a document the host never
   opened itself is neither stored nor relayed: a second client reads it
   empty. With `resolve` returning `Interpret(TextDoc)`, it is stored and
   relayed.
3. **A spent card can be destroyed while its owner still types.**
   `exchange.destroy("card:x")` removes it from the host's store, and the
   owner's later typing, into the replica they still hold, is not stored
   again, including across a restart. Nothing has to be refused, so S28's
   hazard never arises.
4. **Kyneta's undo is right across people, but a spent card still takes a
   Cmd+Z.** Ada's undo removed her own typing and left Bea's text inside it;
   undoing the creation step deleted Ada's record and left Bea's text; redo
   restored both. After the host spent the card, Ada's undo still reported
   `true` and changed only her dead replica: the host did not store it, and
   nothing on screen shows it. One keypress does nothing visible.
5. **A tab's undo document stays in the tab.** With the host's `resolve`
   rejecting `undo:` and its policy refusing to share or accept it, the host
   never stored it, and the other client never saw it. The stack kept
   working.
6. **Who wrote in a card is in its operations, but only the host can read
   it.** The `clientID`s in a card's Yjs document are exactly its writers'
   seats (`yjsClientId(seat)`), plus `0`, Kyneta's structural seed, present
   before anyone writes. The host's peers map each seat to its principal. A
   client's only peer is the host (ADR-0037), so a client cannot tell whose
   a `clientID` is, and the host forgets a seat once it departs.
7. **One client's writes arrive in order across documents.** A keystroke in a
   card was on the host in 20 of 20 tries by the time a later write, to
   another document, from the same client arrived.

## Why it was asked

ADR-0048 has clients write cards directly, with the host acting only when a
card is sent. Its first build step (`PLAN-2026-09-30-drafting-card`) needed
to know whether a Yjs record of cards survives writes by several clients and
the host, whether a spent card's document can be destroyed safely, whether
Kyneta's new undo (`createUndoStack`) works with shared and spent cards, and
how contributors can be told apart without the host watching every card.

## Method

One disposable probe in `apps/pinetrie/e2e/`, not checked in, run with `node`.
A minimal host built as `startHost` builds its exchange: the SQLite store
(`openStore`), a `WebsocketServerTransport` behind `node:http` and `ws`,
`departureTimeout: 0`, a write policy, and a `resolve` for `cards`, `card:`
and `undo:`. Two Node clients (Ada and Bea), each an `Exchange` over
`WebsocketClientTransport`, as `connectSession` connects. The cards document
was `yjs.bind` of a record of flat string structs; each card's text was a
`{ text: Schema.text() }` Yjs document. `clientID`s were read with `unwrap`
from `store.clients`. Undo used `createUndoStack` from the Kyneta build
pine·trie links (`needed-by-pinetrie`, with "selective, durable undo across
documents"). The host was restarted over the same file to see what stayed
stored.

| check | result |
|---|---|
| two cards created at once, on host, Ada, Bea | both, everywhere |
| host deletes a card ∥ a client sets one field | deleted everywhere |
| host deletes a card ∥ a client sets the whole record | the record is back everywhere |
| card text: `clientID`s in the host's copy | `0`, Ada's seat's, Bea's seat's |
| Ada's peers | the host only |
| a keystroke present when a later write to another document arrives | 20 / 20 |
| undo, with Bea's text typed inside Ada's | Ada's undone, Bea's kept |
| undo of the creation step | Ada's record deleted, Bea's text kept; redo restores both |
| undo after the host spent the card | `true`; only Ada's dead replica changes |
| host store after spend, and after Ada's undo | the card's document is gone, and stays gone |
| Ada types into a destroyed card | not stored again |
| `undo:` document with `resolve` rejecting it | never stored by the host, never seen by Bea |
| a client-created document the host never opened, no `resolve` | not stored; Bea reads it empty |
| the same, with `resolve` | stored; Bea reads it |
| after restart | the cards document and the unspent cards' documents |

## Consequences

1. **Clients write only fields after a card is created.** A client setting a
   whole record can bring back a card the host spent at the same moment. A
   spend is a delete, which beats a concurrent field write.
2. **The host registers a `resolve`**: `cards` as the cards document, `card:`
   as a text document, `undo:` rejected. Without it the design does not work
   at all.
3. **Spending is delete-then-destroy, with no refusal.** The policy accepts
   `cards` and `card:` from any client.
4. **Contributors come from the operations, through seats the host
   publishes.** The host knows each seat's person while it is connected, and
   is the only peer that does. So the host writes a durable record per seat,
   its `clientID` and its person, when the seat connects. Anyone, host or
   client, then derives a card's contributors from the `clientID`s in its
   document, skipping `0`. Nobody writes a contributors list, and the host
   watches no card. This is as trustworthy as ADR-0037's identity. It is what
   ADR-0025 did for notes, with the host's live peer list replaced by a
   record that outlives the seat.
5. **A spent card's undo steps are wasted.** Ask Kyneta: a document its
   authority has dismissed should count as not standing, so the stack skips
   its steps, as it skips a step nothing of which still stands. Kyneta now
   skips a step whose document is not held; pine·trie destroys each client's
   copy when the host lets go of it (S64).
6. **The sender's text and the host's copy agree** at the moment of a send
   from one client, since one client's writes arrive in order. The chat
   command still carries the text the sender saw: a collaborator's concurrent
   edit, which the sender never saw, is not sent.

## What was not measured

- A browser, as opposed to Node clients.
- Concurrent moves of one card between places: this step moves no cards.
  ADR-0048's probe 1 still stands for the drawer.
- How many seat records a long-lived session accumulates. A store-less client
  is a new seat on every load (ADR-0037).

## Addendum: redo of a step of several commits

Found while building the drafting card (`PLAN-2026-09-30-drafting-card`), with
`createUndoStack` over one `TextDoc` in Node, on the same Kyneta build:

| the step | typed | undo | redo |
|---|---|---|---|
| typing, one keystroke | `Gox` | `Go` | `Gox` |
| typing, 4 keystrokes (`m`, `o`, `r`, `e`) | `Gomore` | `Go` | `Goerom` |
| one gesture, 4 commits | `Gomore` | `Go` | `Goerom` |
| typing, one 4-character commit | `Gomore` | `Go` | `Gomore` |

**Redo of a step made of several commits to one text puts them back in
reverse order.** Undo is right; a step of one commit redoes right. In a
browser, a run of keystrokes is several commits, so Cmd+Shift+Z after Cmd+Z
scrambles the last word typed. Typing is grouped by word
(`continuesStep`), so undo takes back the last word, as designed.

Ask Kyneta: `revertStep` for a redo should apply its parts in the order that
restores the text, as it does for an undo. Until then, the browser suite
checks redo on a step of one input.

Fixed in Kyneta ("a step of several commits to one text undoes and redoes in
order"), and the browser suite checks a run of keystrokes again (S64).
