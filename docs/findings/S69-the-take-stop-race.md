# S69 — when the host takes a queued card as someone stops it, who wins?

- **Status:** Answered
- **Led to:** ADR-0026, ADR-0048, ADR-0055, ADR-0059, ADR-0083, ADR-0085,
  ADR-0108

**Answers.**
1. **Once the host's take is written, it wins.** The take reads the top
   queued card and deletes its record in one synchronous step, before
   anything is awaited. A stop is a field write on the record (`kind` set
   back to drafting), and a delete beats a concurrent field write (S58). In
   400 races over websockets, every stop the host had not seen when it took
   the card was lost, and every replica agreed: the card was gone on the
   host and both clients. In the 100 races where the take and the stop were
   written in the same tick, so that neither side had heard the other, the
   stop lost every time.
2. **A stop that lands first is respected.** The host reads the card's place
   in the same step as the delete, so a stop it has already received means
   the card is not at the top of the queue. 52 of the 400 stops reached the
   host first. None of those cards were taken or sent, and none were sent
   while below the line.
3. **The stopper's client can tell that its stop lost.** It wrote a stop to
   the card. It then sees the card's record go, and the host leave the
   card's document while still connected, which only a spend does (S64).
   That was so in 298 of 298 lost stops, and in none of the 52 stops that
   won. In the other 50 tries the card had already gone from Ada's replica,
   so there was nothing to stop.
4. **Undoing a stop that lost does nothing.** The client destroys its copy
   of a spent card (S64), and `undo` then returns `false` whether it is
   filtered to the card's text or to the cards document. The card does not
   come back.
5. **If pi refuses the message, the host must write the card back below the
   line.** The host writes the whole record again after it deleted it (it
   is the only writer then), and every client sees it. The clients' copies
   of the text survive, since the host never left the document, and typing
   reaches the host again. But a stop written concurrently with the take was
   lost to the delete: when the record was written back as queued, it was
   queued everywhere, as if the stop had never happened. When it was
   written back as drafting, it was drafting everywhere, which is what both
   the refusal and the stop asked for.
6. **A field on each card is enough to order a queue. An ordered list per
   thread is not.**
   - Two people queueing the same card at once: with a field, one queued
     card. With a list, the card is in the list twice.
   - Two people moving the same card up at once (a move is a delete and an
     insert): with a list, the card is in the list twice.
   - One person stopping a card (removing it from the list and setting its
     record to drafting) while another moves it: the list puts it at the top
     of the queue and the record says drafting. The list and the record are
     two sources of truth, and they disagree.
   - With a field, a stop concurrent with a queue settles on one value
     everywhere (Yjs picks by `clientID`, the same way in 20 of 20 tries).
     The host taking a card while someone stops it is the same in both
     shapes, since deleting one list item twice is harmless.

## Why it was asked

ADR-0048 step 3 makes queued messages queued cards, which clients move above
and below the line themselves. Until now a take and a cancel ran in order in
the host's serial executor (ADR-0026). Once clients write the cards
document, the host taking the top queued card and someone stopping that card
are concurrent. ADR-0048's rule is that once the take is written it wins and
the stopper is told "already sent". This probe measured whether that holds
over pine·trie's topology, and whether a queue's order needs a list.

## Method

One disposable probe in `apps/pinetrie/e2e/`, not checked in, run with `node`.
A host built as `startHost` builds its exchange: the SQLite store
(`openStore`), `WebsocketServerTransport` behind `ws`,
`departureTimeout: 0`, a `resolve` for the cards document and `card:` texts,
and a policy rejecting `undo:`. Two clients, Ada and Bea, each an `Exchange`
over `WebsocketClientTransport` with a `createUndoStack` scoped as
`connectSession` scopes it, so every client was connected only to the host.
Each card's text was a `TextDoc`. The cards document was a probe schema:
each card a struct of flat strings (`owner`, `kind`, `lane`, `order`), and,
for the list variant, a record of lists of card ids per lane. Ada created
each card as `createCard` does, in one gesture with its text, and stopped it
in a gesture writing only `kind`.

The host's take: sort the lane's queued cards by `order` then id, read the
top card's record and text, and delete the record, all in one synchronous
step. Then wait a millisecond, as for pi, and destroy the card's document,
or for a refusal write the whole record back. Ada watched each card's
document's peers as `cardText` does (`hostLetGo`).

Each race: Ada queues a card, and everyone sees it. Then the host's take and
Ada's stop each run after a random 0–3 ms. One race in four ran both in the
same tick (two `setTimeout(…, 0)`), so neither had heard the other. Then
each replica was waited on until all agreed.

| check | result |
|---|---|
| races | 400 |
| taken | 348 |
| stop lost (written, then taken) | 298 |
| stop won (the host saw it before the take) | 52 |
| stop not written: the card already gone on Ada | 50 |
| same-tick races: stop lost | 100 / 100 |
| replicas that disagreed | 0 |
| taken, record still somewhere | 0 |
| not taken, record gone | 0 |
| sent while below the line | 0 |
| lost stops where Ada saw a spend | 298 / 298 |
| stops that won where Ada saw a spend | 0 / 52 |
| undo after a lost stop, copy destroyed, filtered to text or to cards | `false`; nothing changes |
| refused, written back queued, with a concurrent stop | queued everywhere |
| refused, written back drafting, with a concurrent stop | drafting everywhere |
| refused: Ada's text kept, her later typing reaches the host | yes |
| field: both queue one card at once | one queued card |
| field: stop ∥ queue, 20 tries | one value everywhere, the same each time |
| list: both queue one card at once | `[c, c]` |
| list: both move one card up at once | `[b, b, a]` |
| list: take ∥ stop | `[]`, record gone everywhere |
| list: stop ∥ move | the card on top of the list, its record drafting |

## Consequences

1. **The take is one synchronous step on the host**: read the top queued
   card and delete its record. Nothing may be awaited between the read and
   the delete. The card's text is read in the same step, and sent as the
   message.
2. **A refused send writes the card back below the line**, with a mark
   saying why it was not sent. Writing it back as queued would undo a stop
   nobody saw lose, and the queue would try it again at once.
3. **A client says "already sent" when a card it stopped is spent**: it
   wrote a stop, then the card's record went and the host left the card's
   document. The client keeps the cards it stopped until it sees which way
   each went.
4. **A queued card's place is its record's fields**: `kind`, its lane, and
   an order key. No list per thread. Two people queueing at the same moment
   may write equal keys, so the queue is sorted by key and then by id, and
   every replica agrees on the order.
5. **Undoing a queue or a stop is for ADR-0052's move history** (step 4).
   Kyneta's `undo({ docs })` filters by document, and a move writes only the
   cards document, so a card's box, which undoes the steps that wrote its
   text, does not reach its moves.

## What was not measured

- A browser.
- The host noticing a queued card on an idle lane by watching the cards
  document, as step 3 will. Here the probe called the take.
- Reordering (step 7), beyond moving a card up in the list variant.
- An order key computed by two people at once: sorting by id after the key
  is a design choice here, not a measurement.
- Moves undone from a move history filtered to the cards document while
  other live cards have steps there (ADR-0052, step 4).
