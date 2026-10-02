# S76 — a card's place with one owner, and what a card's document costs

Measured in a lane (Linux, Node 24), for ADR-0048's step 4, after S75 showed
that a card's place should not be merged. The model under test: a card's
text is its own Yjs document; its place in a session is written only by the
host (a `json` document); your inventory is a Yjs document of your own,
written by your tabs, saying which slot holds which card; the host records
only that a card is in your inventory. Moves between the host's places and
your inventory are handoffs, a compare-and-set the host applies or refuses.
The probes are kept under `.plans/s76-probe/` with their output, and were
not committed.

**Answers.**

1. **Your inventory reaches your tabs and nobody else's.** With `canShare`
   and `canAccept` granting `inventory:<person>` only to peers whose
   principal is that person:
   - Ada's second tab saw her first tab's write, and a tab of Dan's opened
     later got his whole inventory.
   - Bea, opening Ada's inventory, saw it empty. Her write to it reached
     neither the host nor Ada.
   - Bea writing an inventory for Carl, who had not yet connected, made the
     host hold nothing: `resolve` never fired for her. Carl's own inventory,
     made later, held only his writes.

   The host's `resolve` fired once per inventory, each time for its owner.
   A principal is what a peer says it is (ADR-0037), so this keeps an
   inventory private from honest clients only.
2. **The first handoff to arrive wins, and the loser is told where the card
   went.**
   - Ada and Bea took one card at once (200 races, each starting first in
     half): exactly one was accepted every time, and every refusal named the
     card's place now.
   - The request scheduled first won 84 of 100 with Ada first and 88 of 100
     with Bea first, so the winner followed the order of sending, not the
     person, unlike S75's 100 of 100 to Ada by `clientID`. (Timers under a
     millisecond often fired in one tick, in the order they were set.)
   - Two of Ada's tabs taking one card (40), or putting one card into two
     threads (40): exactly one accepted each time.
   - Bea could neither put a card out of Ada's inventory nor take one into
     it.
   - A round trip took 2.9 ms (median), 3.8 ms (90th percentile), over
     localhost.
3. **The host enforces "full means full" without knowing slots.** It counts
   the cards whose place is your inventory, and refuses a take at 18.
4. **The repair rule converges.** Each of Ada's tabs computes the same view
   from the host's places and her inventory, and writes only what differs:
   - a card of hers that no slot holds goes in the first empty slot, cards
     in id order;
   - a slot naming a card that is not hers is cleared;
   - a card in two slots keeps the lower one.

   A take the host accepted whose slot no tab wrote (a crash) was placed,
   and both tabs agreed after 3 writes each. A put the host accepted whose
   slot no tab cleared was cleared. When one tab wrote a card into a slot
   while the other repaired a different card into the same slot (20 tries),
   one write won the slot, the other card was placed again in the next
   empty one, and the tabs agreed every time, both cards shown, in at most
   3 writes.
5. **A client that writes the host's places document diverges for good, and
   then the repair rule never settles.** The host refuses the write, as S28
   found, but the writer keeps its own value for that card. A later host
   write to the same card does not reach it, while writes to other cards
   do. In the first run, a tab with such a replica and a tab without it
   undid each other's repairs: 1,752 writes each, still going when the
   probe moved on. Nothing in Kyneta stops a client writing a `json`
   document another peer is the authority for.
6. **One Yjs document per card is the unit that can be let go, but Kyneta
   does not let go of it yet.** 3,000 cards of 2,000 characters:

   | | live | after removing every card |
   |---|---|---|
   | one Yjs document per card, no Exchange, then dropped | 14.5 KB a card | 0.5 KB a card |
   | one Yjs document per card, in an Exchange, then `destroy` | 19–22 KB a card | 19–21 KB a card |
   | one Yjs document holding every card, then each deleted | 2.5 KB a card | 1.0 KB a card |

   - A card's own document costs about 12 KB empty, 17 KB inside an
     Exchange, so one card in its own document costs several times what it
     costs as an entry in a shared one.
   - A document dropped outside an Exchange is freed. A shared document
     never frees what its deleted cards leave: a live Yjs document trims
     nothing in Kyneta (`packages/exchange/TECHNICAL.md`, compaction).
   - **`Exchange.destroy` frees nothing.** After destroying 300 documents,
     all 300 Yjs `Doc`s were still in the heap, kept by a `WeakMap` in
     Kyneta's persistence code (its `entries`, holding a `readError`
     closure that holds the document's entry and substrate), reachable from
     the Exchange. It grows linearly: 1,000 and 6,000 documents kept about
     20 KB each.
   - **Kyneta has no way to unload a document and keep it stored.**
     `destroy` deletes it from the store too, and `suspend` leaves the sync
     graph but keeps it in memory.

## Why it was asked

S75 found that a card's place does not merge. Duane's model: a card's text
stays a CRDT; a place in a session belongs to the host; your inventory's
layout is a CRDT of yours, so it works offline and syncs when you are back;
and a card's place has one owner at a time, handed between them. This probe
measured that model before an ADR, and Duane's question: is one Yjs
document per card right, since a card's memory is then simple to let go?

## Method

A host built as `startHost` builds its exchange (the SQLite store,
`WebsocketServerTransport` behind `ws`, `departureTimeout: 0`), with a
policy: `places` refused from clients; `inventory:<person>` shared with and
accepted from only that principal; `card:` texts from anyone; `undo:`
rejected; `routeLine` for Lines. The host wrote `places`, a `json` record
of card id to a place string (`thread:e1`, `inventory:ada`). Handoffs went
over a `Line` (`Handoff`, built as `Control` is): a request named the card,
its place as the client saw it, and where it should go; the host compared,
wrote and replied in one synchronous step, and refused a move into or out
of an inventory that was not the sender's, or into a full one. Clients:
Ada in two tabs, Bea; Carl, Dan and Eve for single checks. Inventories were
`yjs` records of slot to card id. Races ran both requests in one tick, or
each after a random 0–3 ms. The repair ran in each of Ada's tabs on every
change to `places` or her inventory, in a microtask.

Memory: Node with `--expose-gc`, heap measured after two collections and a
pause; documents created with `createDoc` or `Exchange.get`, then dropped,
destroyed, or (one shared document) their records deleted. The retainer was
found in a heap snapshot, by a breadth-first search from the roots to a
retained `Doc`.

| check | result |
|---|---|
| Ada's second tab sees her inventory | yes |
| Bea opens Ada's inventory | empty |
| Bea writes Ada's inventory | host and Ada unchanged |
| Bea writes Carl's, which the host does not hold | host holds nothing |
| Dan's later tab gets his inventory | yes |
| handoff round trip, localhost | 2.9 ms median, 3.8 ms p90 |
| Ada ∥ Bea take one card, 200 | one accepted 200; loser told the place 200 |
| winner: the request scheduled first | Ada first 84 / 100, Bea first 88 / 100 |
| two tabs take one card, 40 | one accepted 40 |
| two tabs put one card to two threads, 40 | one accepted 40 |
| Bea moves a card into or out of Ada's inventory | refused, both |
| repair: accepted take, no slot written | placed; tabs agree; 3 writes each |
| repair: two cards into one slot at once, 20 | converged 20, both shown 20, ≤ 3 writes |
| repair: accepted put, slot not cleared | cleared |
| a client writes `places` | refused by the host; the writer keeps its value |
| the host writes that card again | the writer still keeps its value |
| a diverged tab and a sound tab repairing | 1,752 writes each, not settled |
| memory | the table in answer 6 |

## Consequences

1. **The model holds.** Places in a session are the host's, written by
   handoffs it applies or refuses; your inventory is a Yjs document only you
   hold and write; the host records only whose inventory a card is in, and
   counts it. Each tab repairs its inventory from the host's places.
2. **A client must never write the places document.** Writes go through
   handoffs only, and the client's code should hold no writable reference
   to `places`. A read-only replica for a document another peer is the
   authority for, or a refused write that resyncs, is a question for
   Kyneta.
3. **The repair writes only what differs, and only from a sound replica.**
   It converges in a few writes. A diverged replica is the case that makes
   it fight, which consequence 2 rules out.
4. **One Yjs document per card stays**, for what a card is: the unit of
   text, history, sharing and, later, replication to another host. But a
   client opens only the cards it shows (a column's cards, your inventory),
   not every card in the session, since each document costs about 17 KB.
5. **Kyneta needs two things before a card's memory is simple to let go:**
   `destroy` must free the document (today the persistence `WeakMap`
   keeps it), and a way to unload a document while keeping it stored, to be
   reopened with `exchange.open`. Neither blocks step 4's first cut. Both
   decide whether a host and a long-lived tab can hold a session's cards
   for weeks.

## What was not measured

- A browser.
- Offline: a request waiting while disconnected, and the inventory synced
  later.
- Undo: a take's two halves (the host's handoff and your inventory's slot)
  undone together.
- A host restart with handoffs in flight (`Line` says it survives one).
- p2p and several hosts.
