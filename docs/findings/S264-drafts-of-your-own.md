# S264 — can your composer's draft be yours, with no record in the places?

- **Status:** Answered
- **Led to:** ADR-0202

Asked with Duane, who expects typing in a composer to need no host: only a
send (or another move) should go over the host's Line. Today the first
keystroke in an empty composer creates a card, and its place (`composing`)
is the host's to write (ADR-0059), so with the host gone the box empties
itself on every keystroke. The option chosen: a person's document of drafts
(`drafts:<writer>`, a kind in `PERSON_DOC_KINDS`, written only by your tabs)
names each thread's draft card, whose text is a card document the host
holds no record of until a send or a move hands the card to it. "Yours"
here is not your inventory.

**Question.**

1. Does the host take in, store and relay a card's text that no record in
   the places names, and keep it across a restart from its store?
2. Who holds that text: is it handed to another person's client unasked,
   and does one who asks by its id receive it? Does your other tab, asking
   by the id your drafts document gives it?
3. Does the writer's own copy stay, with no record naming it
   (`card-texts.ts` destroys a copy once the host lets go of it and its
   record is gone)?
4. Two of your tabs name a draft for one thread at once in a drafts
   document: do they converge on one card, and can the tab that lost tell?
5. With the host gone, does a tab's write to its draft's text and to its
   drafts document throw, or stand in its own copy?
6. From the source: what does the host's send need of a card it has no
   record of, and what else reads only the cards the places name?

**Kill criterion.** The option is dropped if the host does not store and
relay a text no record names, or loses it on a restart, or if two of your
tabs writing one thread's draft do not converge on one card.

**Throw away.** The probe (a script beside the e2e suites, run with
`node`), and the temporary `drafts` kind it adds to `PERSON_DOC_KINDS` and
the host's `SCHEMA_OF`; both are removed once it has run.

**Answers.**

1. **The host stores and relays it, and its start sweep deletes it.** A
   text written by a client with no record reached the host, and every
   client reads it. After a restart from the same SQLite store, it was gone:
   the host's start sweep deletes every stored `card:` document no record
   names (`planCardSweep` in `packages/rules/card.ts`, run by
   `apps/pinetrie/host/startup.ts`), and logged `1 unused text(s)`. With that
   deletion switched off for one run, a new tab read the whole text after
   the restart. Nothing else drops it. So the loss comes from a rule in
   pine·trie's own code, not from Kyneta or the store. The kill criterion
   is not met: the option needs that sweep to keep every card a drafts
   document names.
2. **Every client is handed it, unasked.** Bea's client, and Ada's other
   tab, held the card's document within 1.5 s without opening it. The
   host's policy leaves a card's text to Kyneta's default, which shares
   every document with every peer (`apps/pinetrie/host/policy.ts`). That
   is true of every card today, a `composing` one included. So a draft
   kept out of the places is no more private than now. Its drafts document
   is private: Bea's client never held Ada's. Ada's other tab found the
   card id in the drafts document and read the text by it.
3. **The writer's copy stays.** With no record naming it, Ada's first tab
   still held its copy, and saw her other tab's typing. `card-texts.ts`
   destroys a copy only once the host lets go of it, which the host does
   only when it spends a card.
4. **Two tabs converge on one card, and the losing tab can tell.** Each
   of 20 races, where both of Ada's tabs named a different card for one
   thread at once, converged on one card. The same tab won all 20, as
   Yjs orders by `clientID` (S75's finding, for the same reason). In
   every race, the losing tab read another card's id where it had written
   its own, so it can tell, and its card is left without a draft entry.
5. **With the host gone, nothing throws.** A tab wrote to its draft's
   text, to its drafts document, and into a new card's text, and each
   write stood in its own copy. None of them reaches a host, because a
   client does not reconnect. A reload loses them, because a client keeps
   no store. This spike does not measure reconnecting (S28's part D is
   the hazard there).
6. **From the source:**
   - **A send needs no record.** It carries its text (`Send.text`), reads
     the card's other writers from its text (`CardPort.writers`), and its
     spend already handles a card with no record: it destroys the text
     (`spend` in `apps/pinetrie/host/commands/cards.ts`).
   - **A send that finds its lane busy does need a record.** It queues
     the card by moving its record (`queueBusy`, same file). With no
     record, the `busy` answer stands. A draft handed to the host for the
     queue would be a create at `queued`, which `createCard`'s move from
     nothing already is.
   - **Three host sweeps read only cards in the places.** The image sweep
     keeps blobs that the texts of placed cards reference
     (`sweepBlobs`, `apps/pinetrie/host/housekeeping.ts`), so an image
     pasted into a draft would be deleted at the next upkeep. The seat
     sweep keeps seat records that a stored text names (`planSeatSweep`,
     `packages/rules/seat.ts`). It is run over placed cards' texts only,
     and swept the probe's 3 seats, so the names of a draft's other
     writers ("with Bea") would be lost on a restart. The card sweep is
     answer 1.
   - **The page finds your composer's card by its record.** `yourCard`
     (`packages/rules/card.ts`) matches `composing` records, and so do the
     unsent marks on tabs and canvases (`packages/interface/signals.ts`),
     an undo of a move back to a composer (`refuseBack`,
     `packages/rules/moves.ts`), and a put on a column's composer
     (`packages/interface/put-target.ts`). Each would read the drafts
     document instead.

**Consequences.**

- Option 2 holds, with four changes the plan names: a `drafts` kind in
  `PERSON_DOC_KINDS` and its schema; the card, image and seat sweeps
  count the cards drafts documents name; a hand-off makes a draft's
  record at the place it moves to (send, queue, note, inventory); and the
  page reads your composer's card from your drafts document.
- A draft is visible to anyone who knows its id, as every card is now.
  Making card texts private is a separate question.
- Typing with the host gone stands in the tab and goes no further until
  clients reconnect or keep a store. That is the next spike, and S28's
  part D is its known hazard.
- A tab that loses a race leaves its card with no draft entry: its own
  sweep at the next start would delete it, and the plan says whether the
  losing tab moves its text into the winner or leaves it.

**Method.** `probe.ts` in this spike's folder, run as
`apps/pinetrie/e2e/s264-probe.ts` with `node`, in a Linux lane. It used a
`startSuiteHost` host with a scripted model on a SQLite store, and
`connectSession` clients through the suite's `join`: two tabs of Ada (one
principal, two seats) and one of Bea. A `drafts` kind was added to
`PERSON_DOC_KINDS` and to the host's `SCHEMA_OF` for the run, with
`InventoryDoc`'s shape, a record of thread id to card id. The deletion in
the start sweep was switched off for a second run. Both temporary changes
are reverted. `output.txt` holds both runs' output.
